-- ============================================================
-- Borrower says "I returned it"; the owner confirms or denies.
--
-- Until now only the owner could end a handed-over loan (mark_returned), so a
-- borrower whose owner never answers was stuck with the book forever.
--
--   claim_returned(loan)  borrower: loan stays active, return_claimed_at set.
--                         The borrower's Borrowing list hides it; the owner
--                         sees "<name> says they returned it".
--   mark_returned(loan)   owner confirms (unchanged): loan ends 'returned',
--                         copy -> available.
--   deny_return(loan)     owner: return_claimed_at cleared, loan is back on
--                         the borrower's list.
--
-- A claim is only a flag on the open loan: no new copy or loan state, so
-- nothing else (lend_status, one-active-loan index) has to know about it.
-- ============================================================

alter table public.loans_v2 add column return_claimed_at timestamptz;

alter table public.loans_v2
  add constraint loans_v2_claim_was_handed_over
  check (return_claimed_at is null or handed_over_at is not null);

-- Borrower: "I returned it". Waits on the owner.
create function public.claim_returned(p_loan_id uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  v_loan public.loans_v2;
begin
  v_loan := public._lock_active_loan_v2(p_loan_id);
  if v_loan.borrower_id <> auth.uid() then
    raise exception 'Only the borrower can say they returned a book.' using errcode = '42501';
  end if;
  if v_loan.handed_over_at is null then
    raise exception 'The book hasn''t been handed over yet.' using errcode = '55000';
  end if;
  if v_loan.return_claimed_at is not null then
    raise exception 'You''ve already said you returned this. Waiting for the owner to confirm.'
      using errcode = '55000';
  end if;

  update public.loans_v2 set return_claimed_at = now() where id = p_loan_id;
end;
$$;

-- Owner: "not yet". The loan goes back to the borrower's list.
create function public.deny_return(p_loan_id uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  v_loan public.loans_v2;
begin
  v_loan := public._lock_active_loan_v2(p_loan_id);
  if v_loan.owner_id <> auth.uid() then
    raise exception 'Only the owner can say a book hasn''t come back.' using errcode = '42501';
  end if;
  if v_loan.return_claimed_at is null then
    raise exception 'Nobody has said they returned this.' using errcode = '55000';
  end if;

  update public.loans_v2 set return_claimed_at = null where id = p_loan_id;
end;
$$;

revoke execute on function public.claim_returned(uuid) from public, anon;
revoke execute on function public.deny_return(uuid) from public, anon;
grant execute on function public.claim_returned(uuid) to authenticated;
grant execute on function public.deny_return(uuid) to authenticated;

-- ------------------------------------------------------------
-- Pushes: owner when a return is claimed, borrower when it's denied.
-- ------------------------------------------------------------
alter table public.push_outbox drop constraint push_outbox_kind_check;
alter table public.push_outbox add constraint push_outbox_kind_check check (kind in (
  'borrow_request', 'request_accepted', 'request_declined', 'lent_to_you',
  'hand_off_called_off', 'friend_request', 'friend_accepted', 'invite_joined',
  'return_claimed', 'return_denied'));

create function public.push_on_return_claim()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if new.return_claimed_at is not null and old.return_claimed_at is null then
    insert into public.push_outbox (recipient_id, kind, actor_id, book_id, data)
    values (new.owner_id, 'return_claimed', new.borrower_id, new.book_id,
            jsonb_build_object('loan_id', new.id));
  elsif new.return_claimed_at is null and old.return_claimed_at is not null
        and new.ended_at is null then
    insert into public.push_outbox (recipient_id, kind, actor_id, book_id, data)
    values (new.borrower_id, 'return_denied', new.owner_id, new.book_id,
            jsonb_build_object('loan_id', new.id));
  end if;
  return null;
end;
$$;

create trigger push_on_return_claim
  after update of return_claimed_at on public.loans_v2
  for each row execute procedure public.push_on_return_claim();

revoke execute on function public.push_on_return_claim() from public, anon, authenticated;

-- Badge count: a claimed return waits on the owner (Notifications "Needs you").
create or replace function public.needs_you_count(p_user uuid)
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
  + (select count(*) from public.loans_v2
      where owner_id = p_user and ended_at is null and return_claimed_at is not null)
  + (select count(*) from public.friendships
      where addressee_id = p_user and status = 'pending')
  )::integer;
$$;
