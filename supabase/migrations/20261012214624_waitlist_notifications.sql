-- Notifications for the waitlist.
--
-- A new merch order and a new exchange story have told the people who handle them ever since
-- the public forms moved here (20260925090001_submissions): a line under the portal's bell, on
-- the Notifications page and in the daily email. A sign-up for the recruitment waitlist told
-- nobody. It showed on the Submissions page and in the count on the dashboard, and that was
-- all. The webmaster asked on 2026-10-13 for the portal's notifications to cover everything new
-- on the Submissions page.
--
-- From this migration on a sign-up for the waitlist notifies the Executive Board and the
-- webmaster, who are the people the Waitlist tab is for (app.can_triage('signup'),
-- app.triage_recipients('signup')).
--
-- One notification, which counts. Orders and stories come one at a time, and each gets a line
-- of its own. Sign-ups come by the hundred when recruitment is announced, and a line for each
-- would bury everything else under the bell and in the email. So a person has at most one
-- unread 'signup_new' notification. The first sign-up makes it. Every sign-up after that, until
-- the person reads it, adds one to its count, puts the latest name on it and brings it back to
-- the top of the list. Once it is read, the next sign-up starts a new one. A unique index over
-- the unread ones holds that rule, so two sign-ups in the same instant cannot make two lines.
--
--   payload: { submission_id, name, count }
--   submission_id and name are the latest sign-up's; name is '' when the visitor left none.
--
-- The daily email mentions a notification once (emailed_at). A counted one goes back in line
-- whenever its count rises, so the next email says how many are waiting by then. That is still
-- one email a day to a person at most (admin_digest_batch).
--
-- Only the waitlist notifies. The 'newsletter' kind is kept for rows that exist; no form sends
-- it any more, and it tells nobody.

-- ---------------------------------------------------------------------------------------------
-- One unread waitlist notification to a person
-- ---------------------------------------------------------------------------------------------

create unique index if not exists notifications_unread_signup_idx
  on public.notifications (profile_id)
  where kind = 'signup_new' and read_at is null;

-- Tells everyone who handles the waitlist of one more sign-up: a new line for whoever has no
-- unread one, one more on the count for whoever has. app.triage_recipients names each person
-- once, so no line is touched twice by one call. The people are taken in one fixed order, so
-- two sign-ups arriving together lock their lines in the same order and the second waits for
-- the first instead of each waiting on the other.
create or replace function app.notify_signup(p_id uuid, p_name text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.notifications as n (profile_id, kind, payload)
  select r, 'signup_new', jsonb_build_object('submission_id', p_id, 'name', coalesce(p_name, ''), 'count', 1)
  from app.triage_recipients('signup') as r
  order by r
  on conflict (profile_id) where kind = 'signup_new' and read_at is null
  do update set
    payload = jsonb_build_object(
      'submission_id', excluded.payload -> 'submission_id',
      'name', excluded.payload -> 'name',
      'count', coalesce((n.payload ->> 'count')::int, 1) + 1
    ),
    created_at = now(),
    emailed_at = null
$$;

-- ---------------------------------------------------------------------------------------------
-- rpc/submit_signup (anon + authenticated): as before, and now it notifies
-- ---------------------------------------------------------------------------------------------

-- Mirrors signups.gs: same email for the same kind within 24h is a quiet no-op, 30/min globally.
-- A sign-up that is stored is the only one that notifies: not a duplicate, not a bot's.
create or replace function public.submit_signup(
  email text,
  name text default '',
  kind text default 'waitlist',
  phone text default '',
  website text default ''
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_kind text := lower(btrim(coalesce(submit_signup.kind, '')));
  v_name text := left(btrim(coalesce(submit_signup.name, '')), 140);
  v_email text := left(btrim(coalesce(submit_signup.email, '')), 200);
  v_phone text := left(btrim(coalesce(submit_signup.phone, '')), 60);
  v_id uuid;
begin
  if v_kind not in ('waitlist', 'newsletter') then
    v_kind := 'waitlist';
  end if;
  -- honeypot: bots fill the hidden field; pretend it worked
  if btrim(coalesce(website, '')) <> '' then
    return jsonb_build_object('ok', true);
  end if;
  if not app.valid_email(v_email) then
    raise exception 'Please enter a valid email address.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.signups s
    where s.kind = v_kind
      and s.email_normalized = app.norm_email(v_email)
      and s.created_at > now() - interval '24 hours'
  ) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  if (select count(*) from public.signups s where s.created_at > now() - interval '1 minute') >= 30 then
    raise exception 'Too many sign-ups right now, please retry shortly.' using errcode = '22023';
  end if;

  insert into public.signups (kind, name, email, phone)
  values (v_kind, v_name, v_email, v_phone)
  returning id into v_id;

  if v_kind = 'waitlist' then
    perform app.notify_signup(v_id, v_name);
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Ownership + grants on functions
-- ---------------------------------------------------------------------------------------------

alter function app.notify_signup(uuid, text) owner to postgres;
alter function public.submit_signup(text, text, text, text, text) owner to postgres;

-- Only submit_signup calls it, as its owner.
revoke execute on function app.notify_signup(uuid, text) from public;

revoke execute on function public.submit_signup(text, text, text, text, text) from public;
grant execute on function public.submit_signup(text, text, text, text, text) to anon, authenticated;
