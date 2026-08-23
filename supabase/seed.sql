-- Fake users to search for and add as friends while testing locally.
-- These accounts can't sign in (the password is a throwaway placeholder) —
-- they exist purely as searchable profiles with seeded shelves.
-- Run this in the Supabase SQL editor after schema.sql, on a dev project only.

with seed(username, display_name, email) as (
  values
    ('demo_alice', 'Alice Chen', 'demo_alice@example.com'),
    ('demo_bob', 'Bob Whitfield', 'demo_bob@example.com'),
    ('demo_casey', 'Casey Morgan', 'demo_casey@example.com'),
    ('demo_dana', 'Dana Osei', 'demo_dana@example.com'),
    ('demo_evan', 'Evan Brooks', 'demo_evan@example.com')
)
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current
)
select
  '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
  seed.email, crypt('not-a-real-password-' || seed.username, gen_salt('bf')),
  now(), '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('username', seed.username),
  now(), now(),
  '', '', '', '', ''
from seed;

-- handle_new_user() already created profiles rows via trigger — fill in
-- display names to match.
with names(username, display_name) as (
  values
    ('demo_alice', 'Alice Chen'),
    ('demo_bob', 'Bob Whitfield'),
    ('demo_casey', 'Casey Morgan'),
    ('demo_dana', 'Dana Osei'),
    ('demo_evan', 'Evan Brooks')
)
update public.profiles p
set display_name = n.display_name
from names n
where p.username = n.username;

-- A few books so friending these accounts is actually useful to test with.
insert into public.books (title, authors, isbn, source)
values
  ('Dune', array['Frank Herbert'], '9780441013593', 'manual'),
  ('The Great Gatsby', array['F. Scott Fitzgerald'], '9780743273565', 'manual'),
  ('Piranesi', array['Susanna Clarke'], '9781635575637', 'manual'),
  ('Circe', array['Madeline Miller'], '9780316556347', 'manual'),
  ('The Hobbit', array['J.R.R. Tolkien'], '9780547928227', 'manual')
on conflict (isbn) do nothing;

with u as (select id, username from public.profiles where username like 'demo_%'),
b as (select id, title from public.books)
insert into public.shelf_items (owner_id, book_id)
select u.id, b.id
from u join b on
  (u.username = 'demo_alice' and b.title in ('Dune', 'The Great Gatsby', 'East of Eden'))
  or (u.username = 'demo_bob' and b.title in ('The Hobbit', 'Circe', 'Project Hail Mary'))
  or (u.username = 'demo_casey' and b.title in ('Piranesi', 'A Tree Grows in Brooklyn'))
  or (u.username = 'demo_dana' and b.title in ('The Great Gatsby', 'Dune'));
  -- demo_evan is left with an empty shelf on purpose, to test that state
