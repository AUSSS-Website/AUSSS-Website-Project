-- Phase 6: /exchange/outgoings is rebuilt in the incomings page's shape and its copy becomes
-- the block `exchange.outgoings`, edited by the exchange officers (SCOPE and SCORE share the
-- exchange team) and the EB. No published copy yet, so the page keeps showing the copy in
-- src/content/schemas/exchangeOutgoings.js until an officer publishes from the portal.

insert into public.content_blocks (key, editors)
values ('exchange.outgoings', '{scope,score}')
on conflict (key) do nothing;
