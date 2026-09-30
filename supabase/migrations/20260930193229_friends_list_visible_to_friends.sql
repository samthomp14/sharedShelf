-- ============================================================
-- Friends lists are visible to your friends. The friendships select policy
-- only exposes rows you're part of, so this returns someone's accepted
-- friends to them or to one of their friends, and nothing to anyone else.
-- ============================================================

create function public.friends_of(target uuid)
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
    and ((select auth.uid()) = target or public.are_friends((select auth.uid()), target))
  order by coalesce(p.display_name, p.username);
$$;

revoke execute on function public.friends_of(uuid) from public, anon;
