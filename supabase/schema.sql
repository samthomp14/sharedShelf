-- sharedShelf schema
-- Run this in the Supabase SQL editor (or via `supabase db push` once the CLI is linked).
-- This is the full, current schema — safe to run top-to-bottom on a fresh project.

-- pg_trgm backs the ilike '%...%' indexes used by search (profiles, books,
-- book_authors below) — a plain btree can't serve a leading-wildcard match.
create extension if not exists pg_trgm with schema extensions;

-- ============================================================
-- profiles: one row per auth.users, public-ish identity info
-- ============================================================
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique not null,
  display_name text,
  avatar_url text,
  bio text,
  -- Public: any signed-in user sees your shelf and friends list. Private
  -- (default): friends only. See can_view_profile.
  is_public boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles are readable by any authenticated user"
  on public.profiles for select
  to authenticated
  using (true);

create policy "users can update their own profile"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id);

create policy "users can insert their own profile"
  on public.profiles for insert
  to authenticated
  with check ((select auth.uid()) = id);

create index profiles_username_trgm_idx on public.profiles using gin (username gin_trgm_ops);
create index profiles_display_name_trgm_idx on public.profiles using gin (display_name gin_trgm_ops);

-- Auto-create a profile row whenever a new auth user signs up. Username
-- comes from the `username` field passed in signUp()'s options.data —
-- falls back to the user's id if that's somehow missing.
--
-- If they signed up from an invite link (/invite/<code>), signUp() also
-- passes `invite_code`, and accept_invite (see the invites section) makes
-- them friends with the inviter. An unknown or expired code is simply
-- skipped — an invite must never make signup fail.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'username', new.id::text));

  if new.raw_user_meta_data ->> 'invite_code' is not null then
    begin
      perform public.accept_invite(new.id, new.raw_user_meta_data ->> 'invite_code');
    exception when others then
      raise warning 'handle_new_user: invite % skipped: %',
        new.raw_user_meta_data ->> 'invite_code', sqlerrm;
    end;
  end if;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- This is a trigger-backing function only — nothing should call it
-- directly via the auto-generated PostgREST RPC endpoint.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ============================================================
-- books: canonical metadata cache, deduped by ISBN
-- (populated from Open Library / Google Books lookups, or entered
-- manually when a book has no ISBN)
-- ============================================================
create table public.books (
  id uuid primary key default gen_random_uuid(),
  isbn text unique,
  title text not null,
  authors text[] not null default '{}',
  cover_url text,
  source text, -- e.g. 'open_library', 'google_books', 'manual'
  created_at timestamptz not null default now(),
  -- Always stored as a canonical ISBN-13; see normalize_isbn below.
  constraint books_isbn_13_check check (isbn is null or isbn ~ '^97[89][0-9]{10}$')
);

alter table public.books enable row level security;

create policy "books are readable by any authenticated user"
  on public.books for select
  to authenticated
  using (true);

-- No insert/update/delete policies: books are only created through
-- add_book_to_shelf (security definer, below), which normalizes the ISBN
-- and validates the row. Catalog rows are never edited by clients.

create index books_title_trgm_idx on public.books using gin (title gin_trgm_ops);

-- ============================================================
-- book_authors: one row per (book, author), kept in sync with
-- books.authors by trigger below. books.authors stays the source of
-- truth (it's what the app reads/writes); this table exists only so
-- author search doesn't have to pull every book's authors[] to the
-- client and filter in JS — it can filter with an indexed ilike instead.
-- ============================================================
create table public.book_authors (
  book_id uuid not null references public.books (id) on delete cascade,
  author text not null,
  primary key (book_id, author)
);

create index book_authors_author_trgm_idx on public.book_authors using gin (author gin_trgm_ops);

alter table public.book_authors enable row level security;

create policy "book authors are readable by any authenticated user"
  on public.book_authors for select
  to authenticated
  using (true);

-- No insert/update/delete policies: only the trigger below (security
-- definer) writes to this table.
create function public.sync_book_authors()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  delete from public.book_authors where book_id = new.id;
  insert into public.book_authors (book_id, author)
  select new.id, author from unnest(new.authors) as author
  on conflict do nothing;
  return new;
end;
$$;

create trigger on_book_authors_change
  after insert or update of authors on public.books
  for each row execute procedure public.sync_book_authors();

revoke execute on function public.sync_book_authors() from public, anon, authenticated;

-- Backfill/idempotent bootstrap: populates book_authors for any books
-- rows that existed before this table did. No-op on a fresh project
-- (books is empty), safe to re-run.
insert into public.book_authors (book_id, author)
select id, author from public.books, unnest(authors) as author
on conflict do nothing;

-- ============================================================
-- friendships: symmetric connection, stored as one row with a
-- requester/addressee pair and a status
-- ============================================================
create type public.friendship_status as enum ('pending', 'accepted');

create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles (id) on delete cascade,
  addressee_id uuid not null references public.profiles (id) on delete cascade,
  status public.friendship_status not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint no_self_friendship check (requester_id <> addressee_id),
  constraint unique_pair unique (requester_id, addressee_id)
);

create index friendships_requester_id_idx on public.friendships (requester_id);
create index friendships_addressee_id_idx on public.friendships (addressee_id);

alter table public.friendships enable row level security;

