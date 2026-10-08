-- ============================================================
-- Contract: drop the old author name lists
-- ============================================================
-- authors + work_authors are the only record of who wrote what now. This
-- drops books.authors, works.authors and book_authors, and the triggers that
-- kept them in step (sync_book_authors, tidy_book_authors,
-- link_new_book_authors, sync_work_author_names).
--
-- Applied after the app and enrich-book read authors:author_names
-- (commit c411119) are deployed: anything still selecting books.authors
-- breaks once this runs.
--
-- Writers that used the lists now go through set_work_authors:
--   * add_book_to_shelf — the names typed or looked up become the new
--     book's work's authors (if that work has none yet).
--   * link_book_to_work — p_work.author_list replaces; p_work.authors
--     (plain names) only fills a work with none.
--   * seed_catalog — author_list, else plain authors.
-- ============================================================

drop trigger on_book_authors_change on public.books;
drop function public.sync_book_authors();
drop trigger on_book_authors_tidy on public.books;
drop function public.tidy_book_authors();
drop trigger on_book_insert_link_authors on public.books;
drop function public.link_new_book_authors();

-- Plain names -> set_work_authors' [{name}] shape.
create function public.author_name_list(p_names text[])
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('name', x) order by ord), '[]')
  from unnest(coalesce(p_names, '{}'::text[])) with ordinality as u (x, ord)
  where nullif(btrim(x), '') is not null;
$$;

create or replace function public.ensure_book_work()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if new.work_id is null then
    insert into public.works (title, cover_url)
    values (new.title, new.cover_url)
    returning id into new.work_id;
  end if;
  return new;
end;
$$;

create or replace function public.set_work_authors(p_work_id uuid, p_authors jsonb, p_replace boolean default true)
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

  delete from public.authors a
  where a.id = any (v_old)
    and not exists (select 1 from public.work_authors wa where wa.author_id = a.id);
end;
$$;

create or replace function public.merge_authors(p_from uuid, p_to uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  v_from public.authors;
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

  delete from public.authors where id = p_from; -- cascades its work_authors rows
end;
$$;

drop function public.sync_work_author_names(uuid);

create or replace function public.add_book_to_shelf(
  p_book_id uuid default null,
  p_isbn text default null,
  p_title text default null,
  p_authors text[] default null,
  p_cover_url text default null,
  p_source text default null
)
returns table (book_id uuid, shelf_item_id uuid, already_on_shelf boolean)
language plpgsql
security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_book uuid;
  v_isbn text;
  v_title text;
  v_work uuid;
  v_item uuid;
  v_already boolean := false;
begin
  if v_uid is null then
    raise exception 'You need to be signed in.' using errcode = '42501';
  end if;

  if p_book_id is not null then
    select b.id into v_book from public.books b where b.id = p_book_id;
    if v_book is null then
      raise exception 'Book not found.' using errcode = 'P0002';
    end if;
  else
    if nullif(btrim(p_isbn), '') is not null then
      v_isbn := public.normalize_isbn(p_isbn);
      if v_isbn is null then
        raise exception 'That ISBN isn''t valid.' using errcode = '22023';
      end if;
      -- An existing catalog row wins; the details sent in are ignored.
      select b.id into v_book from public.books b where b.isbn = v_isbn;
    end if;

    if v_book is null then
      v_title := btrim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g'));
      if v_title = '' then
        raise exception 'Title is required.' using errcode = '22023';
      end if;
      if p_source is null or p_source not in ('manual', 'open_library', 'google_books') then
        raise exception 'Invalid book source.' using errcode = '22023';
      end if;
      if p_cover_url is not null and p_cover_url !~ '^https://' then
        raise exception 'Cover URL must be https.' using errcode = '22023';
      end if;

      begin
        insert into public.books (isbn, title, cover_url, source)
        values (v_isbn, v_title, p_cover_url, p_source)
        returning id, work_id into v_book, v_work;
        -- The new book's placeholder work gets the names sent in (tidied
        -- and matched to existing authors by set_work_authors).
        perform public.set_work_authors(v_work, public.author_name_list(p_authors), false);
      exception when unique_violation then
        -- Someone added the same ISBN a moment ago.
        select b.id into v_book from public.books b where b.isbn = v_isbn;
      end;
    end if;
  end if;

  insert into public.shelf_items (owner_id, book_id)
  values (v_uid, v_book)
  on conflict on constraint shelf_items_owner_book_key do nothing
  returning id into v_item;

  if v_item is null then
    select s.id into v_item from public.shelf_items s
    where s.owner_id = v_uid and s.book_id = v_book;
    v_already := true;
  end if;

  return query select v_book, v_item, v_already;
