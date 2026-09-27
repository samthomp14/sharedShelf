-- ============================================================
-- Push notifications (web push)
-- ============================================================
-- Plan: https://claude.ai/code/artifact/5ce2fb9c-2267-4a30-84b1-b3158648e6d1
--
-- The database decides who gets a push; the send-push edge function sends it.
--   * push_subscriptions — one row per device that turned notifications on.
--     `site` says which web app made it (prod or staging share this DB), so a
--     tap opens the right one.
--   * notification_prefs — per-account on/off per kind. No row = all on.
--   * push_outbox — one row per push to send. Written only by the triggers
--     below. An insert calls send-push through pg_net, after commit.
--
-- Events (kind -> who gets it):
--   borrow_request    loan_requests_v2 insert, pending        -> owner
--   request_accepted  loan_requests_v2 -> accepted            -> requester
--   request_declined  decline_request only (not bulk declines) -> requester
--   lent_to_you       loans_v2 insert with no request         -> borrower
--   hand_off_called_off loans_v2 ended 'called_off'           -> the other person
--   friend_request    friendships insert, pending             -> addressee
--   friend_accepted   friendships pending -> accepted         -> requester
--   invite_joined     friendships insert, already accepted    -> requester (inviter)
--
-- Safe to apply before any app code ships: with no subscriptions, send-push
-- marks rows "no devices" and sends nothing. Until the vault secrets exist
-- (push_function_url, push_webhook_secret) no HTTP call is made at all and
-- rows just wait with sent_at null.
-- ============================================================

create extension if not exists pg_net with schema extensions;

-- ------------------------------------------------------------
-- push_subscriptions
-- ------------------------------------------------------------
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  site text not null default 'prod' check (site in ('prod', 'staging')),
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index push_subscriptions_user_id_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

create policy "you manage your own push subscriptions"
  on public.push_subscriptions for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.push_subscriptions from anon, authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- ------------------------------------------------------------
-- notification_prefs (account-wide; a missing row means everything on)
-- ------------------------------------------------------------
create table public.notification_prefs (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  borrow_requests boolean not null default true,
  your_requests boolean not null default true,
  loans boolean not null default true,
  friends boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.notification_prefs enable row level security;

create policy "you manage your own notification prefs"
  on public.notification_prefs for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.notification_prefs from anon, authenticated;
grant select, insert, update on public.notification_prefs to authenticated;

-- ------------------------------------------------------------
-- push_outbox (no client access; doubles as the delivery log)
-- ------------------------------------------------------------
create table public.push_outbox (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in (
    'borrow_request', 'request_accepted', 'request_declined', 'lent_to_you',
    'hand_off_called_off', 'friend_request', 'friend_accepted', 'invite_joined')),
  actor_id uuid references public.profiles (id) on delete set null,
  book_id uuid references public.books (id) on delete set null,
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  error text
);

create index push_outbox_recipient_id_idx on public.push_outbox (recipient_id);
create index push_outbox_actor_id_idx on public.push_outbox (actor_id);
create index push_outbox_book_id_idx on public.push_outbox (book_id);

alter table public.push_outbox enable row level security;
revoke all on public.push_outbox from anon, authenticated;

-- ------------------------------------------------------------
-- Badge count: what the Notifications screen lists under "Needs you"
-- (lib/notifications.ts fetchNeedsYou). Called by send-push.
-- ------------------------------------------------------------
create function public.needs_you_count(p_user uuid)
returns integer
language sql
stable
security definer set search_path = ''
as $$
  select (
    (select count(*) from public.loan_requests_v2
      where owner_id = p_user and status = 'pending')
  + (select count(*) from public.loans_v2
      where (owner_id = p_user or borrower_id = p_user)
        and ended_at is null and handed_over_at is null)
  + (select count(*) from public.friendships
      where addressee_id = p_user and status = 'pending')
  )::integer;
$$;

revoke execute on function public.needs_you_count(uuid) from public, anon, authenticated;
grant execute on function public.needs_you_count(uuid) to service_role;

-- ------------------------------------------------------------
-- Outbox insert -> send-push (pg_net sends after commit, so a rolled-back
-- step never pushes). URL and secret live in Vault; missing = skip.
-- ------------------------------------------------------------
create function public.dispatch_push()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'push_function_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_webhook_secret';
  if v_url is null or v_secret is null then
    return new;
  end if;

  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    timeout_milliseconds := 5000
  );
  return new;
end;
$$;