create policy "users can see friendships they're part of"
  on public.friendships for select
  to authenticated
  using ((select auth.uid()) = requester_id or (select auth.uid()) = addressee_id);

create policy "users can request a friendship"
  on public.friendships for insert
  to authenticated
  with check ((select auth.uid()) = requester_id);

create policy "either party can update a friendship (accept/respond)"
  on public.friendships for update
  to authenticated
  using ((select auth.uid()) = requester_id or (select auth.uid()) = addressee_id);

-- Lets you decline a pending request or cancel one you sent.
create policy "either party can delete a friendship"
  on public.friendships for delete
  to authenticated
  using ((select auth.uid()) = requester_id or (select auth.uid()) = addressee_id);

-- Helper: are two users accepted friends? Used inside shelf_items RLS
-- policies and the lending step functions, which run as `authenticated` — that role
-- keeps EXECUTE, but anonymous callers shouldn't be able to probe
-- arbitrary user-id pairs via the auto-generated RPC endpoint.
create function public.are_friends(a uuid, b uuid)
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from public.friendships
    where status = 'accepted'
      and ((requester_id = a and addressee_id = b)
        or (requester_id = b and addressee_id = a))
  );
$$;

revoke execute on function public.are_friends(uuid, uuid) from public, anon;

-- Helper: how many accepted friends does a user have? The friendships
-- select policy only exposes rows the caller is part of, so a profile
-- page can't count another user's friends directly — this exposes just
-- the count via security definer, same anon lockdown as are_friends.
create function public.friend_count(target uuid)
returns integer
language sql
security definer set search_path = public
stable
as $$
  select count(*)::integer from public.friendships
  where status = 'accepted'
    and (requester_id = target or addressee_id = target);
$$;

revoke execute on function public.friend_count(uuid) from public, anon;

-- Public profiles: any signed-in user can see a public profile's shelf and
-- friends list; private ones (the default) are friends only. Friend
-- requests still need accepting and borrowing stays friends-only.
-- shelf_items RLS stays friends-only, so the feed and book pages only show
-- friends' copies; other people's shelves go through profile_shelf.
-- Can the caller see this user's shelf and friends list?
create function public.can_view_profile(target uuid)
returns boolean
language sql
security definer set search_path = ''
stable
as $$
  select (select auth.uid()) = target
    or public.are_friends((select auth.uid()), target)
    or exists (select 1 from public.profiles where id = target and is_public);
$$;

revoke execute on function public.can_view_profile(uuid) from public, anon;

create or replace function public.friends_of(target uuid)
returns table (id uuid, username text, display_name text, avatar_url text)
language sql
security definer set search_path = ''
stable
as $$
  select p.id, p.username, p.display_name, p.avatar_url
  from public.friendships f
  join public.profiles p
    on p.id = case when f.requester_id = target then f.addressee_id else f.requester_id end
  where f.status = 'accepted'
    and (f.requester_id = target or f.addressee_id = target)
    and public.can_view_profile(target)
  order by coalesce(p.display_name, p.username);
$$;

-- Someone's shelf as their profile page shows it: visible copies only, in
-- their order. Empty unless can_view_profile.
create function public.profile_shelf(target uuid)
returns table (id uuid, lend_status public.copy_lend_status, book_id uuid, title text, cover_url text)
language sql
security definer set search_path = ''
stable
as $$
  select s.id, s.lend_status, b.id, b.title, b.cover_url
  from public.shelf_items s
  join public.books b on b.id = s.book_id
  where s.owner_id = target
    and s.visibility = 'friends'
    and public.can_view_profile(target)
  order by s.sort_order, s.created_at desc;
$$;

revoke execute on function public.profile_shelf(uuid) from public, anon;

-- Unfriending (deleting an accepted row) cancels pending borrow requests
-- between the two. Promised and handed-over loans stay so the book can
-- still come back. Cancelled requests send no push.
create function public.handle_unfriend()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if old.status = 'accepted' then
    update public.loan_requests_v2
    set status = 'cancelled', responded_at = now()
    where status = 'pending'
      and ((owner_id = old.requester_id and requester_id = old.addressee_id)
        or (owner_id = old.addressee_id and requester_id = old.requester_id));
  end if;
  return old;
end;
$$;

revoke execute on function public.handle_unfriend() from public, anon, authenticated;

-- ============================================================
-- invites: expiring invite codes (/invite/<code>). Using one makes
-- you and the inviter friends straight away — no request to accept —
-- since only people the inviter shared the link with have the code.
-- Codes are multi-use and last 7 days. Everything goes through the
-- functions below, so the table itself has no RLS policies.
-- ============================================================
create table public.invites (
  code text primary key,
  inviter_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days'
);

create index invites_inviter_id_expires_at_idx on public.invites (inviter_id, expires_at);

alter table public.invites enable row level security;

-- Your current invite code, for the share buttons. Reuses one with at least
-- a day left so a link you just sent doesn't die tomorrow; otherwise mints a
-- new one.
create function public.get_invite_code()
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  v_code text;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  select code into v_code from public.invites
  where inviter_id = auth.uid() and expires_at > now() + interval '1 day'
  order by expires_at desc
  limit 1;

  if v_code is null then
    -- 9 random bytes -> 12 URL-safe characters.
    v_code := translate(encode(extensions.gen_random_bytes(9), 'base64'), '+/', '-_');
    insert into public.invites (code, inviter_id) values (v_code, auth.uid());
  end if;

  return v_code;
