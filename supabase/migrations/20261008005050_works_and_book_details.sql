-- ============================================================
-- Works, richer book info, and catalog enrichment
-- ============================================================
-- Plan: todo.md, "catalog plan (2026-10-07)".
--
--   * works — one row per work (all editions of a title). Holds what every
--     edition shares: description, first publish year, categories. Keyed by
--     Open Library's work id when we know it.
--   * books stays one row per edition (isbn, publisher, page count, cover)
--     and gains work_id. Every book gets a work: a new book with none gets a
--     placeholder work built from its own title/authors, and the enrich-book
--     edge function later points it at the real Open Library work (merging
--     placeholders into an existing work when another edition got there first).
--   * enrich-book is called by pg_net after insert for books that arrive
--     without details (user adds). Seeded books arrive with enriched_at set
--     and are skipped, so seeding never fans out into per-book API calls.
--
-- Additive only: the prod app keeps reading books as before. Until the vault
-- secrets exist (catalog_function_url, catalog_webhook_secret) no HTTP call
-- is made and new books just wait with enriched_at null.
-- ============================================================

-- ------------------------------------------------------------
-- works
-- ------------------------------------------------------------
create table public.works (
  id uuid primary key default gen_random_uuid(),
  ol_work_id text unique check (ol_work_id ~ '^OL[0-9]+W$'),
  title text not null,
  subtitle text,
  authors text[] not null default '{}',
  description text,
  first_publish_year int,
  categories text[] not null default '{}',
  cover_url text check (cover_url is null or cover_url ~ '^https://'),
  -- Set once we've looked for a description, found or not, so a book page
  -- never asks twice.
  description_checked_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.works enable row level security;

create policy "works are readable by any authenticated user"
  on public.works for select
  to authenticated
  using (true);

-- No write policies: works are written only by triggers and the enrich-book
-- function (service role).

-- ------------------------------------------------------------
-- books: edition details + work link
-- ------------------------------------------------------------
alter table public.books
  add column work_id uuid references public.works (id),
  add column publisher text,
  add column page_count int check (page_count is null or page_count > 0),
  add column language text,
  add column enriched_at timestamptz;

create index books_work_id_idx on public.books (work_id);
create index books_unenriched_idx on public.books (created_at) where enriched_at is null;

-- Every book gets a work. A new book without one gets a placeholder from its
-- own title/authors/cover; enrich-book replaces it with the real work later.
create function public.ensure_book_work()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if new.work_id is null then
    insert into public.works (title, authors, cover_url)
    values (new.title, new.authors, new.cover_url)
    returning id into new.work_id;
  end if;
  return new;
end;
$$;

create trigger on_book_insert_ensure_work
  before insert on public.books
  for each row execute procedure public.ensure_book_work();

revoke execute on function public.ensure_book_work() from public, anon, authenticated;

-- Book insert without details -> enrich-book (pg_net sends after commit).
create function public.dispatch_book_enrich()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  if new.enriched_at is not null then
    return new;
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'catalog_function_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'catalog_webhook_secret';
  if v_url is null or v_secret is null then
    return new;
  end if;

  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('book_id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-catalog-secret', v_secret),
    timeout_milliseconds := 5000
  );
  return new;
end;
$$;

create trigger on_book_insert_enrich
  after insert on public.books
  for each row execute procedure public.dispatch_book_enrich();

revoke execute on function public.dispatch_book_enrich() from public, anon, authenticated;

-- ------------------------------------------------------------
-- link_book_to_work: enrich-book's one write. Points a book at the Open
-- Library work (creating it, or merging the book's placeholder into an
-- existing one), and fills in work and edition fields that are still empty.
-- Never overwrites a value that's already there.
--
-- p_work:    { ol_work_id?, title?, subtitle?, authors?, description?,
--              first_publish_year?, categories?, cover_url?, description_checked? }
-- p_edition: { isbn?, publisher?, page_count?, language?, cover_url? }
--            isbn is only taken when the book has none and it's not in use
--            (used for the one-off demo-data cleanup).
-- ------------------------------------------------------------
create function public.link_book_to_work(p_book_id uuid, p_work jsonb, p_edition jsonb default '{}')
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
      -- First edition of this work we've linked: the placeholder becomes it.
      update public.works set ol_work_id = v_ol where id = v_old and ol_work_id is null;
      if found then
        v_target := v_old;
      else
        -- The book's current work is a different OL work; start a new one.
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

  -- A placeholder left with no editions is gone.
  if v_old is distinct from v_target then
    delete from public.works w
    where w.id = v_old and not exists (select 1 from public.books b where b.work_id = v_old);
  end if;

  return v_target;
end;
$$;

