-- Push notifications outbox / RLS test. Makes NO lasting changes: it creates
-- throwaway users/books/copies and ends by raising an exception whose message
-- is the result log, which rolls everything back.
--
-- Run on its own after the push_notifications migration (or appended to it
-- as a dry run). Any line starting with FAIL is a problem.
do $t$
declare
  o uuid := gen_random_uuid(); a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid();
  bk uuid; c1 uuid; c2 uuid; c3 uuid; c4 uuid;
  ra uuid; rb uuid; rd uuid; lid uuid;
  n int; got text; msg text := E'\n';
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
    (o, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz_po@test.invalid', '{"username":"zz_push_o"}'),
    (a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz_pa@test.invalid', '{"username":"zz_push_a"}'),
    (b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz_pb@test.invalid', '{"username":"zz_push_b"}'),
    (c, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz_pc@test.invalid', '{"username":"zz_push_c"}');
  insert into public.friendships (requester_id, addressee_id, status) values (o, a, 'accepted'), (b, o, 'accepted');
  insert into public.books (title, source) values ('ZZ Push Book 1', 'manual') returning id into bk;
  insert into public.shelf_items (owner_id, book_id) values (o, bk) returning id into c1;
  insert into public.books (title, source) values ('ZZ Push Book 2', 'manual') returning id into bk;
  insert into public.shelf_items (owner_id, book_id) values (o, bk) returning id into c2;
  insert into public.books (title, source) values ('ZZ Push Book 3', 'manual') returning id into bk;
  insert into public.shelf_items (owner_id, book_id) values (o, bk) returning id into c3;
  insert into public.books (title, source) values ('ZZ Push Book 4', 'manual') returning id into bk;
  insert into public.shelf_items (owner_id, book_id) values (o, bk) returning id into c4;

  -- Fixture friendships were inserted accepted, so they logged invite_joined.
  select count(*) into n from public.push_outbox where recipient_id in (o, b) and kind = 'invite_joined';
  msg := msg || case when n = 2 then 'ok  ' else 'FAIL ' end || 'accepted-on-insert friendships -> invite_joined (' || n || E')\n';
  delete from public.push_outbox where recipient_id in (o, a, b, c);

  perform set_config('role', 'authenticated', true);

  -- a and b both ask for c1; b asks for c2; a asks for c4.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  ra := public.request_loan(c1);
  perform public.request_loan(c4);
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  rb := public.request_loan(c1);
  rd := public.request_loan(c2);

  -- clients can't see the outbox
  begin
    perform 1 from public.push_outbox;
    msg := msg || E'FAIL client can read push_outbox\n';
  exception when insufficient_privilege then
    msg := msg || E'ok  client can''t read push_outbox\n';
  end;

  -- subscriptions: own row ok, someone else's refused
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, site)
  values (b, 'https://push.test.invalid/b', 'k', 'x', 'staging');
  begin
    insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
    values (a, 'https://push.test.invalid/a', 'k', 'x');
    msg := msg || E'FAIL could insert a subscription for someone else\n';
  exception when insufficient_privilege then
    msg := msg || E'ok  can''t insert a subscription for someone else\n';
  end;

  -- o: accept a's request on c1 (b's is bulk-declined), decline b's on c2,
  -- make c4 unavailable (a's request there bulk-declined), lend c3 to a.
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  lid := public.accept_request(ra);
  perform public.decline_request(rd);
  perform public.set_copy_available(c4, false);
  perform public.lend_to_friend(c3, a);

  -- a calls off the c1 hand-off.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform public.call_off_loan(lid);

  -- c sends o a friend request; o accepts.
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  insert into public.friendships (requester_id, addressee_id) values (c, o);
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  update public.friendships set status = 'accepted', responded_at = now() where requester_id = c and addressee_id = o;

  perform set_config('role', 'postgres', true);

  select string_agg(x, ', ' order by x) into got from (
    select kind || ':' || case recipient_id when o then 'o' when a then 'a' when b then 'b' when c then 'c' end
           || '<-' || case actor_id when o then 'o' when a then 'a' when b then 'b' when c then 'c' else '?' end as x
    from public.push_outbox where recipient_id in (o, a, b, c)) s;
  msg := msg || case when got =
    'borrow_request:o<-a, borrow_request:o<-a, borrow_request:o<-b, borrow_request:o<-b, friend_accepted:c<-o, friend_request:o<-c, hand_off_called_off:o<-a, lent_to_you:a<-o, request_accepted:a<-o, request_declined:b<-o'
    then 'ok  ' else 'FAIL ' end || 'outbox: ' || coalesce(got, '(empty)') || E'\n';

  -- needs_you_count(o): nothing pending now (all answered), so 0.
  n := public.needs_you_count(o);
  msg := msg || case when n = 0 then 'ok  ' else 'FAIL ' end || 'needs_you_count(o) = ' || n || E'\n';

  raise exception 'push test results (rolled back):%', msg;
end;
$t$;