end;
$$;

revoke execute on function public.get_invite_code() from public, anon;
grant execute on function public.get_invite_code() to authenticated;

-- Who sent an invite, for the sign-up screen ("@sam invited you"). Callable
-- signed out, since that's who opens invite links. Returns no row for an
-- unknown or expired code.
create function public.invite_preview(p_code text)
returns table (username text, display_name text)
language sql
security definer set search_path = public
stable
as $$
  select p.username, p.display_name
  from public.invites i
  join public.profiles p on p.id = i.inviter_id
  where i.code = p_code and i.expires_at > now();
$$;

revoke execute on function public.invite_preview(text) from public;
grant execute on function public.invite_preview(text) to anon, authenticated;

-- Makes p_user and the code's inviter friends: accepts a pending request in
-- either direction, or creates an accepted friendship. Returns the inviter,
-- or null for an unknown/expired code or your own code. Internal — called by
-- handle_new_user (signup) and redeem_invite (existing users).
create function public.accept_invite(p_user uuid, p_code text)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_inviter uuid;
begin
  select inviter_id into v_inviter from public.invites
  where code = p_code and expires_at > now();

  if v_inviter is null or v_inviter = p_user then
    return null;
  end if;

  update public.friendships
  set status = 'accepted', responded_at = now()
  where status = 'pending'
    and ((requester_id = p_user and addressee_id = v_inviter)
      or (requester_id = v_inviter and addressee_id = p_user));

  insert into public.friendships (requester_id, addressee_id, status, responded_at)
  select v_inviter, p_user, 'accepted', now()
  where not exists (
    select 1 from public.friendships
    where (requester_id = p_user and addressee_id = v_inviter)
       or (requester_id = v_inviter and addressee_id = p_user)
  );

  return v_inviter;
end;
$$;

revoke execute on function public.accept_invite(uuid, text) from public, anon, authenticated;

-- An already-signed-up user opening an invite link. Returns the inviter's
-- username so the app can open their profile, or null if the code is
-- unknown, expired, or your own.
create function public.redeem_invite(p_code text)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  v_inviter uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  v_inviter := public.accept_invite(auth.uid(), p_code);
  return (select username from public.profiles where id = v_inviter);
end;
$$;

revoke execute on function public.redeem_invite(text) from public, anon;
grant execute on function public.redeem_invite(text) to authenticated;

-- ============================================================
-- shelf_groups: a user's own custom categories for organizing
-- their shelf (e.g. "Sci-Fi", "To Reread"). Visible to friends
-- browsing the shelf, editable only by the owner.
-- ============================================================
create table public.shelf_groups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index shelf_groups_owner_id_idx on public.shelf_groups (owner_id);

alter table public.shelf_groups enable row level security;

create policy "friends can see visible shelf groups"
  on public.shelf_groups for select
  to authenticated
  using (public.are_friends((select auth.uid()), owner_id));

create policy "owners manage their own shelf groups"
  on public.shelf_groups for all
  to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

-- ============================================================
-- shelf_items: a physical copy a user owns
-- ============================================================
-- available | unavailable | promised | on_loan. Changed only by the lending
-- step functions (guard_lend_status, below, blocks direct client writes).
create type public.copy_lend_status as enum ('available', 'unavailable', 'promised', 'on_loan');

create table public.shelf_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  book_id uuid not null references public.books (id) on delete restrict,
  lend_status public.copy_lend_status not null default 'available',
  visibility text not null default 'friends' check (visibility in ('friends', 'private')),
  group_id uuid references public.shelf_groups (id) on delete set null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint shelf_items_owner_book_key unique (owner_id, book_id)
);

create index shelf_items_owner_id_idx on public.shelf_items (owner_id);
create index shelf_items_book_id_idx on public.shelf_items (book_id);
create index shelf_items_group_id_idx on public.shelf_items (group_id);

alter table public.shelf_items enable row level security;

-- Owners get full access (select/insert/update/delete) via the FOR ALL
-- policy below, so there's no separate owner-only SELECT policy — that
-- would just be a redundant permissive policy evaluated on every query.
create policy "friends can see visible shelf items"
  on public.shelf_items for select
  to authenticated
  using (
    visibility = 'friends'
    and public.are_friends((select auth.uid()), owner_id)
  );

create policy "owners manage their own shelf items"
  on public.shelf_items for all
  to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

-- ============================================================
-- Add-book RPCs: our catalog is always checked first; the client
-- only calls Open Library / Google Books on a miss. Every add goes
-- through add_book_to_shelf so ISBNs are normalized and the
-- catalog row + shelf item land in one transaction.
-- ============================================================