create trigger on_push_outbox_insert
  after insert on public.push_outbox
  for each row execute procedure public.dispatch_push();

revoke execute on function public.dispatch_push() from public, anon, authenticated;

-- ------------------------------------------------------------
-- Lending events
-- ------------------------------------------------------------

-- decline_request marks the one request an owner said no to, so the trigger
-- can tell it apart from bulk declines (another friend got the copy, the
-- copy went unavailable or was removed). Same body as before otherwise.
create or replace function public.decline_request(p_request_id uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_req public.loan_requests_v2;
begin
  if v_uid is null then
    raise exception 'You need to be signed in.' using errcode = '42501';
  end if;

  select * into v_req from public.loan_requests_v2 where id = p_request_id for update;
  if v_req.id is null or v_uid not in (v_req.requester_id, v_req.owner_id) then
    raise exception 'Request not found.' using errcode = 'P0002';
  end if;
  if v_req.owner_id <> v_uid then
    raise exception 'Only the owner can decline a request.' using errcode = '42501';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'This request has already been answered.' using errcode = '55000';
  end if;

  perform set_config('sharedshelf.owner_declined', p_request_id::text, true);

  update public.loan_requests_v2
  set status = 'declined', responded_at = now()
  where id = p_request_id;
end;
$$;

create function public.push_on_loan_request()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if TG_OP = 'INSERT' then
    if new.status = 'pending' then
      insert into public.push_outbox (recipient_id, kind, actor_id, book_id, data)
      values (new.owner_id, 'borrow_request', new.requester_id, new.book_id,
              jsonb_build_object('request_id', new.id));
    end if;
  elsif new.status is distinct from old.status and old.status = 'pending' then
    if new.status = 'accepted' then
      insert into public.push_outbox (recipient_id, kind, actor_id, book_id, data)
      values (new.requester_id, 'request_accepted', new.owner_id, new.book_id,
              jsonb_build_object('request_id', new.id));
    elsif new.status = 'declined'
          and current_setting('sharedshelf.owner_declined', true) = new.id::text then
      insert into public.push_outbox (recipient_id, kind, actor_id, book_id, data)
      values (new.requester_id, 'request_declined', new.owner_id, new.book_id,
              jsonb_build_object('request_id', new.id));
    end if;
  end if;
  return null;
end;
$$;

create trigger push_on_loan_request
  after insert or update of status on public.loan_requests_v2
  for each row execute procedure public.push_on_loan_request();

revoke execute on function public.push_on_loan_request() from public, anon, authenticated;

create function public.push_on_loan()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if TG_OP = 'INSERT' then
    -- lend_to_friend: no request behind it.
    if new.request_id is null then
      insert into public.push_outbox (recipient_id, kind, actor_id, book_id, data)
      values (new.borrower_id, 'lent_to_you', new.owner_id, new.book_id,
              jsonb_build_object('loan_id', new.id));
    end if;
  elsif new.ended_reason = 'called_off' and old.ended_reason is null then
    insert into public.push_outbox (recipient_id, kind, actor_id, book_id, data)
    values (case when new.ended_by = new.owner_id then new.borrower_id else new.owner_id end,
            'hand_off_called_off', new.ended_by, new.book_id,
            jsonb_build_object('loan_id', new.id));
  end if;
  return null;
end;
$$;

create trigger push_on_loan
  after insert or update of ended_reason on public.loans_v2
  for each row execute procedure public.push_on_loan();

revoke execute on function public.push_on_loan() from public, anon, authenticated;

-- ------------------------------------------------------------
-- Friend events. accept_invite inserts an already-accepted row with the
-- inviter as requester; a normal request is inserted pending.
-- ------------------------------------------------------------
create function public.push_on_friendship()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if TG_OP = 'INSERT' then
    if new.status = 'pending' then
      insert into public.push_outbox (recipient_id, kind, actor_id)
      values (new.addressee_id, 'friend_request', new.requester_id);
    elsif new.status = 'accepted' then
      insert into public.push_outbox (recipient_id, kind, actor_id)
      values (new.requester_id, 'invite_joined', new.addressee_id);
    end if;
  elsif old.status = 'pending' and new.status = 'accepted' then
    insert into public.push_outbox (recipient_id, kind, actor_id)
    values (new.requester_id, 'friend_accepted', new.addressee_id);
  end if;
  return null;
end;
$$;

create trigger push_on_friendship
  after insert or update of status on public.friendships
  for each row execute procedure public.push_on_friendship();

revoke execute on function public.push_on_friendship() from public, anon, authenticated;
