-- Phase 3 (portal core), part 3: the daily email digest.
--
-- One email per person per day at most, and only when there is something they have not seen:
-- unread notifications that were never emailed, and live updates addressed to them that they
-- have not read and that went out since their last digest. People opt out with
-- profiles.email_digest. The Edge Function `email-digest` does the sending (Resend); the
-- database decides who gets what (admin_digest_batch) and records what went out
-- (admin_digest_mark), both callable with the secret key only.
--
-- Resend's free plan allows 100 emails a day and sign-in links share that allowance, so a run
-- takes at most `max_people` (80 by default), longest-waiting first. Whoever does not fit stays
-- unmarked and is first in line the next day.

alter table public.profiles add column if not exists last_digest_at timestamptz null;

-- What each run did, for the EB and for debugging "I never got the email".
create table if not exists public.digest_runs (
  id bigint generated always as identity primary key,
  ran_at timestamptz not null default now(),
  sent int not null default 0,
  failed int not null default 0,
  note text not null default '' check (length(note) <= 500)
);

alter table public.digest_runs enable row level security;
grant select on public.digest_runs to authenticated;
grant all on public.digest_runs to service_role;
grant usage, select on sequence public.digest_runs_id_seq to service_role;

drop policy if exists digest_runs_select on public.digest_runs;
create policy digest_runs_select on public.digest_runs
  for select to authenticated
  using ((select app.is_eb()));

-- app.post_in_audience() for an arbitrary person instead of the caller. The EB sees every post
-- in the portal, but is only emailed about posts actually addressed to them.
create or replace function app.post_reaches(p_profile uuid, p_committee uuid, p_levels text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_committee is null and cardinality(p_levels) = 0 then
      exists (
        select 1 from public.profiles pr
        where pr.id = p_profile and pr.membership_status <> 'unverified'
      )
      or exists (
        select 1 from public.assignments a
        where a.profile_id = p_profile and a.status = 'active' and a.term_id = app.current_term_id()
      )
    else exists (
      select 1
      from public.assignments a
      join public.positions p on p.id = a.position_id
      where a.profile_id = p_profile
        and a.status = 'active'
        and a.term_id = app.current_term_id()
        and (p_committee is null or p.committee_id = p_committee)
        and (cardinality(p_levels) = 0 or p.level = any (p_levels))
    )
  end
$$;

-- [{ profile_id, email, full_name, notifications: [{kind, payload, created_at}],
--    posts: [{id, title, kind, committee}] }]
create or replace function public.admin_digest_batch(max_people int default 80)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with people as (
    select pr.id, pr.email, pr.full_name, pr.last_digest_at
    from public.profiles pr
    where pr.email_digest
      and pr.email is not null
      -- never twice within a day, whatever the schedule does
      and (pr.last_digest_at is null or pr.last_digest_at < now() - interval '20 hours')
  ),
  items as (
    select
      pe.id, pe.email, pe.full_name, pe.last_digest_at,
      (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'kind', n.kind, 'payload', n.payload, 'created_at', n.created_at
               ) order by n.created_at desc), '[]'::jsonb)
        from (
          select * from public.notifications n
          where n.profile_id = pe.id and n.read_at is null and n.emailed_at is null
          order by n.created_at desc
          limit 15
        ) n
      ) as notifications,
      (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'id', po.id, 'title', po.title, 'kind', po.kind, 'committee', po.abbr
               ) order by po.publish_at desc), '[]'::jsonb)
        from (
          select p.id, p.title, p.kind, p.publish_at, c.abbr
          from public.posts p
          left join public.committees c on c.id = p.committee_id
          where app.post_is_live(p.publish_at, p.expires_at)
            and p.publish_at > coalesce(pe.last_digest_at, now() - interval '7 days')
            and p.author_id is distinct from pe.id
            and app.post_reaches(pe.id, p.committee_id, p.levels)
            and not exists (
              select 1 from public.post_reads r where r.post_id = p.id and r.profile_id = pe.id
            )
          order by p.publish_at desc
          limit 10
        ) po
      ) as posts
    from people pe
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'profile_id', i.id, 'email', i.email, 'full_name', i.full_name,
           'notifications', i.notifications, 'posts', i.posts
         )), '[]'::jsonb)
  from (
    select * from items
    where jsonb_array_length(notifications) > 0 or jsonb_array_length(posts) > 0
    order by last_digest_at asc nulls first
    limit greatest(1, least(coalesce(max_people, 80), 95))
  ) i
$$;

-- Called once per run with the people whose email was accepted by Resend.
create or replace function public.admin_digest_mark(sent uuid[], failed int default 0, note text default '')
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.notifications n
     set emailed_at = now()
   where n.profile_id = any (coalesce(sent, '{}'))
     and n.read_at is null
     and n.emailed_at is null;
  update public.profiles pr
     set last_digest_at = now()
   where pr.id = any (coalesce(sent, '{}'));
  insert into public.digest_runs (sent, failed, note)
  values (coalesce(cardinality(sent), 0), coalesce(failed, 0), left(coalesce(note, ''), 500));
end
$$;

-- The daily job proves itself to the Edge Function with its own Vault secret (same scheme as
-- roster-sheet-sync): generated here, never printed, checked through a secret-key-only RPC.
select vault.create_secret(
  replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  'digest_cron_secret',
  'Sent by the email-digest cron job to the Edge Function of the same name'
)
where not exists (select 1 from vault.secrets where name = 'digest_cron_secret');

create or replace function public.admin_digest_cron_secret_ok(secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(secret, '') <> '' and exists (
    select 1 from vault.decrypted_secrets d
    where d.name = 'digest_cron_secret' and d.decrypted_secret = admin_digest_cron_secret_ok.secret
  )
$$;

alter function app.post_reaches(uuid, uuid, text[]) owner to postgres;
alter function public.admin_digest_batch(int) owner to postgres;
alter function public.admin_digest_mark(uuid[], int, text) owner to postgres;
alter function public.admin_digest_cron_secret_ok(text) owner to postgres;

revoke execute on function app.post_reaches(uuid, uuid, text[]) from public;
revoke execute on function public.admin_digest_batch(int) from public, anon, authenticated;
revoke execute on function public.admin_digest_mark(uuid[], int, text) from public, anon, authenticated;
revoke execute on function public.admin_digest_cron_secret_ok(text) from public, anon, authenticated;
grant execute on function public.admin_digest_batch(int) to service_role;
grant execute on function public.admin_digest_mark(uuid[], int, text) to service_role;
grant execute on function public.admin_digest_cron_secret_ok(text) to service_role;

-- Every day at 15:30 UTC (early evening in Cairo, after lectures). The function authenticates
-- the caller itself, hence verify_jwt = false in config.toml.
select cron.unschedule(jobid) from cron.job where jobname = 'email-digest';
select cron.schedule(
  'email-digest',
  '30 15 * * *',
  $cron$
    select net.http_post(
      url := 'https://wjijkqrdaakiwbtdssio.supabase.co/functions/v1/email-digest',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'digest_cron_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    )
  $cron$
);
