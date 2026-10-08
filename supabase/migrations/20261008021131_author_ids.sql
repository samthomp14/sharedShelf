-- ============================================================
-- Open Library author ids: merge, never split
-- ============================================================
-- Open Library often has several author records for one person (Stephen
-- King has more than one id). So a name match now always means the same
-- author, whatever OL id it has; the first OL id seen is the one kept.
-- OL ids then only ever merge spellings a name can't (村上春樹 / Haruki
-- Murakami), never split one name into two author pages. Two different
-- people sharing a name end up as one author, which is rarer than OL's
-- duplicates.
--
-- The display name of an existing author is kept: same name_key means the
-- same letters, and the stored spelling was already picked as the best.
--
-- set_work_authors_batch is for scripts/backfill-author-ids.mjs.
-- ============================================================

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
  if v_id is not null then
    if v_ol is not null then
      update public.authors set ol_author_id = v_ol where id = v_id and ol_author_id is null;
    end if;
    return v_id;
  end if;

  insert into public.authors (name, name_key, ol_author_id)
  values (v_name, v_key, v_ol)
  returning id into v_id;
  return v_id;
end;
$$;

-- [{ "work_id": "...", "authors": [{name, ol_author_id}] }, ...]
create function public.set_work_authors_batch(p_items jsonb)
returns int
language plpgsql
security definer set search_path = ''
as $$
declare
  v_item jsonb;
  v_n int := 0;
begin
  for v_item in select * from jsonb_array_elements(p_items) loop
    perform public.set_work_authors((v_item ->> 'work_id')::uuid, v_item -> 'authors', true);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

revoke execute on function public.set_work_authors_batch(jsonb) from public, anon, authenticated;
grant execute on function public.set_work_authors_batch(jsonb) to service_role;

-- Works the backfill script still has to look up, 100 at a time.
create function public.works_missing_author_ids(p_after uuid default null, p_limit int default 100)
returns table (id uuid, ol_work_id text)
language sql
stable
security definer set search_path = ''
as $$
  select w.id, w.ol_work_id
  from public.works w
  where w.ol_work_id is not null
    and (p_after is null or w.id > p_after)
    and exists (
      select 1 from public.work_authors wa
      join public.authors a on a.id = wa.author_id
      where wa.work_id = w.id and a.ol_author_id is null
    )
  order by w.id
  limit p_limit;
$$;

revoke execute on function public.works_missing_author_ids(uuid, int) from public, anon, authenticated;
grant execute on function public.works_missing_author_ids(uuid, int) to service_role;
