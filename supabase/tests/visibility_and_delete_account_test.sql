-- set_copy_visibility + delete_account test. Makes NO lasting changes: ends
-- by raising an exception whose message is the result log, which rolls
-- everything back. Any FAIL line is a problem.
do $t$
declare
  o uuid := gen_random_uuid(); a uuid := gen_random_uuid(); d uuid := gen_random_uuid();
  b1 uuid; b2 uuid; b3 uuid; b4 uuid; c1 uuid; c2 uuid; c3 uuid; c4 uuid; cd uuid; r1 uuid;
  n int; st text; msg text := E'\n'; err text;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
    (o, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz_vo@test.invalid', '{"username":"zz_vis_o"}'),
    (a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz_va@test.invalid', '{"username":"zz_vis_a"}'),
    (d, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz_vd@test.invalid', '{"username":"zz_vis_d"}');
  insert into public.friendships (requester_id, addressee_id, status) values (o, a, 'accepted'), (o, d, 'accepted'), (d, a, 'pending');
  insert into public.books (title, source) values ('ZZ Vis 1', 'manual') returning id into b1;
  insert into public.books (title, source) values ('ZZ Vis 2', 'manual') returning id into b2;
  insert into public.books (title, source) values ('ZZ Vis 3', 'manual') returning id into b3;
  insert into public.books (title, source) values ('ZZ Vis 4', 'manual') returning id into b4;
  insert into public.shelf_items (owner_id, book_id) values (o, b1) returning id into c1;
  insert into public.shelf_items (owner_id, book_id) values (o, b2) returning id into c2;
  insert into public.shelf_items (owner_id, book_id) values (o, b3) returning id into c3;
  insert into public.shelf_items (owner_id, book_id) values (o, b4) returning id into c4;
  insert into public.shelf_items (owner_id, book_id) values (d, b1) returning id into cd;
  insert into public.loan_requests_v2 (shelf_item_id, book_id, owner_id, requester_id) values (c1, b1, o, a) returning id into r1;
  -- d has c2 promised and c3 in hand; d also lends cd to o.
  update public.shelf_items set lend_status = 'promised' where id = c2;
  update public.shelf_items set lend_status = 'on_loan' where id in (c3, cd);
  insert into public.loans_v2 (shelf_item_id, book_id, owner_id, borrower_id) values (c2, b2, o, d);
  insert into public.loans_v2 (shelf_item_id, book_id, owner_id, borrower_id, handed_over_at) values (c3, b3, o, d, now());
  insert into public.loans_v2 (shelf_item_id, book_id, owner_id, borrower_id, handed_over_at) values (cd, b1, d, o, now());

  -- visibility, as o
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_copy_visibility(c1, false);
  reset role;
  select status into st from public.loan_requests_v2 where id = r1;
  msg := msg || case when st = 'declined' then 'ok' else 'FAIL' end || ' hiding declines pending request: ' || st || E'\n';
  select visibility into st from public.shelf_items where id = c1;
  msg := msg || case when st = 'private' then 'ok' else 'FAIL' end || ' copy now ' || st || E'\n';

  -- a can't see it or ask for it
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.shelf_items where owner_id = o;
  msg := msg || case when n = 3 then 'ok' else 'FAIL' end || ' friend sees 3 of 4 copies: ' || n || E'\n';
  begin
    perform public.request_loan(c1);
    msg := msg || 'FAIL friend could request hidden copy' || E'\n';
  exception when others then
    msg := msg || 'ok friend cannot request hidden copy' || E'\n';
  end;
  begin
    perform public.set_copy_visibility(c2, false);
    msg := msg || 'FAIL non-owner changed visibility' || E'\n';
  exception when others then
    msg := msg || 'ok non-owner refused' || E'\n';
  end;
  reset role;

  -- o shows it again
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_copy_visibility(c1, true);
  reset role;
  select visibility into st from public.shelf_items where id = c1;
  msg := msg || case when st = 'friends' then 'ok' else 'FAIL' end || ' visible again: ' || st || E'\n';

  -- anon can't delete
  set local role anon;
  begin
    perform public.delete_account();
    msg := msg || 'FAIL anon could call delete_account' || E'\n';
  exception when others then
    msg := msg || 'ok anon refused' || E'\n';
  end;
  reset role;

  -- d deletes their account
  perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.delete_account();
  reset role;
  select count(*) into n from auth.users where id = d;
  msg := msg || case when n = 0 then 'ok' else 'FAIL' end || ' auth user gone' || E'\n';
  select count(*) into n from public.profiles where id = d;
  msg := msg || case when n = 0 then 'ok' else 'FAIL' end || ' profile gone' || E'\n';
  select count(*) into n from public.shelf_items where owner_id = d;
  msg := msg || case when n = 0 then 'ok' else 'FAIL' end || ' shelf gone' || E'\n';
  select count(*) into n from public.friendships where d in (requester_id, addressee_id);
  msg := msg || case when n = 0 then 'ok' else 'FAIL' end || ' friendships gone' || E'\n';
  select count(*) into n from public.loans_v2 where d in (owner_id, borrower_id);
  msg := msg || case when n = 0 then 'ok' else 'FAIL' end || ' loans gone' || E'\n';
  select lend_status::text into st from public.shelf_items where id = c2;
  msg := msg || case when st = 'available' then 'ok' else 'FAIL' end || ' promised copy freed: ' || st || E'\n';
  select lend_status::text into st from public.shelf_items where id = c3;
  msg := msg || case when st = 'unavailable' then 'ok' else 'FAIL' end || ' lent copy now unavailable: ' || st || E'\n';
  select lend_status::text into st from public.shelf_items where id = c4;
  msg := msg || case when st = 'available' then 'ok' else 'FAIL' end || ' untouched copy: ' || st || E'\n';
  select count(*) into n from auth.users where id in (o, a);
  msg := msg || case when n = 2 then 'ok' else 'FAIL' end || ' other users intact' || E'\n';
  raise exception '%', msg;
end $t$;
