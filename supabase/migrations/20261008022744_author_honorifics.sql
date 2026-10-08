-- ============================================================
-- Author names: drop leading honorifics
-- ============================================================
-- "Mr. Cecil Murphey" and "Dr. William James" are the same authors as
-- "Cecil Murphey" and "William James". tidy_author_name now drops a leading
-- Mr/Mrs/Ms/Dr/Prof/Sir (only when a name follows it), and authors whose
-- name_key changes are merged into an existing same-key author.
--
-- Names that differ by a middle initial ("Richard Powers" / "Richard M.
-- Powers") are NOT merged: those are often different people.
-- ============================================================

create or replace function public.tidy_author_name(p text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  n text := btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g'));
  parts text[];
  letters text;
begin
  -- Honorifics: "Mr. Cecil Murphey", "Dr. William James".
  n := regexp_replace(n, '^(mr|mrs|ms|dr|prof|sir)\.?\s+(?=\S+\s)', '', 'i');

  -- Trailing life dates: "B. T. B. 1870-1917", "Orwell, George (1903-1950)", "Smith 1947-".
  n := btrim(regexp_replace(n, ',?\s*\(?\d{3,4}\s*-\s*(\d{3,4})?\)?\.?$', ''));

  -- "Last, First" -> "First Last", unless the part after the comma is a
  -- suffix ("King, Jr.") or the name is something messier.
  parts := regexp_split_to_array(n, '\s*,\s*');
  if array_length(parts, 1) = 2
     and parts[1] <> '' and parts[2] <> ''
     and parts[2] !~* '^(jr|sr|ii|iii|iv|phd|md|esq|inc|ltd|llc|co)\.?$'
     and n !~ '[;()]' then
    n := parts[2] || ' ' || parts[1];
  end if;

  -- ALL CAPS or all lower -> Title Case. "bell hooks" and "e.e. cummings" are lowercase on purpose.
  letters := regexp_replace(n, '[^[:alpha:]]', '', 'g');
  if length(letters) > 3 and (n = upper(n) or n = lower(n)) and lower(n) not in ('bell hooks', 'e.e. cummings', 'e. e. cummings') then
    n := initcap(n);
  end if;

  -- Initials as "J. R. R.": "J.R.R." -> "J. R. R.", "G Orwell" -> "G. Orwell".
  n := regexp_replace(n, '\m([[:upper:]])\.(?=[[:upper:]])', '\1. ', 'g');
  n := regexp_replace(n, '\m([[:upper:]])(?= )', '\1.', 'g');

  return btrim(regexp_replace(n, '\s+', ' ', 'g'));
end;
$$;

-- Re-tidy every author; merge any that now share a key.
create temp table retidy on commit drop as
select id, public.tidy_author_name(name) as name, public.author_name_key(name) as name_key,
       (select count(*) from public.work_authors wa where wa.author_id = a.id) as works
from public.authors a
where public.author_name_key(name) is distinct from name_key or public.tidy_author_name(name) is distinct from name;

create temp table merges on commit drop as
select r.id as from_id, t.id as to_id
from retidy r
join lateral (
  select a.id from public.authors a
  where a.name_key = r.name_key and a.id <> r.id
  order by (select count(*) from public.work_authors wa where wa.author_id = a.id) desc, a.created_at
  limit 1
) t on true;

create temp table merged_works on commit drop as
select distinct wa.work_id from public.work_authors wa join merges m on wa.author_id = m.from_id;

insert into public.work_authors (work_id, author_id, position)
select wa.work_id, m.to_id, wa.position
from public.work_authors wa join merges m on wa.author_id = m.from_id
on conflict do nothing;

delete from public.authors where id in (select from_id from merges);

update public.authors a set name = r.name, name_key = r.name_key
from retidy r
where a.id = r.id;

select public.sync_work_author_names(w.work_id)
from (select work_id from merged_works
      union
      select wa.work_id from public.work_authors wa join retidy r on r.id = wa.author_id) w;
