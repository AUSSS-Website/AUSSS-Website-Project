-- The security checklist's database lines (docs/RUNBOOK.md section 22), as tests, so a
-- new table or function cannot quietly ship without them. Each query must return no rows;
-- a failure prints the offending names.
begin;
select plan(3);

-- Row-level security is the boundary: a table without it is readable or writable by
-- whoever holds a grant on it.
select is_empty(
  $$ select n.nspname || '.' || c.relname
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r', 'p')
       and n.nspname in ('public', 'app')
       and not c.relrowsecurity $$,
  'every table in public and app has row-level security enabled'
);

-- Visitors write only through the submit_* functions, never into a table.
select is_empty(
  $$ select table_schema || '.' || table_name || ' ' || privilege_type
     from information_schema.role_table_grants
     where grantee = 'anon'
       and table_schema in ('public', 'app')
       and privilege_type <> 'SELECT' $$,
  'anon holds no write privilege on any table'
);

-- A SECURITY DEFINER function runs as its owner; without a pinned search_path a caller
-- could make it resolve names in a schema of their choosing.
select is_empty(
  $$ select n.nspname || '.' || p.proname
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'app')
       and p.prosecdef
       and not exists (
         select 1 from unnest(coalesce(p.proconfig, '{}')) as setting
         where setting like 'search_path=%'
       ) $$,
  'every SECURITY DEFINER function pins its search_path'
);

select * from finish();
rollback;
