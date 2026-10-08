-- ============================================================
-- Authors as real rows
-- ============================================================
-- Until now an author was just a name in books.authors (book_authors is a
-- search index over those names). The same person showed up under several
-- spellings ("Stephen King" / "Stephen king", "J.R.R. Tolkien" /
-- "J. R. R. Tolkien"), each with its own author page.
--
--   * authors — one row per person. name is the display name; name_key is
--     a normalized form used to match spellings; ol_author_id is Open
--     Library's id once known, which is what really tells people apart.
--   * work_authors — who wrote each work, in credit order. Authorship
--     belongs to the work, not the edition.
--   * tidy_author_name — the cleanup rules every name goes through:
--     whitespace, trailing life dates, "Last, First", ALL CAPS / all lower,
--     initials as "J. R. R.".
--
-- books.authors and book_authors stay (expand/contract), now rewritten to
-- the canonical names so search and older app code agree with the new
-- tables. scripts/backfill-author-ids.mjs then attaches Open Library ids,
-- which merges spellings a name match can't (村上春樹 / Haruki Murakami).
-- ============================================================

-- ------------------------------------------------------------
-- Name cleanup
-- ------------------------------------------------------------
create function public.tidy_author_name(p text)
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

-- Matching form of a name: tidied, lowercased, letters and digits only.
create function public.author_name_key(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(regexp_replace(public.tidy_author_name(p), '[^[:alpha:][:digit:]]', '', 'g'));
$$;

-- A name list, tidied, with blanks and same-person repeats dropped.
create function public.tidy_author_list(p text[])
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(name order by ord), '{}')
  from (
    select distinct on (public.author_name_key(x)) public.tidy_author_name(x) as name, ord
    from unnest(coalesce(p, '{}'::text[])) with ordinality as u (x, ord)
    where public.author_name_key(x) <> ''
    order by public.author_name_key(x), ord
  ) d;
$$;

-- ------------------------------------------------------------
-- authors / work_authors
-- ------------------------------------------------------------
create table public.authors (
  id uuid primary key default gen_random_uuid(),
  name text not null check (name <> ''),
  name_key text not null check (name_key <> ''),
  ol_author_id text unique check (ol_author_id ~ '^OL[0-9]+A$'),
  created_at timestamptz not null default now()
);

-- Not unique: two different people can share a name (their OL ids differ).
create index authors_name_key_idx on public.authors (name_key);
create index authors_name_trgm_idx on public.authors using gin (name gin_trgm_ops);

alter table public.authors enable row level security;

create policy "authors are readable by any authenticated user"
  on public.authors for select
  to authenticated
  using (true);

create table public.work_authors (
  work_id uuid not null references public.works (id) on delete cascade,
  author_id uuid not null references public.authors (id) on delete cascade,
  position smallint not null default 0,
  primary key (work_id, author_id)
);

create index work_authors_author_id_idx on public.work_authors (author_id);

alter table public.work_authors enable row level security;

create policy "work authors are readable by any authenticated user"
  on public.work_authors for select
  to authenticated
  using (true);

-- No write policies on either: only the functions below write them.

-- ------------------------------------------------------------
-- resolve_author: the author row for a name (and OL id, when known).
--   * known OL id -> that author.
--   * OL id given, new -> claim a same-name author that has no OL id yet
--     (and take the given spelling), else a new author.
--   * no OL id -> a same-name author (preferring one with works), else new.
-- ------------------------------------------------------------
create function public.resolve_author(p_name text, p_ol_author_id text default null)
returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  v_name text := public.tidy_author_name(p_name);
  v_key text := public.author_name_key(p_name);
  v_ol text := nullif(p_ol_author_id, '');
  v_id uuid;
begin
  if v_key = '' then
    return null;
  end if;

  if v_ol is not null then
    select id into v_id from public.authors where ol_author_id = v_ol;
    if v_id is not null then
      return v_id;
    end if;
    select id into v_id from public.authors
    where name_key = v_key and ol_author_id is null
    order by created_at
    limit 1;
    if v_id is not null then
      update public.authors set ol_author_id = v_ol, name = v_name where id = v_id;
      return v_id;
    end if;
  else
    select a.id into v_id from public.authors a
    where a.name_key = v_key
    order by exists (select 1 from public.work_authors wa where wa.author_id = a.id) desc, a.created_at
    limit 1;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  insert into public.authors (name, name_key, ol_author_id)
  values (v_name, v_key, v_ol)
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.resolve_author(text, text) from public, anon, authenticated;

