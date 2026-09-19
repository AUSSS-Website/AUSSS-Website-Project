-- Phase 2 (migration step 2): committee page overrides move from the `Overrides` sheet in
-- apps-script/officers.gs into committees.page (jsonb), and officer photos from Google Drive
-- into the public `committee-media` Storage bucket.
--
-- committees.page shape (the same object officers.gs wrote, minus the write-only `activities`
-- field that nothing ever read):
--   { tagline: text, about: text[], whatWeDo: text[], whatWeDoEnabled: bool,
--     photo: text (URL or /assets path or ''), membersEnabled: bool,
--     members: [{ id, name, title, photo }] (max 10) }
-- An empty object means "no override": the public site then renders src/data/society.js.
--
-- Writes go through public.save_committee_page(slug, page) rather than a table UPDATE, because
-- committees_update stays EB-only (an officer must never rename or recolour a committee) and
-- column-level grants cannot express "officers of THIS committee may write THIS row". The RPC
-- checks app.is_officer_of, normalises the document and enforces the caps, then writes only
-- `page`.

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

create or replace function app.committee_id_by_slug(p_slug text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id from public.committees c where c.slug = lower(btrim(p_slug)) limit 1
$$;

-- Trim and cap a jsonb string; anything that is not a string becomes ''.
create or replace function app.jtext(p jsonb, p_max int)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p is null or jsonb_typeof(p) <> 'string' then ''
    else left(btrim(p #>> '{}'), p_max)
  end
$$;

-- Array of trimmed, non-empty strings, each capped at p_max chars, at most p_count items.
-- A non-array (or null) yields [].
create or replace function app.jtext_array(p jsonb, p_max int, p_count int)
returns jsonb
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(
    (
      select jsonb_agg(v order by ord)
      from (
        select app.jtext(e, p_max) as v, ord
        from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end)
          with ordinality as t(e, ord)
      ) s
      where v <> ''
      limit p_count
    ),
    '[]'::jsonb
  )
$$;

-- The one place the page document is normalised. Unknown keys are dropped, strings trimmed and
-- capped, members limited to 10 and to rows that carry a name or a photo (as AccountPage did).
-- `data:` URIs are refused: photos must be uploaded to Storage (or be an existing URL/path).
create or replace function app.normalize_committee_page(p jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_members jsonb := '[]'::jsonb;
  v_member jsonb;
  v_name text;
  v_title text;
  v_photo text;
  v_id text;
  v_count int := 0;
  v_ord bigint;
  v_lead_photo text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    p := '{}'::jsonb;
  end if;

  v_lead_photo := app.jtext(p -> 'photo', 600);
  if v_lead_photo like 'data:%' then
    raise exception 'photo must be an uploaded file URL, not inline image data' using errcode = '22023';
  end if;

  for v_member, v_ord in
    select e, ord
    from jsonb_array_elements(
      case when jsonb_typeof(p -> 'members') = 'array' then p -> 'members' else '[]'::jsonb end
    ) with ordinality as t(e, ord)
  loop
    exit when v_count >= 10;
    if jsonb_typeof(v_member) <> 'object' then
      continue;
    end if;
    v_name := app.jtext(v_member -> 'name', 120);
    v_title := app.jtext(v_member -> 'title', 120);
    v_photo := app.jtext(v_member -> 'photo', 600);
    if v_photo like 'data:%' then
      raise exception 'member photo must be an uploaded file URL, not inline image data' using errcode = '22023';
    end if;
    if v_name = '' and v_photo = '' then
      continue;
    end if;
    v_id := app.jtext(v_member -> 'id', 60);
    if v_id = '' then
      -- same default as officers.gs: 'm' + the member's index in what the editor sent
      v_id := 'm' || (v_ord - 1)::text;
    end if;
    v_members := v_members || jsonb_build_object(
      'id', v_id, 'name', v_name, 'title', v_title, 'photo', v_photo
    );
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object(
    'tagline', app.jtext(p -> 'tagline', 200),
    'about', app.jtext_array(p -> 'about', 2000, 12),
    'whatWeDo', app.jtext_array(p -> 'whatWeDo', 400, 12),
    'whatWeDoEnabled', coalesce((p ->> 'whatWeDoEnabled')::boolean, false),
    'photo', v_lead_photo,
    'membersEnabled', coalesce((p ->> 'membersEnabled')::boolean, false),
    'members', v_members
  );
exception
  when invalid_text_representation then
    -- a boolean field that is not a boolean
    raise exception 'whatWeDoEnabled and membersEnabled must be booleans' using errcode = '22023';
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Public RPC: rpc/save_committee_page
-- ---------------------------------------------------------------------------------------------

-- Officers of the committee (or EB) replace the page document. Passing {} or null clears the
-- override so the static content shows again. Returns the stored document.
create or replace function public.save_committee_page(slug text, page jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_committee uuid;
  v_page jsonb;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  v_committee := app.committee_id_by_slug(save_committee_page.slug);
  if v_committee is null then
    raise exception 'committee % not found', slug using errcode = 'P0002';
  end if;
  if not app.is_officer_of(v_committee) then
    raise exception 'not allowed to edit %', slug using errcode = '42501';
  end if;

  if page is null or page = '{}'::jsonb then
    v_page := '{}'::jsonb;
  else
    v_page := app.normalize_committee_page(page);
  end if;

  update public.committees c
    set page = v_page
  where c.id = v_committee;

  return v_page;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Storage: public bucket `committee-media`, written by the committee's officers under <slug>/…
-- ---------------------------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'committee-media', 'committee-media', true, 5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- True when the object path starts with the slug of a committee the caller may edit.
create or replace function app.can_write_committee_media(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    app.is_officer_of(app.committee_id_by_slug((storage.foldername(p_name))[1])),
    false
  )
$$;

drop policy if exists committee_media_read on storage.objects;
create policy committee_media_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'committee-media');
drop policy if exists committee_media_insert on storage.objects;
create policy committee_media_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'committee-media' and (select app.can_write_committee_media(name)));
drop policy if exists committee_media_update on storage.objects;
create policy committee_media_update on storage.objects
  for update to authenticated
  using (bucket_id = 'committee-media' and (select app.can_write_committee_media(name)))
  with check (bucket_id = 'committee-media' and (select app.can_write_committee_media(name)));
drop policy if exists committee_media_delete on storage.objects;
create policy committee_media_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'committee-media' and (select app.can_write_committee_media(name)));

-- ---------------------------------------------------------------------------------------------
-- Ownership + grants
-- ---------------------------------------------------------------------------------------------

alter function app.committee_id_by_slug(text) owner to postgres;
alter function app.jtext(jsonb, int) owner to postgres;
alter function app.jtext_array(jsonb, int, int) owner to postgres;
alter function app.normalize_committee_page(jsonb) owner to postgres;
alter function app.can_write_committee_media(text) owner to postgres;
alter function public.save_committee_page(text, jsonb) owner to postgres;

revoke execute on function app.committee_id_by_slug(text) from public;
revoke execute on function app.jtext(jsonb, int) from public;
revoke execute on function app.jtext_array(jsonb, int, int) from public;
revoke execute on function app.normalize_committee_page(jsonb) from public;
revoke execute on function app.can_write_committee_media(text) from public;
grant execute on function app.committee_id_by_slug(text) to anon, authenticated;
grant execute on function app.jtext(jsonb, int) to anon, authenticated, service_role;
grant execute on function app.jtext_array(jsonb, int, int) to anon, authenticated, service_role;
grant execute on function app.normalize_committee_page(jsonb) to authenticated, service_role;
grant execute on function app.can_write_committee_media(text) to authenticated;

revoke execute on function public.save_committee_page(text, jsonb) from public, anon;
grant execute on function public.save_committee_page(text, jsonb) to authenticated;
