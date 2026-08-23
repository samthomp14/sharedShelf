-- sharedShelf initial schema
-- Run this in the Supabase SQL editor (or via `supabase db push` once the CLI is linked).

-- ============================================================
-- profiles: one row per auth.users, public-ish identity info
-- ============================================================
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique not null,
  display_name text,
  avatar_url text,
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
  using (auth.uid() = id);

create policy "users can insert their own profile"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

-- Auto-create a profile row whenever a new auth user signs up.
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

-- ============================================================
-- books: canonical metadata cache, deduped by ISBN
-- (populated from Open Library / Google Books lookups)
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

alter table public.friendships enable row level security;

create policy "users can see friendships they're part of"
  on public.friendships for select
  to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

create policy "users can request a friendship"
  on public.friendships for insert
  to authenticated
  with check (auth.uid() = requester_id);

create policy "either party can update a friendship (accept/respond)"
  on public.friendships for update
  to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

-- Helper: are two users accepted friends?
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
  created_at timestamptz not null default now()
);

alter table public.shelf_items enable row level security;

create policy "owners can see their own shelf items"
  on public.shelf_items for select
  to authenticated
  using (auth.uid() = owner_id);

create policy "friends can see visible shelf items"
  on public.shelf_items for select
  to authenticated
  using (
    visibility = 'friends'
    and public.are_friends(auth.uid(), owner_id)
  );

create policy "owners manage their own shelf items"
  on public.shelf_items for all
  to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

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

alter table public.loan_requests enable row level security;

create policy "requester or shelf owner can see a loan request"
  on public.loan_requests for select
  to authenticated
  using (
    auth.uid() = requester_id
    or auth.uid() in (
      select owner_id from public.shelf_items where id = shelf_item_id
    )
  );

create policy "friends can request to borrow a visible shelf item"
  on public.loan_requests for insert
  to authenticated
  with check (
    auth.uid() = requester_id
    and exists (
      select 1 from public.shelf_items
      where id = shelf_item_id
        and status = 'available'
        and public.are_friends(auth.uid(), owner_id)
    )
  );

create policy "requester or shelf owner can update a loan request"
  on public.loan_requests for update
  to authenticated
  using (
    auth.uid() = requester_id
    or auth.uid() in (
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

alter table public.loans enable row level security;

create policy "lender or borrower can see a loan"
  on public.loans for select
  to authenticated
  using (auth.uid() = lender_id or auth.uid() = borrower_id);

create policy "lender can create a loan for their own shelf item"
  on public.loans for insert
  to authenticated
  with check (auth.uid() = lender_id);

create policy "lender or borrower can update a loan (e.g. mark returned)"
  on public.loans for update
  to authenticated
  using (auth.uid() = lender_id or auth.uid() = borrower_id);
