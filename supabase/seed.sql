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

-- ============================================================
-- More demo users, books, and shelves — for exercising the app
-- (Activity feed, Search, profile grids) with a fuller dataset
-- than the handful of accounts above. Same throwaway-password
-- pattern; run once on a dev project after the block above.
-- ============================================================

with seed(username, display_name, email) as (
  values
    ('demo_finn', 'Finn Ashworth', 'demo_finn@example.com'),
    ('demo_grace', 'Grace Delgado', 'demo_grace@example.com'),
    ('demo_harper', 'Harper Nakamura', 'demo_harper@example.com'),
    ('demo_ivan', 'Ivan Petrov', 'demo_ivan@example.com'),
    ('demo_jules', 'Jules Okafor', 'demo_jules@example.com'),
    ('demo_kai', 'Kai Sorensen', 'demo_kai@example.com'),
    ('demo_luna', 'Luna Vasquez', 'demo_luna@example.com')
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

with profile_info(username, display_name, bio) as (
  values
    ('demo_alice', 'Alice Chen', 'Fantasy and sci-fi, mostly. Currently rereading the classics.'),
    ('demo_bob', 'Bob Whitfield', 'History nerd. Will talk your ear off about prison abolition.'),
    ('demo_casey', 'Casey Morgan', 'Character studies > plot. Recommend me something quiet.'),
    ('demo_dana', 'Dana Osei', 'Two-book-a-week club, send help (and books).'),
    ('demo_evan', 'Evan Brooks', 'New to the shelf life, building my collection slowly.'),
    ('demo_finn', 'Finn Ashworth', 'Tolkien completionist. Ask me about the appendices.'),
    ('demo_grace', 'Grace Delgado', 'Short story collections are underrated and I will die on this hill.'),
    ('demo_harper', 'Harper Nakamura', 'Currently in my Ishiguro era.'),
    ('demo_ivan', 'Ivan Petrov', 'I read the ending first. Don''t @ me.'),
    ('demo_jules', 'Jules Okafor', 'Baldwin, Morrison, and whatever my book club picks.'),
    ('demo_kai', 'Kai Sorensen', 'Translated fiction only, please and thank you.'),
    ('demo_luna', 'Luna Vasquez', 'Nonfiction nerd — science, nature, the occasional memoir.')
)
update public.profiles p
set display_name = pi.display_name,
    bio = pi.bio
from profile_info pi
where p.username = pi.username;

insert into public.books (title, authors, source)
values
  ('The Left Hand of Darkness', array['Ursula K. Le Guin'], 'manual'),
  ('A Wizard of Earthsea', array['Ursula K. Le Guin'], 'manual'),
  ('The Fellowship of the Ring', array['J.R.R. Tolkien'], 'manual'),
  ('The Two Towers', array['J.R.R. Tolkien'], 'manual'),
  ('Beloved', array['Toni Morrison'], 'manual'),
  ('Song of Solomon', array['Toni Morrison'], 'manual'),
  ('Pride and Prejudice', array['Jane Austen'], 'manual'),
  ('Persuasion', array['Jane Austen'], 'manual'),
  ('Never Let Me Go', array['Kazuo Ishiguro'], 'manual'),
  ('Klara and the Sun', array['Kazuo Ishiguro'], 'manual'),
  ('The Remains of the Day', array['Kazuo Ishiguro'], 'manual'),
  ('Slaughterhouse-Five', array['Kurt Vonnegut'], 'manual'),
  ('Cat''s Cradle', array['Kurt Vonnegut'], 'manual'),
  ('The Bell Jar', array['Sylvia Plath'], 'manual'),
  ('Giovanni''s Room', array['James Baldwin'], 'manual'),
  ('If Beale Street Could Talk', array['James Baldwin'], 'manual'),
  ('Sapiens', array['Yuval Noah Harari'], 'manual'),
  ('Station Eleven', array['Emily St. John Mandel'], 'manual'),
  ('The Night Circus', array['Erin Morgenstern'], 'manual'),
  ('Educated', array['Tara Westover'], 'manual'),
  ('Braiding Sweetgrass', array['Robin Wall Kimmerer'], 'manual'),
  ('The Overstory', array['Richard Powers'], 'manual'),
  ('Convenience Store Woman', array['Sayaka Murata'], 'manual'),
  ('Norwegian Wood', array['Haruki Murakami'], 'manual'),
  ('Kafka on the Shore', array['Haruki Murakami'], 'manual');

with pairs(username, title) as (
  values
    ('demo_alice', 'The Left Hand of Darkness'),
    ('demo_alice', 'A Wizard of Earthsea'),
    ('demo_bob', 'Sapiens'),
    ('demo_bob', 'The Fellowship of the Ring'),
    ('demo_casey', 'Station Eleven'),
    ('demo_casey', 'The Night Circus'),
    ('demo_dana', 'Klara and the Sun'),
    ('demo_dana', 'Never Let Me Go'),
    ('demo_evan', 'Educated'),
    ('demo_evan', 'Braiding Sweetgrass'),
    ('demo_finn', 'The Fellowship of the Ring'),
    ('demo_finn', 'The Two Towers'),
    ('demo_finn', 'Beloved'),
    ('demo_grace', 'Song of Solomon'),
    ('demo_grace', 'The Bell Jar'),
    ('demo_grace', 'Giovanni''s Room'),
    ('demo_harper', 'The Remains of the Day'),
    ('demo_harper', 'If Beale Street Could Talk'),
    ('demo_harper', 'Kafka on the Shore'),
    ('demo_ivan', 'Slaughterhouse-Five'),
    ('demo_ivan', 'Cat''s Cradle'),
    ('demo_ivan', 'Norwegian Wood'),
    ('demo_jules', 'Convenience Store Woman'),
    ('demo_jules', 'Song of Solomon'),
    ('demo_jules', 'The Overstory'),
    ('demo_kai', 'Pride and Prejudice'),
    ('demo_kai', 'Persuasion'),
    ('demo_kai', 'Kafka on the Shore'),
    ('demo_luna', 'Braiding Sweetgrass'),
    ('demo_luna', 'The Overstory'),
    ('demo_luna', 'Sapiens')
),
numbered as (
  select pairs.*, row_number() over () as rn from pairs
)
insert into public.shelf_items (owner_id, book_id, created_at)
select p.id, b.id, now() - (numbered.rn * interval '17 hours')
from numbered
join public.profiles p on p.username = numbered.username
join public.books b on b.title = numbered.title;

-- A web of demo-to-demo friendships (not involving your own account) so
-- profiles you browse via Search have realistic friend counts too.
with demo_pairs(a, b) as (
  values
    ('demo_bob', 'demo_dana'),
    ('demo_casey', 'demo_evan'),
    ('demo_jules', 'demo_kai'),
    ('demo_finn', 'demo_luna'),
    ('demo_alice', 'demo_grace'),
    ('demo_harper', 'demo_ivan'),
    ('demo_bob', 'demo_finn'),
    ('demo_grace', 'demo_jules')
),
numbered as (
  select demo_pairs.*, row_number() over () as rn from demo_pairs
)
insert into public.friendships (requester_id, addressee_id, status, created_at, responded_at)
select pa.id, pb.id, 'accepted',
  now() - (numbered.rn * interval '2 days') - interval '1 hour',
  now() - (numbered.rn * interval '2 days')
from numbered
join public.profiles pa on pa.username = numbered.a
join public.profiles pb on pb.username = numbered.b;
