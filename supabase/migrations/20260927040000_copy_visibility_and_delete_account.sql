-- ============================================================
-- Hide a copy from friends, and delete your own account.
-- ============================================================

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

-- Deletes the caller's account. Everything that belongs to it goes with the
-- auth.users row via on delete cascade (profile, shelf, friendships, loans,
-- requests, invites, push rows). Before that, friends' copies that were
-- promised or lent to this account are freed up, since their loan rows are
-- about to disappear: a promised copy goes back to available; a lent one to
-- unavailable, because the book is still out and the owner should decide.
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

  delete from auth.users where id = v_uid;
end;
$$;

revoke execute on function public.delete_account() from public, anon;