-- ------------------------------------------------------------
-- set_work_authors: who wrote a work. p_authors is
-- [{ "name": "...", "ol_author_id": "OL..A"? }, ...] in credit order.
-- p_replace = false only fills a work that has no authors yet. Afterwards
-- every edition's books.authors is rewritten to the canonical names, and
-- authors left with no works are removed.
-- ------------------------------------------------------------
create function public.set_work_authors(p_work_id uuid, p_authors jsonb, p_replace boolean default true)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  v_old uuid[];
  v_item jsonb;
  v_pos int := 0;
  v_author uuid;
begin
  if jsonb_typeof(p_authors) is distinct from 'array' or jsonb_array_length(p_authors) = 0 then
    return;
  end if;
  if not p_replace and exists (select 1 from public.work_authors where work_id = p_work_id) then
    return;
  end if;

  select coalesce(array_agg(author_id), '{}') into v_old from public.work_authors where work_id = p_work_id;
  delete from public.work_authors where work_id = p_work_id;

  for v_item in select * from jsonb_array_elements(p_authors) loop
    v_author := public.resolve_author(v_item ->> 'name', v_item ->> 'ol_author_id');
    continue when v_author is null;
    insert into public.work_authors (work_id, author_id, position)
    values (p_work_id, v_author, v_pos)
    on conflict do nothing;
    v_pos := v_pos + 1;
  end loop;

  perform public.sync_work_author_names(p_work_id);

  delete from public.authors a
  where a.id = any (v_old)
    and not exists (select 1 from public.work_authors wa where wa.author_id = a.id);
end;
$$;

