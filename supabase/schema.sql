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
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'username', new.id::text));
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
  created_at timestamptz not null default now()
);

alter table public.books enable row level security;

create policy "books are readable by any authenticated user"
  on public.books for select
  to authenticated
  using (true);

create policy "authenticated users can add books to the catalog"
  on public.books for insert
  to authenticated
  with check (true);

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

-- Helper: are two users accepted friends? Used inside shelf_items/
-- loan_requests RLS policies, which run as `authenticated` — that role
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
create type public.shelf_item_status as enum ('available', 'requested', 'on_loan');

create table public.shelf_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  book_id uuid not null references public.books (id) on delete restrict,
  status public.shelf_item_status not null default 'available',
  visibility text not null default 'friends' check (visibility in ('friends', 'private')),
  group_id uuid references public.shelf_groups (id) on delete set null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
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
-- loan_requests: a friend asking to borrow a shelf item
-- ============================================================
create type public.loan_request_status as enum ('pending', 'accepted', 'declined', 'cancelled');

create table public.loan_requests (
  id uuid primary key default gen_random_uuid(),
  shelf_item_id uuid not null references public.shelf_items (id) on delete cascade,
  requester_id uuid not null references public.profiles (id) on delete cascade,
  status public.loan_request_status not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz
);

create index loan_requests_shelf_item_id_idx on public.loan_requests (shelf_item_id);
create index loan_requests_requester_id_idx on public.loan_requests (requester_id);

alter table public.loan_requests enable row level security;

create policy "requester or shelf owner can see a loan request"
  on public.loan_requests for select
  to authenticated
  using (
    (select auth.uid()) = requester_id
    or (select auth.uid()) in (
      select owner_id from public.shelf_items where id = shelf_item_id
    )
  );

create policy "friends can request to borrow a visible shelf item"
  on public.loan_requests for insert
  to authenticated
  with check (
    (select auth.uid()) = requester_id
    and exists (
      select 1 from public.shelf_items
      where id = shelf_item_id
        and status = 'available'
        and public.are_friends((select auth.uid()), owner_id)
    )
  );

create policy "requester or shelf owner can update a loan request"
  on public.loan_requests for update
  to authenticated
  using (
    (select auth.uid()) = requester_id
    or (select auth.uid()) in (
      select owner_id from public.shelf_items where id = shelf_item_id
    )
  );

-- ============================================================
-- loans: an active (or completed) hand-off of a shelf item
-- ============================================================
create table public.loans (
  id uuid primary key default gen_random_uuid(),
  shelf_item_id uuid not null references public.shelf_items (id) on delete cascade,
  loan_request_id uuid references public.loan_requests (id) on delete set null,
  lender_id uuid not null references public.profiles (id) on delete cascade,
  borrower_id uuid not null references public.profiles (id) on delete cascade,
  started_at timestamptz not null default now(),
  returned_at timestamptz
);

create index loans_shelf_item_id_idx on public.loans (shelf_item_id);
create index loans_loan_request_id_idx on public.loans (loan_request_id);
create index loans_lender_id_idx on public.loans (lender_id);
create index loans_borrower_id_idx on public.loans (borrower_id);

alter table public.loans enable row level security;

create policy "lender or borrower can see a loan"
  on public.loans for select
  to authenticated
  using ((select auth.uid()) = lender_id or (select auth.uid()) = borrower_id);

create policy "lender can create a loan for their own shelf item"
  on public.loans for insert
  to authenticated
  with check ((select auth.uid()) = lender_id);

create policy "lender or borrower can update a loan (e.g. mark returned)"
  on public.loans for update
  to authenticated
  using ((select auth.uid()) = lender_id or (select auth.uid()) = borrower_id);

-- ============================================================
-- Lifecycle triggers: keep shelf_items.status in sync with the
-- loan_request/loan lifecycle so the client never has to juggle
-- multi-table writes (or hit RLS walls — the requester doesn't own
-- the shelf item, so they can't flip its status themselves).
-- ============================================================

-- On a new loan_request: mark the shelf item 'requested'.
-- On accept: mark it 'on_loan' and create the loans row.
-- On decline/cancel: mark it 'available' again.
create function public.handle_loan_request_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    update public.shelf_items set status = 'requested' where id = new.shelf_item_id;
    return new;
  end if;

  if TG_OP = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'accepted' then
      update public.shelf_items set status = 'on_loan' where id = new.shelf_item_id;
      insert into public.loans (shelf_item_id, loan_request_id, lender_id, borrower_id)
      select new.shelf_item_id, new.id, owner_id, new.requester_id
      from public.shelf_items where id = new.shelf_item_id;
    elsif new.status in ('declined', 'cancelled') then
      update public.shelf_items set status = 'available' where id = new.shelf_item_id;
    end if;
  end if;

  return new;
end;
$$;

create trigger on_loan_request_change
  after insert or update on public.loan_requests
  for each row execute procedure public.handle_loan_request_change();

revoke execute on function public.handle_loan_request_change() from public, anon, authenticated;

-- When a loan is marked returned, free up the shelf item again.
create function public.handle_loan_returned()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.returned_at is not null and old.returned_at is null then
    update public.shelf_items set status = 'available' where id = new.shelf_item_id;
  end if;
  return new;
end;
$$;

create trigger on_loan_returned
  after update on public.loans
  for each row execute procedure public.handle_loan_returned();

revoke execute on function public.handle_loan_returned() from public, anon, authenticated;
