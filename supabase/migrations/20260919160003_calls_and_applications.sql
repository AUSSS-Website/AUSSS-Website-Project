-- Phase 2 (migration step 3): Open Calls and their applications move off the `Calls` and
-- `Applications` sheets in apps-script/officers.gs.
--
-- calls: one row per recruitment call, owned by a committee. Stored status is draft/open/closed;
-- "expired" (open but past the deadline) is derived on every read by app.call_is_live() and the
-- open_calls view, exactly as officers.gs derived effectiveStatus, so an expired call drops off
-- the site by itself and reopens when the deadline is extended.
--
-- applications: submitted anonymously from the public committee page through
-- public.submit_application (the only insert path: it validates, dedupes and rate-limits, like
-- apply_() did), then read and triaged by the committee's officers. Applications outlive their
-- call (call_id set null on delete; title and committee are snapshotted), because tidying up a
-- call must never destroy what people submitted to it.

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

-- Deadlines are Cairo calendar days (the script's timezone), and the deadline day itself counts.
create or replace function app.today_cairo()
returns date
language sql
stable
parallel safe
set search_path = ''
as $$
  select (now() at time zone 'Africa/Cairo')::date
$$;

create or replace function app.call_is_live(p_status text, p_deadline date)
returns boolean
language sql
stable
parallel safe
set search_path = ''
as $$
  select p_status = 'open' and (p_deadline is null or p_deadline >= app.today_cairo())
$$;

-- ---------------------------------------------------------------------------------------------
-- calls
-- ---------------------------------------------------------------------------------------------

create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  committee_id uuid not null references public.committees (id) on delete cascade,
  status text not null default 'open' check (status in ('draft', 'open', 'closed')),
  title text not null check (title <> '' and length(title) <= 140),
  kind text not null default '' check (length(kind) <= 60),
  summary text not null default '' check (length(summary) <= 300),
  description text not null default '' check (length(description) <= 4000),
  commitment text not null default '' check (length(commitment) <= 140),
  deadline date null,
  notify_email text null check (notify_email is null or length(notify_email) <= 200),
  -- [{ id, title, blurb, slots }], max 8; normalised by app.normalize_call()
  positions jsonb not null default '[]'::jsonb
    check (jsonb_typeof(positions) = 'array' and jsonb_array_length(positions) <= 8),
  -- [{ id, label, type: short|long|select, options: text[], required }], max 6
  questions jsonb not null default '[]'::jsonb
    check (jsonb_typeof(questions) = 'array' and jsonb_array_length(questions) <= 6),
  created_by uuid null references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists calls_committee_id_idx on public.calls (committee_id);
create index if not exists calls_status_deadline_idx on public.calls (status, deadline);
create index if not exists calls_created_by_idx on public.calls (created_by);

-- Reproduces sanitizeCall_ from officers.gs: trims and caps every string, drops positions
-- without a title and questions without a label, coerces unknown question types to 'short',
-- downgrades a 'select' with no options, and pins created_by/committee on edits.
create or replace function app.normalize_call()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_positions jsonb := '[]'::jsonb;
  v_questions jsonb := '[]'::jsonb;
  v_item jsonb;
  v_title text;
  v_label text;
  v_type text;
  v_options jsonb;
  v_id text;
  v_i int := 0;
begin
  new.title := left(btrim(coalesce(new.title, '')), 140);
  new.kind := left(btrim(coalesce(new.kind, '')), 60);
  new.summary := left(btrim(coalesce(new.summary, '')), 300);
  new.description := left(btrim(coalesce(new.description, '')), 4000);
  new.commitment := left(btrim(coalesce(new.commitment, '')), 140);
  new.notify_email := app.norm_email(new.notify_email);
  if new.notify_email is not null and new.notify_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    new.notify_email := null;
  end if;

  for v_item in
    select e from jsonb_array_elements(
      case when jsonb_typeof(new.positions) = 'array' then new.positions else '[]'::jsonb end
    ) as t(e)
  loop
    exit when jsonb_array_length(v_positions) >= 8;
    if jsonb_typeof(v_item) <> 'object' then
      continue;
    end if;
    v_title := app.jtext(v_item -> 'title', 120);
    if v_title = '' then
      continue;
    end if;
    v_id := app.jtext(v_item -> 'id', 60);
    if v_id = '' then
      v_id := 'p' || v_i::text;
    end if;
    v_positions := v_positions || jsonb_build_object(
      'id', v_id,
      'title', v_title,
      'blurb', app.jtext(v_item -> 'blurb', 400),
      'slots', app.jtext(v_item -> 'slots', 40)
    );
    v_i := v_i + 1;
  end loop;

  v_i := 0;
  for v_item in
    select e from jsonb_array_elements(
      case when jsonb_typeof(new.questions) = 'array' then new.questions else '[]'::jsonb end
    ) as t(e)
  loop
    exit when jsonb_array_length(v_questions) >= 6;
    if jsonb_typeof(v_item) <> 'object' then
      continue;
    end if;
    v_label := app.jtext(v_item -> 'label', 200);
    if v_label = '' then
      continue;
    end if;
    v_type := app.jtext(v_item -> 'type', 20);
    if v_type not in ('short', 'long', 'select') then
      v_type := 'short';
    end if;
    v_options := app.jtext_array(v_item -> 'options', 120, 12);
    if v_type = 'select' and jsonb_array_length(v_options) = 0 then
      v_type := 'short';
    end if;
    if v_type <> 'select' then
      v_options := '[]'::jsonb;
    end if;
    v_id := app.jtext(v_item -> 'id', 60);
    if v_id = '' then
      v_id := 'q' || v_i::text;
    end if;
    v_questions := v_questions || jsonb_build_object(
      'id', v_id,
      'label', v_label,
      'type', v_type,
      'options', v_options,
      'required', coalesce((v_item ->> 'required') in ('true', 't', '1'), false)
    );
    v_i := v_i + 1;
  end loop;

  new.positions := v_positions;
  new.questions := v_questions;

  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  else
    -- a call can never be re-homed or re-attributed after creation (writeCall_ kept the row's
    -- slug and createdBy on edit)
    new.committee_id := old.committee_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end
$$;

drop trigger if exists normalize_call on public.calls;
create trigger normalize_call before insert or update on public.calls
  for each row execute function app.normalize_call();
drop trigger if exists set_updated_at on public.calls;
create trigger set_updated_at before update on public.calls
  for each row execute function app.set_updated_at();
drop trigger if exists audit on public.calls;
create trigger audit after insert or update or delete on public.calls
  for each row execute function app.audit();

-- ---------------------------------------------------------------------------------------------
-- applications
-- ---------------------------------------------------------------------------------------------

create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  ref text not null check (length(ref) <= 40),
  call_id uuid null references public.calls (id) on delete set null,
  committee_id uuid not null references public.committees (id) on delete cascade,
  call_title text not null default '',
  name text not null check (name <> '' and length(name) <= 140),
  email text not null check (length(email) <= 200),
  email_normalized text generated always as (app.norm_email(email)) stored,
  phone text not null default '' check (length(phone) <= 60),
  year text not null default '' check (length(year) <= 60),
  -- position titles the applicant chose, resolved from the call's positions at submit time
  positions jsonb not null default '[]'::jsonb check (jsonb_typeof(positions) = 'array'),
  motivation text not null check (motivation <> '' and length(motivation) <= 4000),
  -- [{ id, label, value }], the call's questions as they were when the person applied
  answers jsonb not null default '[]'::jsonb check (jsonb_typeof(answers) = 'array'),
  status text not null default 'new' check (status in ('new', 'shortlisted', 'accepted', 'declined')),
  notes text not null default '' check (length(notes) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists applications_call_id_idx on public.applications (call_id);
create index if not exists applications_committee_id_created_at_idx
  on public.applications (committee_id, created_at);
create index if not exists applications_dedupe_idx
  on public.applications (call_id, email_normalized, created_at);
create index if not exists applications_created_at_idx on public.applications (created_at);

drop trigger if exists set_updated_at on public.applications;
create trigger set_updated_at before update on public.applications
  for each row execute function app.set_updated_at();
drop trigger if exists audit on public.applications;
create trigger audit after insert or update or delete on public.applications
  for each row execute function app.audit();

-- ---------------------------------------------------------------------------------------------
-- Public RPC: rpc/submit_application (anon + authenticated)
-- ---------------------------------------------------------------------------------------------

-- Mirrors apply_() in officers.gs, including its exact refusal messages (errcode 22023 so the
-- client can show the message as-is) and its quiet paths: a honeypot hit and a same-email repeat
-- within 24h both return ok without writing anything.
-- positions: the ids the applicant ticked; answers: { [question id]: value }.
create or replace function public.submit_application(
  call_id uuid,
  ref text,
  name text,
  email text,
  phone text default '',
  year text default '',
  positions text[] default '{}',
  motivation text default '',
  answers jsonb default '{}'::jsonb,
  website text default ''
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_call public.calls%rowtype;
  v_ref text := left(btrim(coalesce(submit_application.ref, '')), 40);
  v_name text := left(btrim(coalesce(submit_application.name, '')), 140);
  v_email text := left(btrim(coalesce(submit_application.email, '')), 200);
  v_phone text := left(btrim(coalesce(submit_application.phone, '')), 60);
  v_year text := left(btrim(coalesce(submit_application.year, '')), 60);
  v_motivation text := left(btrim(coalesce(submit_application.motivation, '')), 4000);
  v_positions jsonb := '[]'::jsonb;
  v_answers jsonb := '[]'::jsonb;
  v_q jsonb;
  v_value text;
  v_id uuid;
begin
  select * into v_call from public.calls c where c.id = submit_application.call_id;
  if not found then
    raise exception 'That call is no longer available.' using errcode = '22023';
  end if;
  if not app.call_is_live(v_call.status, v_call.deadline) then
    raise exception 'This call has closed.' using errcode = '22023';
  end if;

  if v_ref = '' then
    v_ref := 'CALL-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  end if;

  -- honeypot: bots fill the hidden field; pretend it worked
  if btrim(coalesce(website, '')) <> '' then
    return jsonb_build_object('ok', true, 'ref', v_ref);
  end if;

  if v_name = '' or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Please enter your name and a valid email address.' using errcode = '22023';
  end if;
  if v_motivation = '' then
    raise exception 'Please tell us why you want to join.' using errcode = '22023';
  end if;

  -- positions: ids -> titles, unknown ids dropped, max 8
  select coalesce(jsonb_agg(p ->> 'title'), '[]'::jsonb)
    into v_positions
  from (
    select p
    from jsonb_array_elements(v_call.positions) as t(p)
    where (p ->> 'id') = any (coalesce(submit_application.positions, '{}'))
    limit 8
  ) s;
  if jsonb_array_length(v_call.positions) > 0 and jsonb_array_length(v_positions) = 0 then
    raise exception 'Please choose at least one position.' using errcode = '22023';
  end if;

  -- answers: keyed by question id on the way in, stored with id + label; select answers must be
  -- one of the options; required questions must be answered
  if answers is null or jsonb_typeof(answers) <> 'object' then
    answers := '{}'::jsonb;
  end if;
  for v_q in select q from jsonb_array_elements(v_call.questions) as t(q) loop
    v_value := left(btrim(coalesce(answers ->> (v_q ->> 'id'), '')), 2000);
    if (v_q ->> 'type') = 'select' and v_value <> ''
       and not (v_q -> 'options') ? v_value then
      v_value := '';
    end if;
    if coalesce((v_q ->> 'required')::boolean, false) and v_value = '' then
      raise exception 'Please answer: %', v_q ->> 'label' using errcode = '22023';
    end if;
    if v_value <> '' then
      v_answers := v_answers || jsonb_build_object(
        'id', v_q ->> 'id', 'label', v_q ->> 'label', 'value', v_value
      );
    end if;
  end loop;

  -- abuse guards: same applicant on the same call within 24h is a quiet no-op; 20/min globally
  if exists (
    select 1 from public.applications a
    where a.call_id = v_call.id
      and a.email_normalized = app.norm_email(v_email)
      and a.created_at > now() - interval '24 hours'
  ) then
    return jsonb_build_object('ok', true, 'ref', v_ref, 'duplicate', true);
  end if;
  if (select count(*) from public.applications a where a.created_at > now() - interval '1 minute') >= 20 then
    raise exception 'Too many applications right now, please retry shortly.' using errcode = '22023';
  end if;

  insert into public.applications (
    ref, call_id, committee_id, call_title, name, email, phone, year, positions, motivation, answers
  )
  values (
    v_ref, v_call.id, v_call.committee_id, v_call.title, v_name, v_email, v_phone, v_year,
    v_positions, v_motivation, v_answers
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'ref', v_ref, 'id', v_id);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- open_calls: what the public site reads. security_invoker, so anon's column grant and the
-- calls_select policy apply; the view only adds the slug join, the live filter and the order.
-- ---------------------------------------------------------------------------------------------

create or replace view public.open_calls
with (security_invoker = true)
as
  select
    c.id, m.slug, c.title, c.kind, c.summary, c.description, c.commitment,
    c.deadline, c.positions, c.questions
  from public.calls c
  join public.committees m on m.id = c.committee_id
  where app.call_is_live(c.status, c.deadline)
  order by c.deadline asc nulls last, c.created_at asc;

-- ---------------------------------------------------------------------------------------------
-- Grants + RLS
-- ---------------------------------------------------------------------------------------------

alter table public.calls enable row level security;
alter table public.applications enable row level security;

-- Visitors read the public columns of live calls (never notify_email / created_by). Signed-in
-- users get every column, but only see rows they may edit or that are live.
grant select (id, committee_id, status, title, kind, summary, description, commitment, deadline,
              positions, questions, created_at, updated_at)
  on public.calls to anon;
grant select, insert, update, delete on public.calls to authenticated;
grant select on public.open_calls to anon, authenticated;
grant select, update, delete on public.applications to authenticated;
grant all on public.calls, public.applications to service_role;

-- Split by role: anon has no EXECUTE on app.is_officer_of, and a policy expression runs as the
-- caller, so a shared policy would fail for visitors.
drop policy if exists calls_select_anon on public.calls;
create policy calls_select_anon on public.calls
  for select to anon
  using (app.call_is_live(status, deadline));
drop policy if exists calls_select on public.calls;
create policy calls_select on public.calls
  for select to authenticated
  using (
    app.call_is_live(status, deadline)
    or (select app.is_officer_of(committee_id))
  );
drop policy if exists calls_insert on public.calls;
create policy calls_insert on public.calls
  for insert to authenticated
  with check ((select app.is_officer_of(committee_id)));
drop policy if exists calls_update on public.calls;
create policy calls_update on public.calls
  for update to authenticated
  using ((select app.is_officer_of(committee_id)))
  with check ((select app.is_officer_of(committee_id)));
drop policy if exists calls_delete on public.calls;
create policy calls_delete on public.calls
  for delete to authenticated
  using ((select app.is_officer_of(committee_id)));

-- Applications carry personal data: the committee's officers (and EB) read and triage them;
-- nobody inserts directly (submit_application only); only EB deletes.
drop policy if exists applications_select on public.applications;
create policy applications_select on public.applications
  for select to authenticated
  using ((select app.is_officer_of(committee_id)));
drop policy if exists applications_update on public.applications;
create policy applications_update on public.applications
  for update to authenticated
  using ((select app.is_officer_of(committee_id)))
  with check ((select app.is_officer_of(committee_id)));
drop policy if exists applications_delete on public.applications;
create policy applications_delete on public.applications
  for delete to authenticated
  using ((select app.is_eb()));

-- ---------------------------------------------------------------------------------------------
-- Ownership + grants on functions
-- ---------------------------------------------------------------------------------------------

alter function app.today_cairo() owner to postgres;
alter function app.call_is_live(text, date) owner to postgres;
alter function app.normalize_call() owner to postgres;
alter function public.submit_application(uuid, text, text, text, text, text, text[], text, jsonb, text)
  owner to postgres;

revoke execute on function app.today_cairo() from public;
revoke execute on function app.call_is_live(text, date) from public;
revoke execute on function app.normalize_call() from public;
grant execute on function app.today_cairo() to anon, authenticated, service_role;
grant execute on function app.call_is_live(text, date) to anon, authenticated, service_role;

revoke execute on function public.submit_application(uuid, text, text, text, text, text, text[], text, jsonb, text)
  from public;
grant execute on function public.submit_application(uuid, text, text, text, text, text, text[], text, jsonb, text)
  to anon, authenticated;
