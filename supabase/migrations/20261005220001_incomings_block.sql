-- Phase 6, step 2: /exchange/incomings becomes the first page built on the content editor.
-- Its block is edited by the exchange officers (SCOPE and SCORE share the exchange team) and
-- the EB. No published copy yet, so the page keeps showing the copy in
-- src/content/schemas/exchangeIncomings.js until an officer publishes from the portal.

insert into public.content_blocks (key, editors)
values ('exchange.incomings', '{scope,score}')
on conflict (key) do nothing;
