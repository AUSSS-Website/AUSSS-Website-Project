-- The daily email is switched off, and has a switch.
--
-- Since 20260920210001_email_digest everyone with something unread has been in line for one
-- email a day, unless they turned it off on their own profile. The webmaster asked on
-- 2026-10-13 to cancel the daily email altogether for now.
--
-- It becomes a site setting, `emailDigestLive`, like the other switches on the Site settings
-- page. While it is not true, rpc/admin_digest_batch answers with nobody, so the daily job
-- still calls the Edge Function `email-digest` and the function sends nothing and records
-- nothing. A missing row means off, as with every switch. The row is written here as false so
-- that the setting can be seen in the table.
--
-- Nothing else changes. Notifications are written as before and show under the portal's bell
-- and on the Notifications page. Each person's own choice (profiles.email_digest) is kept, and
-- counts again once the switch is on. Nothing is marked as emailed meanwhile, so the first
-- email after the switch is turned on carries what is still unread by then.

insert into public.site_settings (key, value)
values ('emailDigestLive', 'false'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------------------------
-- rpc/admin_digest_batch (secret key only): as before, and nobody while the switch is off
-- ---------------------------------------------------------------------------------------------

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
      -- nobody at all while the daily email is switched off (a missing row is off)
      and coalesce((select s.value from public.site_settings s where s.key = 'emailDigestLive'), 'false'::jsonb) = 'true'::jsonb
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

-- ---------------------------------------------------------------------------------------------
-- Ownership + grants on functions
-- ---------------------------------------------------------------------------------------------

alter function public.admin_digest_batch(int) owner to postgres;

revoke execute on function public.admin_digest_batch(int) from public, anon, authenticated;
grant execute on function public.admin_digest_batch(int) to service_role;
