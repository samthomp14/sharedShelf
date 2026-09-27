-- ============================================================
-- Unfriending: either person deletes the accepted friendships row (the
-- existing delete policy already allows it). This trigger cancels any
-- pending borrow requests between the two, since the requester can no
-- longer see the copy. Loans already promised or handed over are left
-- alone so the book can still come back and be marked returned.
-- No push goes out: cancelled requests don't notify anyone.
-- ============================================================

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

create trigger on_unfriend
  after delete on public.friendships
  for each row execute procedure public.handle_unfriend();

revoke execute on function public.handle_unfriend() from public, anon, authenticated;
