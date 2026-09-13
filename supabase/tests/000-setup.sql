-- Smoke test: pgTAP itself is installed by seed.sql (dev/CI only). Files in this folder run
-- alphabetically and each one is a standalone transaction that rolls back at the end.
begin;
select plan(1);

select has_extension('pgtap');

select * from finish();
rollback;
