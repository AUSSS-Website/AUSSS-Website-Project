-- A campaign's concept note: one document per campaign, uploaded from the campaign's page.
--
-- The file sits in the private Storage bucket `campaign-files` under
-- '<campaign id>/<random id>.<ext>'; the campaign row keeps that path and the name the person
-- gave the file. Whoever can see the campaign opens it (a signed link); whoever manages the
-- campaign uploads, replaces or removes it. Replacing uploads the new file, points the row at
-- it, and then removes the old object; deleting a campaign removes the object first, from the
-- browser, while the policy can still tell who manages it.

alter table public.campaigns
  add column if not exists concept_note_path text null,
  add column if not exists concept_note_name text null;

-- Both or neither, and the path is under this campaign's own folder.
alter table public.campaigns drop constraint if exists campaigns_concept_note_check;
alter table public.campaigns add constraint campaigns_concept_note_check
  check (
    (concept_note_path is null and concept_note_name is null)
    or (
      concept_note_name <> '' and length(concept_note_name) <= 200
      and concept_note_path ~ ('^' || id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8}$')
    )
  );

-- 10 MB. Documents, slides and PDFs; nothing a browser would run.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'campaign-files', 'campaign-files', false, 10485760,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- The campaign a storage key belongs to: its first folder, when the key is well formed; null
-- otherwise (a null never passes a policy).
create or replace function app.campaign_file_campaign(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8}$'
    then left(p_name, 36)::uuid
  end
$$;

drop policy if exists campaign_files_read on storage.objects;
create policy campaign_files_read on storage.objects
  for select to authenticated
  using (bucket_id = 'campaign-files' and (select app.can_see_campaign(app.campaign_file_campaign(name))));
drop policy if exists campaign_files_insert on storage.objects;
create policy campaign_files_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'campaign-files' and (select app.can_manage_campaign(app.campaign_file_campaign(name))));
drop policy if exists campaign_files_delete on storage.objects;
create policy campaign_files_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'campaign-files' and (select app.can_manage_campaign(app.campaign_file_campaign(name))));

alter function app.campaign_file_campaign(text) owner to postgres;
revoke execute on function app.campaign_file_campaign(text) from public;
grant execute on function app.campaign_file_campaign(text) to authenticated;
