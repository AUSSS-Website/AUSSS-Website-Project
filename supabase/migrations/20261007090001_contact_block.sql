-- Phase 6, step 3: the footer and contact details become the block `site.contact` (address,
-- map pin, official social channels, motto and the short introductions), edited by the EB. No
-- published copy yet, so the footer and /contact keep showing the copy in
-- src/content/schemas/siteContact.js until someone publishes from the portal.
--
-- In the same step the switches that lived in config files (Open Calls on the public site, the
-- magazine's counter, the addresses on the domain) became site settings: site_settings takes
-- any key, and a missing row means the switch is off, so they need no rows here. The build now
-- writes the settings into the saved pages (which address the contact lines and the search
-- engine data give), so a change to a setting asks for a rebuild like any other published change.

insert into public.content_blocks (key, editors)
values ('site.contact', '{}')
on conflict (key) do nothing;

drop trigger if exists touch_site on public.site_settings;
create trigger touch_site after insert or update or delete on public.site_settings
  for each statement execute function app.touch_site();