end;
$$;

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
  v_old_authors uuid[];
begin
  select * into v_book from public.books where id = p_book_id for update;
  if v_book.id is null then
    raise exception 'Book not found.' using errcode = 'P0002';
  end if;
  v_old := v_book.work_id;
  select coalesce(array_agg(author_id), '{}') into v_old_authors from public.work_authors where work_id = v_old;

  if v_ol is not null then
    select id into v_target from public.works where ol_work_id = v_ol;
    if v_target is null then
      update public.works set ol_work_id = v_ol where id = v_old and ol_work_id is null;
      if found then
        v_target := v_old;
      else
        insert into public.works (ol_work_id, title)
        values (v_ol, coalesce(nullif(p_work ->> 'title', ''), v_book.title))
        returning id into v_target;
      end if;
    end if;
  else
    v_target := v_old;
  end if;

  update public.works w set
    subtitle = coalesce(w.subtitle, nullif(p_work ->> 'subtitle', '')),
    description = coalesce(w.description, nullif(p_work ->> 'description', '')),
    first_publish_year = coalesce(w.first_publish_year, (p_work ->> 'first_publish_year')::int),
    categories = case when cardinality(w.categories) = 0 and p_work ? 'categories'
                   then array(select jsonb_array_elements_text(p_work -> 'categories')) else w.categories end,
    cover_url = coalesce(w.cover_url, nullif(p_work ->> 'cover_url', '')),
    description_checked_at = case when (p_work ->> 'description_checked')::boolean
                               then coalesce(w.description_checked_at, now()) else w.description_checked_at end
  where w.id = v_target;

  -- Authors: OL's list replaces; otherwise a target with none keeps the
  -- placeholder's (moving to an existing work keeps that work's).
  if jsonb_typeof(p_work -> 'author_list') = 'array' then
    perform public.set_work_authors(v_target, p_work -> 'author_list', true);
  elsif v_old is distinct from v_target
        and not exists (select 1 from public.work_authors where work_id = v_target) then
    insert into public.work_authors (work_id, author_id, position)
    select v_target, author_id, position from public.work_authors where work_id = v_old
    on conflict do nothing;
  end if;

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
    -- Authors only the placeholder had are gone with it.
    delete from public.authors a
    where a.id = any (v_old_authors)
      and not exists (select 1 from public.work_authors wa where wa.author_id = a.id);
  end if;

  return v_target;
end;
$$;

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

    insert into public.works (ol_work_id, title, subtitle, first_publish_year, categories, cover_url)
    values (
      v_item ->> 'ol_work_id',
      btrim(v_item ->> 'title'),
      nullif(v_item ->> 'subtitle', ''),
      (v_item ->> 'first_publish_year')::int,
      array(select jsonb_array_elements_text(coalesce(v_item -> 'categories', '[]'))),
      nullif(v_item ->> 'cover_url', '')
    )
    on conflict (ol_work_id) do nothing
    returning id into v_work;
    continue when v_work is null;

    perform public.set_work_authors(
      v_work,
      case when jsonb_typeof(v_item -> 'author_list') = 'array' then v_item -> 'author_list'
           else public.author_name_list(array(select jsonb_array_elements_text(coalesce(v_item -> 'authors', '[]'))))
      end,
      true
    );

    insert into public.books (isbn, title, cover_url, source, work_id, publisher, page_count, language, enriched_at)
    values (
      v_isbn,
      btrim(v_item ->> 'title'),
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

-- tidy_author_list only served the dropped trigger and seed.
drop function public.tidy_author_list(text[]);

drop table public.book_authors;
alter table public.books drop column authors;
alter table public.works drop column authors;
