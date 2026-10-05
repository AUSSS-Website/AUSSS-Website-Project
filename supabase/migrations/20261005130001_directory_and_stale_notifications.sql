-- Phase 5b, two follow-ups from the first look at it in a browser.
--
-- 1. The directory lists every member. The first version listed only people who had turned a
--    switch on; the webmaster asked for everyone to be listed and for the switch to go. "Every
--    member" means the people the society knows (verified, or holding a position this term) who
--    have an account: an account anybody could have made by signing in with Google is not
--    listed until it is verified. profiles.directory_opt_in stays as a column and is not read.
--
-- 2. A deleted task takes its notifications with it. They used to stay in the feed, pointing
--    at a task that no longer exists, which read as if clearing the notification had removed
--    the task. Notifications carry the task in their payload, not in a column, so a foreign key
--    cannot do this; a trigger does.

-- ---------------------------------------------------------------------------------------------
-- rpc/directory: every member with an account
-- ---------------------------------------------------------------------------------------------

create or replace function public.directory()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_member() then
    raise exception 'Members only.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(entry order by entry ->> 'full_name', entry ->> 'id')
    from (
      select jsonb_build_object(
        'id', pr.id,
        'full_name', btrim(pr.full_name),
        'avatar_url', pr.avatar_url,
        'positions', coalesce((
          select jsonb_agg(
            jsonb_build_object('title', p.title, 'level', p.level, 'committee', c.abbr)
            order by app.level_rank(p.level) desc, p.sort
          )
          from public.assignments a
          join public.positions p on p.id = a.position_id
          left join public.committees c on c.id = p.committee_id
          where a.profile_id = pr.id and a.status = 'active' and a.term_id = app.current_term_id()
        ), '[]'::jsonb)
      ) as entry
      from public.profiles pr
      where btrim(coalesce(pr.full_name, '')) <> ''
        and (
          pr.membership_status <> 'unverified'
          or exists (
            select 1 from public.assignments a
            where a.profile_id = pr.id and a.status = 'active' and a.term_id = app.current_term_id()
          )
        )
      limit 2000
    ) entries
  ), '[]'::jsonb);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Notifications of a deleted task go with it
-- ---------------------------------------------------------------------------------------------

create index if not exists notifications_task_id_idx
  on public.notifications ((payload ->> 'task_id'))
  where payload ? 'task_id';

create or replace function app.drop_task_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.notifications n
   where n.payload ? 'task_id' and n.payload ->> 'task_id' = old.id::text;
  return null;
end
$$;

drop trigger if exists drop_task_notifications on public.tasks;
create trigger drop_task_notifications after delete on public.tasks
  for each row execute function app.drop_task_notifications();

-- the ones already orphaned
delete from public.notifications n
 where n.payload ? 'task_id'
   and not exists (select 1 from public.tasks t where t.id::text = n.payload ->> 'task_id');

alter function app.drop_task_notifications() owner to postgres;
revoke execute on function app.drop_task_notifications() from public;
