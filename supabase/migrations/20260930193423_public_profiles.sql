-- ============================================================
-- Public profiles. Off by default (private): only friends see your shelf
-- and friends list. Public: any signed-in user can see both. Friend
-- requests still need accepting, and borrowing stays friends-only
-- (request_loan already checks are_friends). Copies you've hidden stay
-- hidden either way.
--
-- shelf_items RLS is unchanged, so the Activity feed and book pages keep
-- showing friends' copies only. Other people's shelves are read through
-- profile_shelf instead.
-- ============================================================

alter table public.profiles add column is_public boolean not null default false;

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
