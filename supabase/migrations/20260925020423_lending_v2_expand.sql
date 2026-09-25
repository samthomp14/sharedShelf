-- ============================================================
-- Lending v2 — EXPAND step (expand/contract on the one prod database)
-- ============================================================
--
-- There's only one Supabase project, and production (master) still runs on
-- the old lending model: loan_requests, loans, shelf_items.status and their
-- triggers/policies. Nothing here alters or drops any of that. The new model
-- lives alongside it:
--
--   * shelf_items.lend_status (enum copy_lend_status) — the new copy state.
--     Old code never reads or writes it; old triggers only touch `status`.
--   * loan_requests_v2, loans_v2 — new tables. Named after the old ones plus
--     `_v2` so both models can coexist; once the old tables are dropped they
--     can be renamed back (or left as-is — lib/loans.ts is the only reader).
--   * Step functions (request_loan, accept_request, ...) — the ONLY way to
--     write the new tables or lend_status. Clients get SELECT only.
--   * backfill_lending_v2() — copies old rows into the new structures.
--
-- Copy states: available | unavailable | promised | on_loan. Requests don't
-- lock a copy; several friends can have pending requests on one available
-- copy. Accepting one promises the copy and declines the rest.
--
-- Visibility: friends see lend_status on shelf_items (existing select
-- policy); the UI shows promised/on_loan as "Unavailable". Who has the copy
-- is only in loans_v2 / loan_requests_v2, readable by the two people involved.
--
-- ------------------------------------------------------------
-- SWITCH-OVER (when staging is merged to master)
-- ------------------------------------------------------------
-- 1. `select * from public.backfill_lending_v2();` (catch-up, as postgres)
-- 2. Deploy master with the new UI (old-table writes stop).
-- 3. `select * from public.backfill_lending_v2();` again right away, to pick
--    up anything written to the old tables during the deploy. Don't run it
--    after that: it mirrors old-table state onto rows it copied, so a later
--    run could undo v2 actions taken on those rows.
-- 4. A day or two later (CONTRACT migration): drop triggers
--    on_loan_request_change / on_loan_returned, functions
--    handle_loan_request_change / handle_loan_returned, tables loans and
--    loan_requests, column shelf_items.status, type shelf_item_status,
--    function backfill_lending_v2, and the legacy_* columns on the v2 tables.
--    (loan_request_status is reused by loan_requests_v2 — keep it.)
-- ============================================================

create type public.copy_lend_status as enum ('available', 'unavailable', 'promised', 'on_loan');

-- Metadata-only on PG17 (constant default), no table rewrite.
alter table public.shelf_items
  add column lend_status public.copy_lend_status not null default 'available';

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
  legacy_request_id uuid unique, -- old loan_requests.id, set by the backfill
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
  legacy_loan_id uuid unique, -- old loans.id, set by the backfill
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
-- Owners have a FOR ALL policy on shelf_items (production uses it for sort
-- order, groups, delete), so without this they could PATCH lend_status
-- directly. The step functions are security definer, so inside them
-- current_user is the definer, not authenticated/anon. Old code never sets
-- lend_status, so this never fires for it.
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
-- closed." Old tables are untouched (they still cascade as before).
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
-- backfill_lending_v2(): copy the old model into the new one.
--
-- IDEMPOTENT and meant to be run MORE THAN ONCE: now (in this migration),
-- and again at switch-over to pick up rows production wrote to the old
-- tables in the meantime (see SWITCH-OVER at the top). Run as postgres /
-- service role only; clients can't execute it.
--
--   * Every old loan_request -> loan_requests_v2 (keyed by
--     legacy_request_id), status mirrored. So the old 'requested' copies'
--     pending requests arrive as pending, on a copy that's now available.
--   * Every old loan -> loans_v2 (keyed by legacy_loan_id).
--     handed_over_at = created_at = started_at. Returned ones get
--     ended_at = returned_at, ended_reason 'returned'. A loan returned on
--     prod since the last run gets closed on the next run.
--   * lend_status recomputed from active v2 loans: promised/on_loan where
--     there is one; any other promised/on_loan copy -> available. Old
--     'requested' and 'available' copies stay available (the default);
--     'unavailable' set through v2 is left alone.
-- ============================================================
create function public.backfill_lending_v2()
returns table (requests_upserted bigint, loans_upserted bigint, copies_updated bigint)
language plpgsql
set search_path = ''
as $$
declare
  v_req bigint;
  v_loans bigint;
  v_a bigint;
  v_b bigint;
begin
  insert into public.loan_requests_v2
    (shelf_item_id, book_id, owner_id, requester_id, status, created_at, responded_at, legacy_request_id)
  select r.shelf_item_id, s.book_id, s.owner_id, r.requester_id, r.status, r.created_at, r.responded_at, r.id
  from public.loan_requests r
  join public.shelf_items s on s.id = r.shelf_item_id
  where s.owner_id <> r.requester_id
  on conflict (legacy_request_id) do update
    set status = excluded.status, responded_at = excluded.responded_at
    where (public.loan_requests_v2.status, public.loan_requests_v2.responded_at)
      is distinct from (excluded.status, excluded.responded_at);
  get diagnostics v_req = row_count;

  insert into public.loans_v2
    (shelf_item_id, book_id, owner_id, borrower_id, request_id, created_at, handed_over_at,
     ended_at, ended_reason, ended_by, legacy_loan_id)
  select l.shelf_item_id, s.book_id, l.lender_id, l.borrower_id, rq.id, l.started_at, l.started_at,
         l.returned_at,
         case when l.returned_at is not null then 'returned' end,
         case when l.returned_at is not null then l.lender_id end,
         l.id
  from public.loans l
  join public.shelf_items s on s.id = l.shelf_item_id
  left join public.loan_requests_v2 rq on rq.legacy_request_id = l.loan_request_id
  where l.lender_id <> l.borrower_id
  on conflict (legacy_loan_id) do update
    set ended_at = excluded.ended_at, ended_reason = excluded.ended_reason, ended_by = excluded.ended_by
    where public.loans_v2.ended_at is null and excluded.ended_at is not null;
  get diagnostics v_loans = row_count;

  update public.shelf_items s
  set lend_status = case when l.handed_over_at is null then 'promised' else 'on_loan' end::public.copy_lend_status
  from public.loans_v2 l
  where l.shelf_item_id = s.id and l.ended_at is null
    and s.lend_status is distinct from
        (case when l.handed_over_at is null then 'promised' else 'on_loan' end)::public.copy_lend_status;
  get diagnostics v_a = row_count;

  update public.shelf_items s
  set lend_status = 'available'
  where s.lend_status in ('promised', 'on_loan')
    and not exists (select 1 from public.loans_v2 l where l.shelf_item_id = s.id and l.ended_at is null);
  get diagnostics v_b = row_count;

  return query select v_req, v_loans, v_a + v_b;
end;
$$;

revoke execute on function public.backfill_lending_v2() from public, anon, authenticated;

-- First run.
select * from public.backfill_lending_v2();