-- Canonical ISBN-13 (978/979) from any ISBN-10/13 spelling, or null if invalid.
create function public.normalize_isbn(raw text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  s text;
  core text;
  total int := 0;
  d int;
begin
  if raw is null then
    return null;
  end if;
  s := upper(regexp_replace(raw, '[^0-9Xx]', '', 'g'));

  if length(s) = 10 then
    if s !~ '^[0-9]{9}[0-9X]$' then
      return null;
    end if;
    -- ISBN-10: weights 10..1, sum must be divisible by 11 (X = 10).
    for i in 1..10 loop
      d := case when substr(s, i, 1) = 'X' then 10 else substr(s, i, 1)::int end;
      total := total + d * (11 - i);
    end loop;
    if total % 11 <> 0 then
      return null;
    end if;
    core := '978' || substr(s, 1, 9);
  elsif length(s) = 13 then
    if s !~ '^97[89][0-9]{10}$' then
      return null;
    end if;
    core := substr(s, 1, 12);
  else
    return null;
  end if;

  -- EAN-13 check digit: weights alternate 1,3.
  total := 0;
  for i in 1..12 loop
    total := total + substr(core, i, 1)::int * (case when i % 2 = 1 then 1 else 3 end);
  end loop;
  d := (10 - total % 10) % 10;

  if length(s) = 13 and substr(s, 13, 1)::int <> d then
    return null;
  end if;
  return core || d::text;
end;
$$;

-- The one way the app adds a book: find-or-create the catalog row and put it
-- on the caller's shelf in a single transaction.
create function public.add_book_to_shelf(
  p_book_id uuid default null,
  p_isbn text default null,
  p_title text default null,
  p_authors text[] default null,
  p_cover_url text default null,
  p_source text default null
)
returns table (book_id uuid, shelf_item_id uuid, already_on_shelf boolean)
language plpgsql
security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_book uuid;
  v_isbn text;
  v_title text;
  v_authors text[];
  v_item uuid;
  v_already boolean := false;
begin
  if v_uid is null then
    raise exception 'You need to be signed in.' using errcode = '42501';
  end if;

  if p_book_id is not null then
    select b.id into v_book from public.books b where b.id = p_book_id;
    if v_book is null then
      raise exception 'Book not found.' using errcode = 'P0002';
    end if;
  else
    if nullif(btrim(p_isbn), '') is not null then
      v_isbn := public.normalize_isbn(p_isbn);
      if v_isbn is null then
        raise exception 'That ISBN isn''t valid.' using errcode = '22023';
      end if;
      -- An existing catalog row wins; the details sent in are ignored.
      select b.id into v_book from public.books b where b.isbn = v_isbn;
    end if;

    if v_book is null then
      v_title := btrim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g'));
      if v_title = '' then
        raise exception 'Title is required.' using errcode = '22023';
      end if;

      select coalesce(array_agg(a order by ord), '{}') into v_authors
      from (
        select distinct on (lower(a)) a, ord
        from (
          select btrim(regexp_replace(x, '\s+', ' ', 'g')) as a, ord
          from unnest(coalesce(p_authors, '{}'::text[])) with ordinality as u (x, ord)
        ) cleaned
        where a <> ''
        order by lower(a), ord
      ) deduped;

      if p_source is null or p_source not in ('manual', 'open_library', 'google_books') then
        raise exception 'Invalid book source.' using errcode = '22023';
      end if;
      if p_cover_url is not null and p_cover_url !~ '^https://' then
        raise exception 'Cover URL must be https.' using errcode = '22023';
      end if;

      begin
        insert into public.books (isbn, title, authors, cover_url, source)
        values (v_isbn, v_title, v_authors, p_cover_url, p_source)
        returning id into v_book;
      exception when unique_violation then
        -- Someone added the same ISBN a moment ago.
        select b.id into v_book from public.books b where b.isbn = v_isbn;
      end;
    end if;
  end if;

  insert into public.shelf_items (owner_id, book_id)
  values (v_uid, v_book)
  on conflict on constraint shelf_items_owner_book_key do nothing
  returning id into v_item;

  if v_item is null then
    select s.id into v_item from public.shelf_items s
    where s.owner_id = v_uid and s.book_id = v_book;
    v_already := true;
  end if;

  return query select v_book, v_item, v_already;
end;
$$;

revoke execute on function public.add_book_to_shelf(uuid, text, text, text[], text, text) from public, anon;
grant execute on function public.add_book_to_shelf(uuid, text, text, text[], text, text) to authenticated;

-- Catalog search by title or author, with the caller's own shelf item (if any).
create function public.search_catalog(q text)
returns table (id uuid, isbn text, title text, authors text[], cover_url text, shelf_item_id uuid)
language sql
stable
set search_path = public, extensions
as $$
  with term as (
    select btrim(q) as t,
           '%' || replace(replace(replace(btrim(q), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat
  )
  select b.id, b.isbn, b.title, b.authors, b.cover_url, s.id
  from term, public.books b
  left join public.shelf_items s
    on s.book_id = b.id and s.owner_id = (select auth.uid())
  where length(term.t) >= 2
    and (
      b.title ilike term.pat
      or b.title % term.t
      or exists (
        select 1 from public.book_authors ba
        where ba.book_id = b.id and ba.author ilike term.pat
      )
    )
  order by greatest(similarity(b.title, term.t), word_similarity(term.t, b.title)) desc, b.title
  limit 20;
$$;

revoke execute on function public.search_catalog(text) from public, anon;
grant execute on function public.search_catalog(text) to authenticated;

-- Exact ISBN lookup in our catalog (any ISBN-10/13 spelling).
create function public.lookup_isbn(p_isbn text)
returns table (id uuid, isbn text, title text, authors text[], cover_url text, shelf_item_id uuid)
language sql
stable
set search_path = ''
as $$
  select b.id, b.isbn, b.title, b.authors, b.cover_url, s.id
  from public.books b
  left join public.shelf_items s
    on s.book_id = b.id and s.owner_id = (select auth.uid())
  where b.isbn = public.normalize_isbn(p_isbn);
$$;

revoke execute on function public.lookup_isbn(text) from public, anon;
grant execute on function public.lookup_isbn(text) to authenticated;

-- Status of a loan request (loan_requests_v2, below).
create type public.loan_request_status as enum ('pending', 'accepted', 'declined', 'cancelled');

-- ============================================================
-- client_logs: errors reported by the app (mainly the iPhone
-- home-screen web app, where there's no console to look at).
-- Clients can only insert their own rows; nobody can read them
-- through the API — query them from the dashboard.
-- ============================================================
create table public.client_logs (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid default auth.uid() references public.profiles (id) on delete set null,
  level text not null check (level in ('info', 'warn', 'error')),
  event text not null check (length(event) <= 100),
  detail jsonb check (detail is null or length(detail::text) <= 4000),
  user_agent text check (user_agent is null or length(user_agent) <= 500)
);

create index client_logs_created_at_idx on public.client_logs (created_at desc);
create index client_logs_user_id_idx on public.client_logs (user_id);

alter table public.client_logs enable row level security;

create policy "users can report their own client logs"
  on public.client_logs for insert
  to authenticated
  with check (user_id = (select auth.uid()));

-- ============================================================
-- Lending: requests, loans and the step functions that move a copy
-- through available -> promised -> on_loan -> available. From
-- migrations/*_lending_v2_expand.sql and *_lending_v2_contract.sql.
-- ============================================================

-- ------------------------------------------------------------
-- loan_requests_v2: a friend asking to borrow a copy
-- owner_id / book_id are denormalized (written only by the step functions)
-- so RLS needs no join and the feed still has a book after the copy is gone.
-- ------------------------------------------------------------
create table public.loan_requests_v2 (
  id uuid primary key default gen_random_uuid(),
  shelf_item_id uuid references public.shelf_items (id) on delete set null,
  book_id uuid not null references public.books (id) on delete restrict,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  requester_id uuid not null references public.profiles (id) on delete cascade,
  status public.loan_request_status not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint loan_requests_v2_not_own_copy check (owner_id <> requester_id)
);

-- One pending request per requester per copy.
create unique index loan_requests_v2_one_pending_idx
  on public.loan_requests_v2 (shelf_item_id, requester_id) where status = 'pending';
create index loan_requests_v2_shelf_item_id_idx on public.loan_requests_v2 (shelf_item_id);
create index loan_requests_v2_owner_id_idx on public.loan_requests_v2 (owner_id);
create index loan_requests_v2_requester_id_idx on public.loan_requests_v2 (requester_id);
create index loan_requests_v2_book_id_idx on public.loan_requests_v2 (book_id);

alter table public.loan_requests_v2 enable row level security;

create policy "owner or requester can see a v2 loan request"
  on public.loan_requests_v2 for select
  to authenticated
  using ((select auth.uid()) = owner_id or (select auth.uid()) = requester_id);

-- Declared up with friendships; attached here once loan_requests_v2 exists.
create trigger on_unfriend
  after delete on public.friendships
  for each row execute procedure public.handle_unfriend();

-- ------------------------------------------------------------
-- loans_v2: created at accept (promised) or lend_to_friend (handed over).
-- created_at = promised at. Active while ended_at is null.
-- ------------------------------------------------------------
create table public.loans_v2 (
  id uuid primary key default gen_random_uuid(),
  shelf_item_id uuid references public.shelf_items (id) on delete set null,
  book_id uuid not null references public.books (id) on delete restrict,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  borrower_id uuid not null references public.profiles (id) on delete cascade,
  request_id uuid references public.loan_requests_v2 (id) on delete set null,
  created_at timestamptz not null default now(),
  handed_over_at timestamptz,
  ended_at timestamptz,
  ended_reason text,
  ended_by uuid references public.profiles (id) on delete set null,
  constraint loans_v2_not_own_copy check (owner_id <> borrower_id),
  constraint loans_v2_ended_reason_check
    check (ended_reason is null or ended_reason in ('returned', 'called_off', 'removed')),
  constraint loans_v2_ended_consistent
    check ((ended_at is null) = (ended_reason is null)),
  constraint loans_v2_returned_was_handed_over
    check (ended_reason is distinct from 'returned' or handed_over_at is not null)
);

-- At most one active loan per copy.
create unique index loans_v2_one_active_idx
  on public.loans_v2 (shelf_item_id) where ended_at is null;
create index loans_v2_shelf_item_id_idx on public.loans_v2 (shelf_item_id);
create index loans_v2_owner_id_idx on public.loans_v2 (owner_id);
create index loans_v2_borrower_id_idx on public.loans_v2 (borrower_id);
create index loans_v2_book_id_idx on public.loans_v2 (book_id);
create index loans_v2_request_id_idx on public.loans_v2 (request_id);
create index loans_v2_ended_by_idx on public.loans_v2 (ended_by);

alter table public.loans_v2 enable row level security;

create policy "owner or borrower can see a v2 loan"
  on public.loans_v2 for select
  to authenticated
  using ((select auth.uid()) = owner_id or (select auth.uid()) = borrower_id);

-- Default privileges in this project grant everything to anon/authenticated
-- on new tables. Clients only ever read these, and only when signed in.
revoke all on public.loan_requests_v2, public.loans_v2 from anon, authenticated;
grant select on public.loan_requests_v2, public.loans_v2 to authenticated;

-- ------------------------------------------------------------
-- Guard: lend_status only changes through the step functions.
-- Owners have a FOR ALL policy on shelf_items (the app uses it for sort
-- order, groups, delete), so without this they could PATCH lend_status
-- directly. The step functions are security definer, so inside them
-- current_user is the definer, not authenticated/anon.
-- ------------------------------------------------------------
create function public.guard_lend_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if TG_OP = 'INSERT' and new.lend_status <> 'available' then
      raise exception 'New copies start out available.' using errcode = '42501';
    elsif TG_OP = 'UPDATE' and new.lend_status is distinct from old.lend_status then
      raise exception 'Use the lending actions to change a copy''s status.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger guard_lend_status
  before insert or update of lend_status on public.shelf_items
  for each row execute procedure public.guard_lend_status();

revoke execute on function public.guard_lend_status() from public, anon, authenticated;

-- ------------------------------------------------------------
-- Removing a copy from the shelf (plain delete on shelf_items): end its
-- active v2 loan with 'removed' and decline its pending v2 requests, before
-- the FKs null out shelf_item_id. Rows keep book_id/owner_id so the
-- borrower's feed can say "X removed <book> from their shelf. The loan's
-- closed."
-- ------------------------------------------------------------
create function public.handle_shelf_item_removed_v2()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  update public.loans_v2
  set ended_at = now(), ended_reason = 'removed', ended_by = old.owner_id
  where shelf_item_id = old.id and ended_at is null;

  update public.loan_requests_v2
  set status = 'declined', responded_at = now()
  where shelf_item_id = old.id and status = 'pending';

  return old;
end;
$$;

create trigger on_shelf_item_removed_v2
  before delete on public.shelf_items
  for each row execute procedure public.handle_shelf_item_removed_v2();

revoke execute on function public.handle_shelf_item_removed_v2() from public, anon, authenticated;

-- ============================================================
-- Step functions. Each checks auth.uid() and the current state, and raises
-- a readable message otherwise. Errcodes: 42501 not allowed, P0002 not
-- found, 55000 wrong state, 22023 bad argument. The copy row is locked
-- (for update) first so concurrent steps on one copy serialize.
-- ============================================================

-- Internal: decline every pending request on a copy (optionally sparing one).
create function public._decline_pending_requests_v2(p_shelf_item_id uuid, p_except uuid default null)
returns void
language sql
security definer set search_path = ''
as $$
  update public.loan_requests_v2
  set status = 'declined', responded_at = now()
  where shelf_item_id = p_shelf_item_id
    and status = 'pending'
    and id is distinct from p_except;
$$;

revoke execute on function public._decline_pending_requests_v2(uuid, uuid) from public, anon, authenticated;

-- A friend asks to borrow an available copy. The copy stays available.
create function public.request_loan(p_shelf_item_id uuid)
returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_item public.shelf_items;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'You need to be signed in.' using errcode = '42501';
  end if;

  select * into v_item from public.shelf_items where id = p_shelf_item_id for update;
  if v_item.id is null
     or (v_item.owner_id <> v_uid
         and (v_item.visibility <> 'friends' or not public.are_friends(v_uid, v_item.owner_id))) then
    raise exception 'Copy not found.' using errcode = 'P0002';
  end if;
  if v_item.owner_id = v_uid then
    raise exception 'That''s your own copy.' using errcode = '22023';
  end if;
  if v_item.lend_status <> 'available' then
    raise exception 'This copy isn''t available right now.' using errcode = '55000';
  end if;
  if exists (select 1 from public.loan_requests_v2
             where shelf_item_id = p_shelf_item_id and requester_id = v_uid and status = 'pending') then
    raise exception 'You''ve already asked to borrow this copy.' using errcode = '55000';
  end if;

  insert into public.loan_requests_v2 (shelf_item_id, book_id, owner_id, requester_id)
  values (v_item.id, v_item.book_id, v_item.owner_id, v_uid)
  returning id into v_id;
  return v_id;
end;
$$;

-- The requester withdraws a pending request.
create function public.cancel_request(p_request_id uuid)
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
  if v_req.requester_id <> v_uid then
    raise exception 'Only the person who asked can cancel a request.' using errcode = '42501';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'This request has already been answered.' using errcode = '55000';
  end if;

  update public.loan_requests_v2
  set status = 'cancelled', responded_at = now()
  where id = p_request_id;
end;
$$;

-- The owner says yes: copy -> promised, loan created (not yet handed over),
-- every other pending request on the copy declined. Returns the loan id.
create function public.accept_request(p_request_id uuid)
returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_req public.loan_requests_v2;
  v_item public.shelf_items;
  v_loan uuid;
begin
  if v_uid is null then
    raise exception 'You need to be signed in.' using errcode = '42501';
  end if;

  select * into v_req from public.loan_requests_v2 where id = p_request_id;
  if v_req.id is null or v_uid not in (v_req.requester_id, v_req.owner_id) then
    raise exception 'Request not found.' using errcode = 'P0002';
  end if;
  if v_req.owner_id <> v_uid then
    raise exception 'Only the owner can accept a request.' using errcode = '42501';
  end if;
  if v_req.shelf_item_id is null then
    raise exception 'That copy is no longer on the shelf.' using errcode = '55000';
  end if;

  -- Lock order: copy, then request (same as the other steps).
  select * into v_item from public.shelf_items where id = v_req.shelf_item_id for update;
  select * into v_req from public.loan_requests_v2 where id = p_request_id for update;

  if v_req.status <> 'pending' then
    raise exception 'This request has already been answered.' using errcode = '55000';
  end if;
  if v_item.lend_status <> 'available' then
    raise exception 'This copy isn''t available right now.' using errcode = '55000';
  end if;

  update public.loan_requests_v2
  set status = 'accepted', responded_at = now()
  where id = p_request_id;

  perform public._decline_pending_requests_v2(v_item.id, p_request_id);

  update public.shelf_items set lend_status = 'promised' where id = v_item.id;

  insert into public.loans_v2 (shelf_item_id, book_id, owner_id, borrower_id, request_id)
  values (v_item.id, v_item.book_id, v_item.owner_id, v_req.requester_id, v_req.id)
  returning id into v_loan;
  return v_loan;
end;
$$;

-- The owner says no.
create function public.decline_request(p_request_id uuid)
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

  -- Marks the one request the owner said no to (push_on_loan_request).
  perform set_config('sharedshelf.owner_declined', p_request_id::text, true);

  update public.loan_requests_v2
  set status = 'declined', responded_at = now()
  where id = p_request_id;
end;
$$;

-- Internal: lock an active loan and its copy (copy first, same lock order as
-- the other steps), checking the caller is the owner or borrower.
create function public._lock_active_loan_v2(p_loan_id uuid)
returns public.loans_v2
language plpgsql
security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  r_loan public.loans_v2;
begin
  if v_uid is null then
    raise exception 'You need to be signed in.' using errcode = '42501';
  end if;

  select * into r_loan from public.loans_v2 where id = p_loan_id;
  if r_loan.id is null or v_uid not in (r_loan.owner_id, r_loan.borrower_id) then
    raise exception 'Loan not found.' using errcode = 'P0002';
  end if;
  if r_loan.ended_at is not null or r_loan.shelf_item_id is null then
    raise exception 'This loan is already closed.' using errcode = '55000';
  end if;

  perform 1 from public.shelf_items where id = r_loan.shelf_item_id for update;
  select * into r_loan from public.loans_v2 where id = p_loan_id for update;
  if r_loan.ended_at is not null then
    raise exception 'This loan is already closed.' using errcode = '55000';
  end if;
  return r_loan;
end;
$$;

revoke execute on function public._lock_active_loan_v2(uuid) from public, anon, authenticated;

-- Owner or borrower calls off a promised (not yet handed over) loan.
create function public.call_off_loan(p_loan_id uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  v_loan public.loans_v2;
begin
  v_loan := public._lock_active_loan_v2(p_loan_id);
  if v_loan.handed_over_at is not null then
    raise exception 'The book has already been handed over.' using errcode = '55000';
  end if;

  update public.loans_v2
  set ended_at = now(), ended_reason = 'called_off', ended_by = auth.uid()
  where id = p_loan_id;

  update public.shelf_items set lend_status = 'available' where id = v_loan.shelf_item_id;
end;
$$;

-- Borrower ("Got it") or owner confirms the hand-off: copy -> on_loan.
create function public.mark_handed_over(p_loan_id uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  v_loan public.loans_v2;
begin
  v_loan := public._lock_active_loan_v2(p_loan_id);
  if v_loan.handed_over_at is not null then
    raise exception 'The book has already been handed over.' using errcode = '55000';
  end if;

  update public.loans_v2 set handed_over_at = now() where id = p_loan_id;
  update public.shelf_items set lend_status = 'on_loan' where id = v_loan.shelf_item_id;
end;
$$;

-- Owner lends straight to a friend with no request: loan starts handed over,
-- copy -> on_loan, pending requests declined. Returns the loan id.
create function public.lend_to_friend(p_shelf_item_id uuid, p_friend_id uuid)
returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_item public.shelf_items;
  v_loan uuid;
begin
  if v_uid is null then
    raise exception 'You need to be signed in.' using errcode = '42501';
  end if;

  select * into v_item from public.shelf_items where id = p_shelf_item_id for update;
  if v_item.id is null or v_item.owner_id <> v_uid then
    raise exception 'Copy not found.' using errcode = 'P0002';
  end if;
  if p_friend_id is null or p_friend_id = v_uid or not public.are_friends(v_uid, p_friend_id) then
    raise exception 'You can only lend to a friend.' using errcode = '22023';
  end if;
  if v_item.lend_status <> 'available' then
    raise exception 'This copy isn''t available right now.' using errcode = '55000';
  end if;

  perform public._decline_pending_requests_v2(v_item.id);

  update public.shelf_items set lend_status = 'on_loan' where id = v_item.id;

  insert into public.loans_v2 (shelf_item_id, book_id, owner_id, borrower_id, handed_over_at)
  values (v_item.id, v_item.book_id, v_uid, p_friend_id, now())
  returning id into v_loan;
  return v_loan;
end;
$$;

-- Owner marks a handed-over loan returned: copy -> available.
create function public.mark_returned(p_loan_id uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  v_loan public.loans_v2;
begin
  v_loan := public._lock_active_loan_v2(p_loan_id);
  if v_loan.owner_id <> auth.uid() then
    raise exception 'Only the owner can mark a book returned.' using errcode = '42501';
  end if;
  if v_loan.handed_over_at is null then
    raise exception 'The book hasn''t been handed over yet.' using errcode = '55000';
  end if;

  update public.loans_v2
  set ended_at = now(), ended_reason = 'returned', ended_by = auth.uid()
  where id = p_loan_id;

  update public.shelf_items set lend_status = 'available' where id = v_loan.shelf_item_id;
end;
$$;

-- Owner toggles a copy between available and unavailable. Going unavailable
-- declines pending requests.
create function public.set_copy_available(p_shelf_item_id uuid, p_available boolean)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_item public.shelf_items;
begin
  if v_uid is null then
    raise exception 'You need to be signed in.' using errcode = '42501';
  end if;
  if p_available is null then
    raise exception 'Say whether the copy is available.' using errcode = '22023';
  end if;

  select * into v_item from public.shelf_items where id = p_shelf_item_id for update;
  if v_item.id is null or v_item.owner_id <> v_uid then
    raise exception 'Copy not found.' using errcode = 'P0002';
  end if;
  if v_item.lend_status not in ('available', 'unavailable') then
    raise exception 'This copy is promised or on loan right now.' using errcode = '55000';
  end if;

  if not p_available then
    perform public._decline_pending_requests_v2(v_item.id);
  end if;

  update public.shelf_items
  set lend_status = case when p_available then 'available' else 'unavailable' end::public.copy_lend_status
  where id = v_item.id;
end;
$$;

revoke execute on function public.request_loan(uuid) from public, anon;
revoke execute on function public.cancel_request(uuid) from public, anon;
revoke execute on function public.accept_request(uuid) from public, anon;
revoke execute on function public.decline_request(uuid) from public, anon;
revoke execute on function public.call_off_loan(uuid) from public, anon;
revoke execute on function public.mark_handed_over(uuid) from public, anon;
revoke execute on function public.lend_to_friend(uuid, uuid) from public, anon;
revoke execute on function public.mark_returned(uuid) from public, anon;
revoke execute on function public.set_copy_available(uuid, boolean) from public, anon;

-- Owner shows or hides a copy. Hidden ('private') copies are left out of
-- friends' views by the shelf_items select policy, and request_loan already
-- refuses them. Hiding declines any pending requests (silently: no push, as
-- with the other bulk declines). A promised or lent copy can be hidden too;
-- its loan carries on.
create function public.set_copy_visibility(p_shelf_item_id uuid, p_visible boolean)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_item public.shelf_items;
begin
  if v_uid is null then
    raise exception 'You need to be signed in.' using errcode = '42501';
  end if;
  if p_visible is null then
    raise exception 'Say whether friends can see the copy.' using errcode = '22023';
  end if;

  select * into v_item from public.shelf_items where id = p_shelf_item_id for update;
  if v_item.id is null or v_item.owner_id <> v_uid then
    raise exception 'Copy not found.' using errcode = 'P0002';
  end if;

  if not p_visible then
    perform public._decline_pending_requests_v2(v_item.id);
  end if;

  update public.shelf_items
  set visibility = case when p_visible then 'friends' else 'private' end
  where id = v_item.id;
end;
$$;

revoke execute on function public.set_copy_visibility(uuid, boolean) from public, anon;

-- ============================================================
-- delete_account: deletes the caller's account. Everything that belongs to
-- it goes with the auth.users row via on delete cascade (profile, shelf,
-- friendships, loans, requests, invites, push rows). First, friends' copies
-- promised or lent to this account are freed up, since their loan rows are
-- about to disappear: promised -> available; lent -> unavailable (the book
-- is still out, so the owner decides). The shelf is removed before the
-- auth row because the per-copy removal trigger stamps ended_by with the
-- owner, which fails mid-cascade once the profile is gone.
-- ============================================================
create function public.delete_account()
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'You need to be signed in.' using errcode = '42501';
  end if;

  update public.shelf_items s
  set lend_status = case when l.handed_over_at is null then 'available' else 'unavailable' end::public.copy_lend_status
  from public.loans_v2 l
  where l.shelf_item_id = s.id
    and l.borrower_id = v_uid
    and l.ended_at is null;

  delete from public.shelf_items where owner_id = v_uid;

  delete from auth.users where id = v_uid;
end;
$$;

revoke execute on function public.delete_account() from public, anon;
grant execute on function public.request_loan(uuid) to authenticated;
grant execute on function public.cancel_request(uuid) to authenticated;
grant execute on function public.accept_request(uuid) to authenticated;
grant execute on function public.decline_request(uuid) to authenticated;
grant execute on function public.call_off_loan(uuid) to authenticated;
grant execute on function public.mark_handed_over(uuid) to authenticated;
grant execute on function public.lend_to_friend(uuid, uuid) to authenticated;
grant execute on function public.mark_returned(uuid) to authenticated;
grant execute on function public.set_copy_available(uuid, boolean) to authenticated;

-- ============================================================
-- Push notifications (web push)
-- ============================================================
-- Plan: https://claude.ai/code/artifact/5ce2fb9c-2267-4a30-84b1-b3158648e6d1
-- (migration 20260927004236_push_notifications)
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
