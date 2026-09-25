-- Lending v2 step-function / RLS test. Makes NO lasting changes:
-- it creates throwaway users/books/copies and ends by raising an exception
-- whose message is the full result log, which aborts (rolls back) everything.
--
-- Run this file on its own (SQL editor or execute_sql). Read the results from
-- the error message; any line starting with FAIL is a problem.
do $t$
declare
  o uuid := gen_random_uuid(); a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid();
  bk uuid; c1 uuid; c2 uuid; c3 uuid; c4 uuid;
  ra uuid; rb uuid; r3 uuid; lid uuid; l2 uuid; l3 uuid; l4 uuid;
  n int; s text; msg text := E'\n';
begin
  -- baseline: live copy states
  select string_agg(lend_status || '=' || cnt, ', ') into s from (select lend_status, count(*) cnt from public.shelf_items group by 1) x;
  msg := msg || 'real lend_status: ' || s || E'\n';

  -- fixtures (as postgres)
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
    (o, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz_o@test.invalid', '{"username":"zz_test_o"}'),
    (a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz_a@test.invalid', '{"username":"zz_test_a"}'),
    (b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz_b@test.invalid', '{"username":"zz_test_b"}'),
    (c, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz_c@test.invalid', '{"username":"zz_test_c"}');
  insert into public.friendships (requester_id, addressee_id, status) values (o, a, 'accepted'), (b, o, 'accepted'), (a, b, 'accepted');
  insert into public.books (title, source) values ('ZZ Test Book', 'manual') returning id into bk;
  insert into public.shelf_items (owner_id, book_id) values (o, bk) returning id into c1;
  insert into public.books (title, source) values ('ZZ Test Book 2', 'manual') returning id into bk;
  insert into public.shelf_items (owner_id, book_id) values (o, bk) returning id into c2;
  insert into public.books (title, source) values ('ZZ Test Book 3', 'manual') returning id into bk;
  insert into public.shelf_items (owner_id, book_id) values (o, bk) returning id into c3;
  insert into public.books (title, source) values ('ZZ Test Book 4', 'manual') returning id into bk;
  insert into public.shelf_items (owner_id, book_id) values (o, bk) returning id into c4;

  -- ===== 1. requests =====
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  ra := public.request_loan(c1);
  select lend_status into s from public.shelf_items where id = c1;
  msg := msg || '1a A request ok, copy=' || s || E'\n';
  begin perform public.request_loan(c1); msg := msg || 'FAIL 1b dup allowed' || E'\n';
  exception when others then msg := msg || '1b dup -> ' || sqlstate || ' ' || sqlerrm || E'\n'; end;
  -- A cannot accept own request
  begin perform public.accept_request(ra); msg := msg || 'FAIL 1c requester accepted' || E'\n';
  exception when others then msg := msg || '1c requester accept -> ' || sqlstate || ' ' || sqlerrm || E'\n'; end;
  -- RLS: A cannot write directly
  begin insert into public.loan_requests_v2 (shelf_item_id, book_id, owner_id, requester_id) select c1, book_id, o, a from public.shelf_items where id = c1; msg := msg || 'FAIL 1d direct insert' || E'\n';
  exception when others then msg := msg || '1d direct insert -> ' || sqlstate || ' ' || sqlerrm || E'\n'; end;
  begin update public.loan_requests_v2 set status = 'accepted' where id = ra; get diagnostics n = row_count; msg := msg || 'FAIL? 1e direct update rows=' || n || E'\n';
  exception when others then msg := msg || '1e direct update -> ' || sqlstate || ' ' || sqlerrm || E'\n'; end;

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  rb := public.request_loan(c1);
  msg := msg || '1f B request ok (two pending on one copy)' || E'\n';
  select count(*) into n from public.loan_requests_v2; msg := msg || '1g B sees requests: ' || n || E'\n';
  begin perform public.cancel_request(ra); msg := msg || 'FAIL 1h B cancelled A' || E'\n';
  exception when others then msg := msg || '1h B cancel A -> ' || sqlstate || ' ' || sqlerrm || E'\n'; end;

  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  begin perform public.request_loan(c1); msg := msg || 'FAIL 1i non-friend requested' || E'\n';
  exception when others then msg := msg || '1i non-friend -> ' || sqlstate || ' ' || sqlerrm || E'\n'; end;
  select count(*) into n from public.loan_requests_v2; msg := msg || '1j C sees requests: ' || n || E'\n';

  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  begin perform public.request_loan(c1); msg := msg || 'FAIL 1k own copy' || E'\n';
  exception when others then msg := msg || '1k own copy -> ' || sqlstate || ' ' || sqlerrm || E'\n'; end;
  select count(*) into n from public.loan_requests_v2; msg := msg || '1l O sees requests: ' || n || E'\n';
  begin update public.shelf_items set lend_status = 'on_loan' where id = c1; msg := msg || 'FAIL 1m owner patched lend_status' || E'\n';
  exception when others then msg := msg || '1m owner patch lend_status -> ' || sqlstate || ' ' || sqlerrm || E'\n'; end;
  update public.shelf_items set sort_order = 7 where id = c1; get diagnostics n = row_count;
  msg := msg || '1n owner sort_order update still works rows=' || n || E'\n';

  -- ===== 2. accept -> promised, others declined; handed over; returned =====
  lid := public.accept_request(ra);
  select lend_status into s from public.shelf_items where id = c1;
  msg := msg || '2a accept ok copy=' || s || ' B req=' || (select status from public.loan_requests_v2 where id = rb) || E'\n';
  begin perform public.decline_request(rb); msg := msg || 'FAIL 2b declined twice' || E'\n';
  exception when others then msg := msg || '2b decline answered -> ' || sqlstate || ' ' || sqlerrm || E'\n'; end;
  begin perform public.mark_returned(lid); msg := msg || 'FAIL 2c returned before handover' || E'\n';
  exception when others then msg := msg || '2c return before handover -> ' || sqlstate || ' ' || sqlerrm || E'\n'; end;

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  begin perform public.request_loan(c1); msg := msg || 'FAIL 2d requested promised copy' || E'\n';
  exception when others then msg := msg || '2d request promised -> ' || sqlstate || ' ' || sqlerrm || E'\n'; end;
  select count(*) into n from public.loans_v2; msg := msg || '2e B sees loans: ' || n || E'\n';
  select lend_status into s from public.shelf_items where id = c1; msg := msg || '2f B (friend) sees copy status: ' || coalesce(s, 'null') || E'\n';
  begin perform public.mark_handed_over(lid); msg := msg || 'FAIL 2g B handed over' || E'\n';
  exception when others then msg := msg || '2g stranger handover -> ' || sqlstate || ' ' || sqlerrm || E'\n'; end;

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform public.mark_handed_over(lid);
  select lend_status into s from public.shelf_items where id = c1;
  msg := msg || '2h A got it, copy=' || s || ' handed=' || ((select handed_over_at from public.loans_v2 where id = lid) is not null) || E'\n';
  begin perform public.mark_handed_over(lid); msg := msg || 'FAIL 2i handed twice' || E'\n';
  exception when others then msg := msg || '2i handover twice -> ' || sqlstate || ' ' || sqlerrm || E'\n'; end;
  begin perform public.call_off_loan(lid); msg := msg || 'FAIL 2j call off after handover' || E'\n';
  exception when others then msg := msg || '2j call off after handover -> ' || sqlstate || ' ' || sqlerrm || E'\n'; end;
  begin perform public.mark_returned(lid); msg := msg || 'FAIL 2k borrower returned' || E'\n';
  exception when others then msg := msg || '2k borrower return -> ' || sqlstate || ' ' || sqlerrm || E'\n'; end;

  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  perform public.mark_returned(lid);
  select lend_status into s from public.shelf_items where id = c1;
  msg := msg || '2l returned copy=' || s || ' reason=' || (select ended_reason from public.loans_v2 where id = lid) || E'\n';
  begin perform public.mark_returned(lid); msg := msg || 'FAIL 2m returned twice' || E'\n';
  exception when others then msg := msg || '2m return twice -> ' || sqlstate || ' ' || sqlerrm || E'\n'; end;

  -- ===== 3. lend_to_friend =====
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  ra := public.request_loan(c2);
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  begin perform public.lend_to_friend(c2, c); msg := msg || 'FAIL 3a lent to non-friend' || E'\n';
  exception when others then msg := msg || '3a lend non-friend -> ' || sqlstate || ' ' || sqlerrm || E'\n'; end;
  l2 := public.lend_to_friend(c2, b);
  select lend_status into s from public.shelf_items where id = c2;
  msg := msg || '3b lend to B copy=' || s || ' A req=' || (select status from public.loan_requests_v2 where id = ra) || ' handed=' || ((select handed_over_at from public.loans_v2 where id = l2) is not null) || E'\n';
  begin perform public.set_copy_available(c2, false); msg := msg || 'FAIL 3c toggled on-loan copy' || E'\n';
  exception when others then msg := msg || '3c toggle on-loan -> ' || sqlstate || ' ' || sqlerrm || E'\n'; end;
  begin perform public.lend_to_friend(c2, a); msg := msg || 'FAIL 3d double lend' || E'\n';
  exception when others then msg := msg || '3d lend on-loan copy -> ' || sqlstate || ' ' || sqlerrm || E'\n'; end;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  begin perform public.lend_to_friend(c2, b); msg := msg || 'FAIL 3e non-owner lent' || E'\n';
  exception when others then msg := msg || '3e non-owner lend -> ' || sqlstate || ' ' || sqlerrm || E'\n'; end;

  -- ===== 4. call off (by borrower) =====
  r3 := public.request_loan(c3);
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  l3 := public.accept_request(r3);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform public.call_off_loan(l3);
  select lend_status into s from public.shelf_items where id = c3;
  msg := msg || '4a A called off, copy=' || s || ' reason=' || (select ended_reason || ' by_borrower=' || (ended_by = a) from public.loans_v2 where id = l3) || E'\n';
  begin perform public.call_off_loan(l3); msg := msg || 'FAIL 4b called off twice' || E'\n';
  exception when others then msg := msg || '4b call off twice -> ' || sqlstate || ' ' || sqlerrm || E'\n'; end;
  -- owner calls off
  r3 := public.request_loan(c3);
  perform public.cancel_request(r3);
  msg := msg || '4c A cancel -> ' || (select status from public.loan_requests_v2 where id = r3) || E'\n';
  begin perform public.cancel_request(r3); msg := msg || 'FAIL 4d cancel twice' || E'\n';
  exception when others then msg := msg || '4d cancel twice -> ' || sqlstate || ' ' || sqlerrm || E'\n'; end;
  r3 := public.request_loan(c3);
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  l3 := public.accept_request(r3);
  perform public.call_off_loan(l3);
  msg := msg || '4e O called off, copy=' || (select lend_status from public.shelf_items where id = c3) || E'\n';

  -- ===== 5. set_copy_available =====
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  rb := public.request_loan(c3);
  begin perform public.set_copy_available(c3, false); msg := msg || 'FAIL 5a non-owner toggled' || E'\n';
  exception when others then msg := msg || '5a non-owner toggle -> ' || sqlstate || ' ' || sqlerrm || E'\n'; end;
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  perform public.set_copy_available(c3, false);
  msg := msg || '5b unavailable copy=' || (select lend_status from public.shelf_items where id = c3) || ' B req=' || (select status from public.loan_requests_v2 where id = rb) || E'\n';
  begin perform public.decline_request(rb); msg := msg || 'FAIL 5c' || E'\n';
  exception when others then msg := msg || '5c decline declined -> ' || sqlstate || ' ' || sqlerrm || E'\n'; end;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  begin perform public.request_loan(c3); msg := msg || 'FAIL 5d requested unavailable' || E'\n';
  exception when others then msg := msg || '5d request unavailable -> ' || sqlstate || ' ' || sqlerrm || E'\n'; end;
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  perform public.set_copy_available(c3, true);
  msg := msg || '5e back to ' || (select lend_status from public.shelf_items where id = c3) || E'\n';
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  rb := public.request_loan(c3);
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  perform public.decline_request(rb);
  msg := msg || '5f O declined -> ' || (select status from public.loan_requests_v2 where id = rb) || E'\n';

  -- ===== 6. removal ends the loan =====
  l4 := public.lend_to_friend(c4, a);
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  rb := public.request_loan(c3);
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  delete from public.shelf_items where id in (c4, c3); get diagnostics n = row_count;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  select 'deleted=' || n || ' reason=' || ended_reason || ' item_null=' || (shelf_item_id is null) || ' book=' || (select title from public.books where id = l.book_id) || ' owner=' || (select username from public.profiles where id = l.owner_id)
    into s from public.loans_v2 l where id = l4;
  msg := msg || '6a A sees removed loan: ' || coalesce(s, 'NOT VISIBLE') || E'\n';
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  msg := msg || '6b B pending req on removed copy -> ' || coalesce((select status::text from public.loan_requests_v2 where id = rb), 'NOT VISIBLE') || E'\n';

  -- ===== 7. anon =====
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin perform public.request_loan(c1); msg := msg || 'FAIL 7a anon called' || E'\n';
  exception when others then msg := msg || '7a anon rpc -> ' || sqlstate || ' ' || sqlerrm || E'\n'; end;
  begin perform count(*) from public.loans_v2; msg := msg || 'FAIL 7b anon read' || E'\n';
  exception when others then msg := msg || '7b anon select -> ' || sqlstate || ' ' || sqlerrm || E'\n'; end;

  raise exception 'TEST RESULTS (rolled back): %', msg;
end
$t$;