revoke execute on function public.link_book_to_work(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.link_book_to_work(uuid, jsonb, jsonb) to service_role;

-- ------------------------------------------------------------
-- seed_catalog: bulk insert from the seed script (service role). One
-- element per work: { ol_work_id, title, subtitle?, authors, first_publish_year?,
-- categories?, cover_url?, edition: { isbn, publisher?, page_count?, language?, cover_url? } }.
-- Skips works and ISBNs we already have. Returns how many books it added.
-- ------------------------------------------------------------
create function public.seed_catalog(p_works jsonb)
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
      continue; -- already have an edition of this work
    end if;

    insert into public.works (ol_work_id, title, subtitle, authors, first_publish_year, categories, cover_url)
    values (
      v_item ->> 'ol_work_id',
      btrim(v_item ->> 'title'),
      nullif(v_item ->> 'subtitle', ''),
      array(select jsonb_array_elements_text(coalesce(v_item -> 'authors', '[]'))),
      (v_item ->> 'first_publish_year')::int,
      array(select jsonb_array_elements_text(coalesce(v_item -> 'categories', '[]'))),
      nullif(v_item ->> 'cover_url', '')
    )
    on conflict (ol_work_id) do nothing
    returning id into v_work;
    continue when v_work is null;

    insert into public.books (isbn, title, authors, cover_url, source, work_id, publisher, page_count, language, enriched_at)
    values (
      v_isbn,
      btrim(v_item ->> 'title'),
      array(select jsonb_array_elements_text(coalesce(v_item -> 'authors', '[]'))),
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

revoke execute on function public.seed_catalog(jsonb) from public, anon, authenticated;
grant execute on function public.seed_catalog(jsonb) to service_role;

-- ------------------------------------------------------------
-- Backfill: a placeholder work for every existing book.
-- ------------------------------------------------------------
do $$
declare
  r record;
  v_work uuid;
begin
  for r in select id, title, authors, cover_url from public.books where work_id is null loop
    insert into public.works (title, authors, cover_url)
    values (r.title, r.authors, r.cover_url)
    returning id into v_work;
    update public.books set work_id = v_work where id = r.id;
  end loop;
end;
$$;

-- ------------------------------------------------------------
-- Reads, one row per work
-- ------------------------------------------------------------

-- Add Book search over the whole catalog: one row per work, showing the
-- caller's own edition if they have one, else the most-shelved edition.
create function public.search_catalog_works(q text)
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
    select b.id, b.work_id, b.isbn, b.title, b.authors, b.cover_url, s.id as shelf_item_id,
           greatest(similarity(b.title, term.t), word_similarity(term.t, b.title)) as score,
           (select count(*) from public.shelf_items c where c.book_id = b.id) as copies
    from term, public.books b
    left join public.shelf_items s
      on s.book_id = b.id and s.owner_id = (select auth.uid())
    where length(term.t) >= 2
      and (
        b.title ilike term.pat
        or b.title % term.t
        or exists (
          select 1 from public.book_authors ba
          where ba.book_id = b.id and ba.author ilike term.pat
        )
      )
  ),
  per_work as (
    select distinct on (work_id) *
    from hits
    order by work_id, (shelf_item_id is not null) desc, copies desc, (cover_url is not null) desc, score desc
  )
  select id, work_id, isbn, title, authors, cover_url, shelf_item_id
  from per_work
  order by score desc, title
  limit 20;
$$;

revoke execute on function public.search_catalog_works(text) from public, anon;
grant execute on function public.search_catalog_works(text) to authenticated;

-- Search tab and author page: only works with a copy the caller can see
-- (security invoker, so shelf_items RLS decides), one row per work.
create function public.circle_books(q text default null, p_author text default null)
returns table (id uuid, work_id uuid, title text, authors text[], cover_url text)
language sql
stable
set search_path = public, extensions
as $$
  with visible as (
    select distinct on (b.work_id) b.id, b.work_id, b.title, b.authors, b.cover_url
    from public.shelf_items s
    join public.books b on b.id = s.book_id
    where (q is null or b.title ilike '%' || replace(replace(replace(btrim(q), '\', '\\'), '%', '\%'), '_', '\_') || '%')
      and (p_author is null or p_author = any (b.authors))
    order by b.work_id, (s.owner_id = (select auth.uid())) desc, (b.cover_url is not null) desc
  )
  select id, work_id, title, authors, cover_url from visible order by title limit 50;
$$;

revoke execute on function public.circle_books(text, text) from public, anon;
grant execute on function public.circle_books(text, text) to authenticated;

-- Search tab authors: authors of books with a copy the caller can see.
create function public.circle_authors(q text)
returns table (author text)
language sql
stable
set search_path = public, extensions
as $$
  select distinct ba.author
  from public.shelf_items s
  join public.book_authors ba on ba.book_id = s.book_id
  where length(btrim(q)) >= 2
    and ba.author ilike '%' || replace(replace(replace(btrim(q), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  order by ba.author
  limit 15;
$$;

revoke execute on function public.circle_authors(text) from public, anon;
grant execute on function public.circle_authors(text) to authenticated;
