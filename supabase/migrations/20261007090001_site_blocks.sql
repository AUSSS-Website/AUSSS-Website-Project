-- Phase 6, step 3: three more parts of the site become blocks, all edited by the EB:
--   site.contact   the footer and contact details (address, map pin, official social channels,
--                  motto and the short introductions on /contact)
--   home.page      the lines and figures in the home page's hero and the "About the Society"
--                  section
--   ifmsa.page     the words and figures on /ifmsa
-- Nothing is published yet, so each page keeps showing the copy in its schema file under
-- src/content/schemas until someone publishes from the portal.
--
-- In the same step the switches that lived in config files (Open Calls on the public site, the
-- magazine's counter, the addresses on the domain) became site settings: site_settings takes
-- any key, and a missing row means the switch is off, so they need no rows here. The build now
-- writes the settings into the saved pages (which address the contact lines and the search
-- engine data give), so a change to a setting asks for a rebuild like any other published change.

insert into public.content_blocks (key, editors)
values ('site.contact', '{}'), ('home.page', '{}'), ('ifmsa.page', '{}')
on conflict (key) do nothing;

drop trigger if exists touch_site on public.site_settings;
create trigger touch_site after insert or update or delete on public.site_settings
  for each statement execute function app.touch_site();