-- Rewrites works.authors and every edition's books.authors to the
-- canonical names, in credit order (keeps book_authors search in step).
create function public.sync_work_author_names(p_work_id uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  v_names text[];
begin
  select coalesce(array_agg(a.name order by wa.position), '{}') into v_names
  from public.work_authors wa
  join public.authors a on a.id = wa.author_id
  where wa.work_id = p_work_id;
  if cardinality(v_names) = 0 then
    return;
  end if;
  update public.works set authors = v_names where id = p_work_id and authors is distinct from v_names;
  update public.books set authors = v_names where work_id = p_work_id and authors is distinct from v_names;
end;
$$;

revoke execute on function public.set_work_authors(uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.set_work_authors(uuid, jsonb, boolean) to service_role;
revoke execute on function public.sync_work_author_names(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------
-- Triggers on books
-- ------------------------------------------------------------

-- Every name that comes in is tidied (fires before on_book_insert_ensure_work,
-- so placeholder works get the tidy names too: triggers run by name).
create function public.tidy_book_authors()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  new.authors := public.tidy_author_list(new.authors);
  return new;
end;
$$;

create trigger on_book_authors_tidy
  before insert or update of authors on public.books
  for each row execute procedure public.tidy_book_authors();

revoke execute on function public.tidy_book_authors() from public, anon, authenticated;

-- A new book's work with no authors yet gets them from the book's names.
create function public.link_new_book_authors()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if new.work_id is not null and cardinality(new.authors) > 0 then
    perform public.set_work_authors(
      new.work_id,
      (select jsonb_agg(jsonb_build_object('name', x) order by ord)
       from unnest(new.authors) with ordinality as u (x, ord)),
      false
    );
  end if;
  return new;
end;
$$;

create trigger on_book_insert_link_authors
  after insert on public.books
  for each row execute procedure public.link_new_book_authors();

revoke execute on function public.link_new_book_authors() from public, anon, authenticated;

-- ------------------------------------------------------------
-- link_book_to_work: same as before, plus p_work.author_list
-- ([{name, ol_author_id}], from Open Library) replaces the work's authors.
-- ------------------------------------------------------------
create or replace function public.link_book_to_work(p_book_id uuid, p_work jsonb, p_edition jsonb default '{}')
returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  v_book public.books;
  v_target uuid;
  v_old uuid;
  v_ol text := nullif(p_work ->> 'ol_work_id', '');
  v_isbn text := public.normalize_isbn(nullif(p_edition ->> 'isbn', ''));
begin
  select * into v_book from public.books where id = p_book_id for update;
  if v_book.id is null then
    raise exception 'Book not found.' using errcode = 'P0002';
  end if;
  v_old := v_book.work_id;

  if v_ol is not null then
    select id into v_target from public.works where ol_work_id = v_ol;
    if v_target is null then
      update public.works set ol_work_id = v_ol where id = v_old and ol_work_id is null;
      if found then
        v_target := v_old;
      else
        insert into public.works (ol_work_id, title, authors)
        values (v_ol, coalesce(nullif(p_work ->> 'title', ''), v_book.title), v_book.authors)
        returning id into v_target;
      end if;
    end if;
  else
    v_target := v_old;
  end if;

  update public.works w set
    subtitle = coalesce(w.subtitle, nullif(p_work ->> 'subtitle', '')),
    authors = case when cardinality(w.authors) = 0 and p_work ? 'authors'
                then array(select jsonb_array_elements_text(p_work -> 'authors')) else w.authors end,
    description = coalesce(w.description, nullif(p_work ->> 'description', '')),
    first_publish_year = coalesce(w.first_publish_year, (p_work ->> 'first_publish_year')::int),
    categories = case when cardinality(w.categories) = 0 and p_work ? 'categories'
                   then array(select jsonb_array_elements_text(p_work -> 'categories')) else w.categories end,
    cover_url = coalesce(w.cover_url, nullif(p_work ->> 'cover_url', '')),
    description_checked_at = case when (p_work ->> 'description_checked')::boolean
                               then coalesce(w.description_checked_at, now()) else w.description_checked_at end
  where w.id = v_target;

  update public.books b set
    work_id = v_target,
    isbn = case when b.isbn is null and v_isbn is not null
                 and not exists (select 1 from public.books o where o.isbn = v_isbn)
               then v_isbn else b.isbn end,
    publisher = coalesce(b.publisher, nullif(p_edition ->> 'publisher', '')),
    page_count = coalesce(b.page_count, (p_edition ->> 'page_count')::int),
    language = coalesce(b.language, nullif(p_edition ->> 'language', '')),
    cover_url = coalesce(b.cover_url, nullif(p_edition ->> 'cover_url', '')),
    enriched_at = now()
  where b.id = p_book_id;

  if v_old is distinct from v_target then
    delete from public.works w
    where w.id = v_old and not exists (select 1 from public.books b where b.work_id = v_old);
  end if;

  if jsonb_typeof(p_work -> 'author_list') = 'array' then
    perform public.set_work_authors(v_target, p_work -> 'author_list', true);
  else
    perform public.sync_work_author_names(v_target);
  end if;

  return v_target;
end;
$$;

-- ------------------------------------------------------------
-- seed_catalog: same as before, plus each element's optional author_list
-- ([{name, ol_author_id}]) becomes the work's authors.
-- ------------------------------------------------------------
create or replace function public.seed_catalog(p_works jsonb)
returns int
language plpgsql
security definer set search_path = ''
as $$
declare
  v_item jsonb;
  v_work uuid;
  v_isbn text;
  v_added int := 0;
  v_rows int;
begin
  for v_item in select * from jsonb_array_elements(p_works) loop
    v_isbn := public.normalize_isbn(v_item #>> '{edition,isbn}');
    continue when v_isbn is null or nullif(btrim(v_item ->> 'title'), '') is null;
    continue when exists (select 1 from public.books where isbn = v_isbn);

    select id into v_work from public.works where ol_work_id = v_item ->> 'ol_work_id';
    if v_work is not null then
      continue;
    end if;

    insert into public.works (ol_work_id, title, subtitle, authors, first_publish_year, categories, cover_url)
    values (
      v_item ->> 'ol_work_id',
      btrim(v_item ->> 'title'),
      nullif(v_item ->> 'subtitle', ''),
      public.tidy_author_list(array(select jsonb_array_elements_text(coalesce(v_item -> 'authors', '[]')))),
      (v_item ->> 'first_publish_year')::int,
      array(select jsonb_array_elements_text(coalesce(v_item -> 'categories', '[]'))),
      nullif(v_item ->> 'cover_url', '')
    )
    on conflict (ol_work_id) do nothing
    returning id into v_work;
    continue when v_work is null;

    -- Authors first, so the book insert below finds them already set.
    if jsonb_typeof(v_item -> 'author_list') = 'array' then
      perform public.set_work_authors(v_work, v_item -> 'author_list', true);
    end if;

    insert into public.books (isbn, title, authors, cover_url, source, work_id, publisher, page_count, language, enriched_at)
    values (
      v_isbn,
      btrim(v_item ->> 'title'),
      coalesce(
        (select array_agg(a.name order by wa.position) from public.work_authors wa
         join public.authors a on a.id = wa.author_id where wa.work_id = v_work),
        array(select jsonb_array_elements_text(coalesce(v_item -> 'authors', '[]')))
      ),
      coalesce(nullif(v_item #>> '{edition,cover_url}', ''), nullif(v_item ->> 'cover_url', '')),
      'open_library',
      v_work,
      nullif(v_item #>> '{edition,publisher}', ''),
      (v_item #>> '{edition,page_count}')::int,
      nullif(v_item #>> '{edition,language}', ''),
      now()
    )
    on conflict (isbn) do nothing;
    get diagnostics v_rows = row_count;
    v_added := v_added + v_rows;
  end loop;
  return v_added;
end;
$$;

-- ------------------------------------------------------------
-- Backfill from names (no API calls). One author per name_key; the display
-- name is the spelling used most, preferring proper case over ALL CAPS /
-- all lower.
-- ------------------------------------------------------------
create temp table name_uses on commit drop as
select x as raw, public.tidy_author_name(x) as name, public.author_name_key(x) as name_key, w.id as work_id, ord
from public.works w,
     unnest(case when cardinality(w.authors) > 0 then w.authors
                 else (select b.authors from public.books b where b.work_id = w.id limit 1) end)
       with ordinality as u (x, ord)
where public.author_name_key(x) <> '';

-- Flags are taken from the spelling as typed, so "Stephen king" loses to
-- "Stephen King" even though tidy leaves both mixed-case.
insert into public.authors (name, name_key)
select distinct on (name_key) name, name_key
from (
  select name, name_key, count(*) as uses, bool_or(proper) as proper, bool_or(capitalized) as capitalized
  from (
    select name, name_key,
           (raw <> upper(raw) and raw <> lower(raw)) as proper,
           -- every word capitalized, or a particle like "de", "van"
           lower(raw) in ('bell hooks', 'e.e. cummings', 'e. e. cummings')
             or (select bool_and(word ~ '^[[:upper:]]' or word ~ '^(de|da|di|du|van|von|der|den|le|la|del|bin|al|of|and|the)$')
                 from regexp_split_to_table(name, ' ') as word) as capitalized
    from name_uses
  ) r
  group by name, name_key
) v
order by name_key, capitalized desc, proper desc, uses desc, name;

insert into public.work_authors (work_id, author_id, position)
select distinct on (u.work_id, a.id) u.work_id, a.id, (u.ord - 1)::smallint
from name_uses u
join public.authors a on a.name_key = u.name_key
order by u.work_id, a.id, u.ord;

-- Canonical names back onto works and every edition (fires the tidy and
-- book_authors triggers).
update public.works w set authors = c.names
from (
  select wa.work_id, array_agg(a.name order by wa.position) as names
  from public.work_authors wa join public.authors a on a.id = wa.author_id
  group by wa.work_id
) c
where w.id = c.work_id and w.authors is distinct from c.names;

update public.books b set authors = w.authors
from public.works w
where w.id = b.work_id and cardinality(w.authors) > 0 and b.authors is distinct from w.authors;

-- ------------------------------------------------------------
-- Reads
-- ------------------------------------------------------------

-- Search tab authors: authors of books with a copy the caller can see.
-- `author` kept for the app version already deployed; author_id is new.
drop function public.circle_authors(text);
create function public.circle_authors(q text)
returns table (author text, author_id uuid)
language sql
stable
set search_path = public, extensions
as $$
  select distinct a.name, a.id
  from public.shelf_items s
  join public.books b on b.id = s.book_id
  join public.work_authors wa on wa.work_id = b.work_id
  join public.authors a on a.id = wa.author_id
  where length(btrim(q)) >= 2
    and a.name ilike '%' || replace(replace(replace(btrim(q), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  order by a.name
  limit 15;
$$;

revoke execute on function public.circle_authors(text) from public, anon;
grant execute on function public.circle_authors(text) to authenticated;

-- Author page: works by this author with a copy the caller can see, one row
-- per work.
create function public.circle_author_books(p_author_id uuid)
returns table (id uuid, work_id uuid, title text, authors text[], cover_url text)
language sql
stable
set search_path = public, extensions
as $$
  with visible as (
    select distinct on (b.work_id) b.id, b.work_id, b.title, b.authors, b.cover_url
    from public.work_authors wa
    join public.books b on b.work_id = wa.work_id
    join public.shelf_items s on s.book_id = b.id
    where wa.author_id = p_author_id
    order by b.work_id, (s.owner_id = (select auth.uid())) desc, (b.cover_url is not null) desc
  )
  select id, work_id, title, authors, cover_url from visible order by title;
$$;

revoke execute on function public.circle_author_books(uuid) from public, anon;
grant execute on function public.circle_author_books(uuid) to authenticated;
