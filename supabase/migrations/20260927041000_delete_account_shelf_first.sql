-- delete_account: remove the caller's shelf before the auth.users row. The
-- per-copy removal trigger (handle_shelf_item_removed_v2) stamps ended_by
-- with the owner, which fails if it runs mid-cascade after the profile is
-- already gone.
create or replace function public.delete_account()
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
