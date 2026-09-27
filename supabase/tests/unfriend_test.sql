-- Unfriend test. Makes NO lasting changes: ends by raising an exception whose
-- message is the result log, which rolls everything back. Any FAIL line is a
-- problem.
do $t$
declare
  o uuid := gen_random_uuid(); a uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  bk uuid; bk2 uuid; c1 uuid; c2 uuid; c3 uuid; r1 uuid; r2 uuid; rx uuid; l1 uuid;
  n int; ob int; msg text := E'\n'; st text;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
    (o, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz_uo@test.invalid', '{"username":"zz_unf_o"}'),
    (a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz_ua@test.invalid', '{"username":"zz_unf_a"}'),
    (x, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz_ux@test.invalid', '{"username":"zz_unf_x"}');
  insert into public.friendships (requester_id, addressee_id, status) values (o, a, 'accepted'), (o, x, 'accepted');
  insert into public.books (title, source) values ('ZZ Unf', 'manual') returning id into bk;
  insert into public.books (title, source) values ('ZZ Unf 2', 'manual') returning id into bk2;
  insert into public.shelf_items (owner_id, book_id) values (o, bk) returning id into c1;
  insert into public.shelf_items (owner_id, book_id) values (o, bk2) returning id into c2;
  insert into public.shelf_items (owner_id, book_id) values (a, bk) returning id into c3;
  insert into public.loan_requests_v2 (shelf_item_id, book_id, owner_id, requester_id) values (c1, bk, o, a) returning id into r1;
  insert into public.loan_requests_v2 (shelf_item_id, book_id, owner_id, requester_id) values (c3, bk, a, o) returning id into r2;
  insert into public.loan_requests_v2 (shelf_item_id, book_id, owner_id, requester_id) values (c1, bk, o, x) returning id into rx;
  insert into public.loans_v2 (shelf_item_id, book_id, owner_id, borrower_id, handed_over_at) values (c2, bk2, o, a, now()) returning id into l1;
  select count(*) into ob from public.push_outbox;

  -- a unfriends o, as a signed-in user (through RLS).
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from public.friendships where requester_id = o and addressee_id = a;
  get diagnostics n = row_count;
  msg := msg || case when n = 1 then 'ok' else 'FAIL' end || ' delete via RLS rows=' || n || E'\n';
  select count(*) into n from public.shelf_items where owner_id = o;
  msg := msg || case when n = 0 then 'ok' else 'FAIL' end || ' shelf hidden after unfriend, visible=' || n || E'\n';
  select count(*) into n from public.loans_v2 where id = l1;
  msg := msg || case when n = 1 then 'ok' else 'FAIL' end || ' borrower still sees active loan' || E'\n';
  reset role;

  select status into st from public.loan_requests_v2 where id = r1;
  msg := msg || case when st = 'cancelled' then 'ok' else 'FAIL' end || ' a->o request ' || st || E'\n';
  select status into st from public.loan_requests_v2 where id = r2;
  msg := msg || case when st = 'cancelled' then 'ok' else 'FAIL' end || ' o->a request ' || st || E'\n';
  select status into st from public.loan_requests_v2 where id = rx;
  msg := msg || case when st = 'pending' then 'ok' else 'FAIL' end || ' third party request ' || st || E'\n';
  select count(*) into n from public.loans_v2 where id = l1 and ended_at is null;
  msg := msg || case when n = 1 then 'ok' else 'FAIL' end || ' handed-over loan still active' || E'\n';
  select count(*) - ob into n from public.push_outbox;
  msg := msg || case when n = 0 then 'ok' else 'FAIL' end || ' no push rows, new=' || n || E'\n';
  raise exception '%', msg;
end $t$;
