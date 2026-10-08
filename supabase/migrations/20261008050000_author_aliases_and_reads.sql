-- ============================================================
-- Author aliases, merges, and reads from work_authors (expand)
-- ============================================================
-- 1. author_aliases: spellings (name_key) and Open Library ids that belong
--    to an author but aren't on its row — what's left after a merge, so a
--    later seed or scan of "Tui Sutherland" lands on "Tui T. Sutherland"
--    instead of re-creating the duplicate. resolve_author checks them.
-- 2. merge_authors(from, to): moves works, records aliases, removes `from`.
-- 3. author_names(books): computed field (select it like a column:
--    `authors:author_names`) with the work's author names in credit order.
--    Lets the app stop reading books.authors.
-- 4. Catalog reads (lookup_isbn, search_catalog*, circle_*) now take names
--    from work_authors/authors instead of books.authors/book_authors.
--
-- Contract (later migration): drop books.authors, works.authors,
-- book_authors and the triggers that keep them in sync.
-- ============================================================

create table public.author_aliases (
  alias text primary key, -- a name_key or an OL author id (OL...A)
  author_id uuid not null references public.authors (id) on delete cascade
);

create index author_aliases_author_id_idx on public.author_aliases (author_id);

alter table public.author_aliases enable row level security;
-- No policies: only resolve_author / merge_authors use it.

create or replace function public.resolve_author(p_name text, p_ol_author_id text default null)
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
    if v_id is null then
      select author_id into v_id from public.author_aliases where alias = v_ol;
    end if;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  select a.id into v_id from public.authors a
  where a.name_key = v_key
  order by (a.ol_author_id is not null) desc,
           exists (select 1 from public.work_authors wa where wa.author_id = a.id) desc,
           a.created_at
  limit 1;
  if v_id is null then
    select author_id into v_id from public.author_aliases where alias = v_key;
  end if;
  if v_id is not null then
    if v_ol is not null then
      update public.authors set ol_author_id = v_ol where id = v_id and ol_author_id is null;
      if not found then
        insert into public.author_aliases (alias, author_id) values (v_ol, v_id) on conflict do nothing;
      end if;
    end if;
    return v_id;
  end if;

  insert into public.authors (name, name_key, ol_author_id)
  values (v_name, v_key, v_ol)
  returning id into v_id;
  return v_id;
end;
$$;

