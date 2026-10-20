-- The two documents on /constitution become replaceable from the portal (requested 2026-10-20:
-- "add a way for me to update the constitution and bylaws through the portal", "by uploading a
-- new pdf"). Until now each was a file in the site's code, so a new edition needed a code change.
--
-- One new block, edited by the EB (which takes in the webmaster):
--   constitution.documents   the AUSSS Constitution & Bylaws and the IFMSA-Egypt Constitution &
--                            Bylaws, each a PDF with a line saying which version it is
-- Nothing is published yet, so the page keeps showing the two files that ship with the site
-- (public/assets/docs) until someone publishes from the portal.
--
-- The PDFs go in a bucket of their own, `content-files`, beside `content-media` (pictures): a
-- PDF is not shrunk in the browser as a picture is, so it needs a larger limit, and the
-- pictures keep their 5 MB one. A file sits in its block's folder
-- (`constitution.documents/<random>.pdf`), and only that block's editors may add one. For now
-- the only block with PDFs is this one, so the bucket takes files in its folder alone; a later
-- block that needs PDFs widens the insert rule in a migration of its own.
--
-- A new version is always a new file under a new name, so no cached copy of an old one is ever
-- served under the new address. Nothing is ever overwritten or removed from the portal (there
-- is no update or delete rule), so the file a published document points to cannot vanish from
-- under it, and every earlier version stays: the audit log holds their addresses, and one can
-- be put back by publishing it again. A file uploaded by mistake is removed from the Supabase
-- dashboard.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('content-files', 'content-files', true, 26214400, array['application/pdf'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- A public bucket serves its files by address without a policy; the select policy lets the
-- editors list what was uploaded.
drop policy if exists content_files_read on storage.objects;
create policy content_files_read on storage.objects
  for select to authenticated
  using (bucket_id = 'content-files' and (select app.can_edit_content((storage.foldername(name))[1])));
drop policy if exists content_files_insert on storage.objects;
create policy content_files_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'content-files'
    and (storage.foldername(name))[1] = 'constitution.documents'
    and (select app.can_edit_content((storage.foldername(name))[1]))
  );

insert into public.content_blocks (key, editors)
values ('constitution.documents', '{}')
on conflict (key) do nothing;
