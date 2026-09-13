-- Phase 0 foundations: extensions, the private `app` schema and the pure/trigger helpers every
-- later migration depends on. `app` is never exposed through the Data API (config.toml only
-- lists `public`), so it is the safe home for security-definer helpers.
-- Runs as one transaction; every statement is re-runnable on a fresh database.

-- Supabase keeps extensions out of `public`. pgcrypto is preinstalled there; gen_random_uuid()
-- is built into PG13+ so nothing is needed for it.
create extension if not exists unaccent with schema extensions;

create schema if not exists app;

-- Lock the schema down: only the API roles may resolve names in it, and functions created here
-- must be granted explicitly instead of inheriting EXECUTE from PUBLIC.
revoke all on schema app from public;
grant usage on schema app to anon, authenticated, service_role;
alter default privileges in schema app revoke execute on functions from public;

-- ---------------------------------------------------------------------------------------------
-- Pure helpers (immutable, security invoker). They are used inside generated columns and check
-- expressions, so every role that writes those tables (including service_role imports) needs
-- EXECUTE on them.
-- ---------------------------------------------------------------------------------------------

-- Canonical email for matching roster rows, invites and auth users: trimmed, lowercased,
-- empty -> null so `unique`/`=` comparisons behave.
create or replace function app.norm_email(text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select nullif(lower(btrim($1)), '')
$$;

-- Mirror of `normalize()` in src/lib/membership.js (NFKD strip diacritics, lower, collapse
-- whitespace, trim) so name lookups agree with the importer. Declared immutable although
-- unaccent's dictionary could in theory change; the two-argument form pins the dictionary so the
-- result does not depend on search_path. null -> '' matches the JS helper.
create or replace function app.normalize_text(text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select btrim(
    regexp_replace(
      lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce($1, ''))),
      '\s+', ' ', 'g'
    )
  )
$$;

-- Numeric rank for positions.level so policies can compare "below officer" without an enum.
create or replace function app.level_rank(text)
returns int
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case $1
    when 'webmaster' then 50
    when 'eb' then 40
    when 'officer' then 30
    when 'assistant' then 20
    when 'member' then 10
    else 0
  end
$$;

revoke execute on function app.norm_email(text) from public;
revoke execute on function app.normalize_text(text) from public;
revoke execute on function app.level_rank(text) from public;
grant execute on function app.norm_email(text) to anon, authenticated, service_role;
grant execute on function app.normalize_text(text) to anon, authenticated, service_role;
grant execute on function app.level_rank(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Trigger functions. Triggers never check EXECUTE at fire time, so no grants are needed.
-- ---------------------------------------------------------------------------------------------

-- before update on every table: keep updated_at honest regardless of what the client sent.
create or replace function app.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

-- after insert/update/delete on every table except audit_log. Security definer because the
-- calling role (authenticated) has no INSERT on audit_log; actor is null for service_role and
-- for rows written by auth triggers. public.audit_log is created in the next migration; plpgsql
-- only resolves it when the trigger first fires.
create or replace function app.audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_after jsonb;
begin
  if tg_op <> 'INSERT' then
    v_before := to_jsonb(old);
  end if;
  if tg_op <> 'DELETE' then
    v_after := to_jsonb(new);
  end if;

  insert into public.audit_log (actor, table_name, row_id, action, before, after)
  values (
    auth.uid(),
    tg_table_name,
    coalesce(v_after ->> 'id', v_before ->> 'id'),
    tg_op,
    v_before,
    v_after
  );
  return null;
end
$$;

alter function app.norm_email(text) owner to postgres;
alter function app.normalize_text(text) owner to postgres;
alter function app.level_rank(text) owner to postgres;
alter function app.set_updated_at() owner to postgres;
alter function app.audit() owner to postgres;
revoke execute on function app.set_updated_at() from public;
revoke execute on function app.audit() from public;