create function public.merge_authors(p_from uuid, p_to uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  v_from public.authors;
  v_work uuid;
begin
  if p_from = p_to then
    return;
  end if;
  select * into v_from from public.authors where id = p_from;
  if v_from.id is null or not exists (select 1 from public.authors where id = p_to) then
    raise exception 'Author not found.' using errcode = 'P0002';
  end if;

  insert into public.author_aliases (alias, author_id)
  select x, p_to from unnest(array[v_from.name_key, v_from.ol_author_id]) x
  where x is not null
    and x <> (select name_key from public.authors where id = p_to)
    and x is distinct from (select ol_author_id from public.authors where id = p_to)
  on conflict (alias) do update set author_id = excluded.author_id;
  update public.author_aliases set author_id = p_to where author_id = p_from;

  insert into public.work_authors (work_id, author_id, position)
  select work_id, p_to, position from public.work_authors where author_id = p_from
  on conflict do nothing;

  for v_work in select work_id from public.work_authors where author_id = p_from loop
    delete from public.work_authors where work_id = v_work and author_id = p_from;
    perform public.sync_work_author_names(v_work);
  end loop;

  delete from public.authors where id = p_from;
end;
$$;

revoke execute on function public.merge_authors(uuid, uuid) from public, anon, authenticated;
grant execute on function public.merge_authors(uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- author_names: computed field on books
-- ------------------------------------------------------------
create function public.author_names(b public.books)
returns text[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(a.name order by wa.position), '{}')
  from public.work_authors wa
  join public.authors a on a.id = wa.author_id
  where wa.work_id = b.work_id;
$$;

grant execute on function public.author_names(public.books) to authenticated;

-- Does any author of this work match the pattern? (search helper)
create function public.work_author_matches(p_work_id uuid, p_pattern text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.work_authors wa
    join public.authors a on a.id = wa.author_id
    where wa.work_id = p_work_id and a.name ilike p_pattern
  );
$$;

grant execute on function public.work_author_matches(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- Reads
-- ------------------------------------------------------------
create or replace function public.lookup_isbn(p_isbn text)
returns table (id uuid, isbn text, title text, authors text[], cover_url text, shelf_item_id uuid)
language sql
stable
set search_path = ''
as $$
  select b.id, b.isbn, b.title, public.author_names(b), b.cover_url, s.id
  from public.books b
  left join public.shelf_items s
    on s.book_id = b.id and s.owner_id = (select auth.uid())
  where b.isbn = public.normalize_isbn(p_isbn);
$$;

-- Old one-row-per-edition search; nothing in the app calls it any more.
drop function public.search_catalog(text);

create or replace function public.search_catalog_works(q text)
returns table (id uuid, work_id uuid, isbn text, title text, authors text[], cover_url text, shelf_item_id uuid)
language sql
stable
set search_path = public, extensions
as $$
  with term as (
    select btrim(q) as t,
           '%' || replace(replace(replace(btrim(q), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat
  ),
  hits as (
    select b.id, b.work_id, b.isbn, b.title, b.cover_url, s.id as shelf_item_id,
           greatest(similarity(b.title, term.t), word_similarity(term.t, b.title)) as score,
           (select count(*) from public.shelf_items c where c.book_id = b.id) as copies,
           b as book
    from term, public.books b
    left join public.shelf_items s
      on s.book_id = b.id and s.owner_id = (select auth.uid())
    where length(term.t) >= 2
      and (
        b.title ilike term.pat
        or b.title % term.t
        or public.work_author_matches(b.work_id, term.pat)
      )
  ),
  per_work as (
    select distinct on (work_id) *
    from hits
    order by work_id, (shelf_item_id is not null) desc, copies desc, (cover_url is not null) desc, score desc
  )
  select id, work_id, isbn, title, public.author_names(book), cover_url, shelf_item_id
  from per_work
  order by score desc, title
  limit 20;
$$;

create or replace function public.circle_books(q text default null, p_author text default null)
returns table (id uuid, work_id uuid, title text, authors text[], cover_url text)
language sql
stable
set search_path = public, extensions
as $$
  with visible as (
    select distinct on (b.work_id) b.id, b.work_id, b.title, b.cover_url, b as book
    from public.shelf_items s
    join public.books b on b.id = s.book_id
    where (q is null or b.title ilike '%' || replace(replace(replace(btrim(q), '\', '\\'), '%', '\%'), '_', '\_') || '%')
      and (p_author is null or exists (
        select 1 from public.work_authors wa join public.authors a on a.id = wa.author_id
        where wa.work_id = b.work_id and a.name = p_author))
    order by b.work_id, (s.owner_id = (select auth.uid())) desc, (b.cover_url is not null) desc
  )
  select id, work_id, title, public.author_names(book), cover_url from visible order by title limit 50;
$$;

create or replace function public.circle_author_books(p_author_id uuid)
returns table (id uuid, work_id uuid, title text, authors text[], cover_url text)
language sql
stable
set search_path = public, extensions
as $$
  with visible as (
    select distinct on (b.work_id) b.id, b.work_id, b.title, b.cover_url, b as book
    from public.work_authors wa
    join public.books b on b.work_id = wa.work_id
    join public.shelf_items s on s.book_id = b.id
    where wa.author_id = p_author_id
    order by b.work_id, (s.owner_id = (select auth.uid())) desc, (b.cover_url is not null) desc
  )
  select id, work_id, title, public.author_names(book), cover_url from visible order by title;
$$;
