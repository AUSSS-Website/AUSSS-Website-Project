-- Campaigns: the portal's Tasks page becomes Campaigns.
--
-- An officer (or anyone who may hand out tasks in a committee) opens a campaign, and inside it
-- makes subtasks: a small working group, a single job, whatever the campaign is split into. A
-- subtask is a row of public.tasks with its campaign named, so it keeps everything a task
-- already had: its own people, status, due date, files and timeline. Each subtask has its own
-- people, and a person sees only the subtasks they are on.
--
-- Notes, three kinds:
--   * on a campaign: public.campaign_notes, written by anyone who can see the campaign;
--   * on a subtask: the comments of its timeline, as before (the portal now calls them notes);
--   * on a person in a subtask: task_assignees.note, a line such as "Coordinator", written by
--     whoever manages the subtask.
--
-- Who may do what:
--   * open a campaign: whoever may hand out tasks in that committee (app.can_assign_tasks_in);
--     a campaign with no committee is society-wide, for the Executive Board;
--   * manage it (edit, delete, and manage every subtask in it): the committee's officers and
--     the EB, or its creator for as long as they may still hand out tasks there;
--   * see it: its managers, whoever may hand out tasks in that committee, and everybody
--     assigned to one of its subtasks.
--
-- Tasks made before this file have no campaign and keep working as they did. The portal only
-- makes subtasks from now on.

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  committee_id uuid null references public.committees (id) on delete cascade,
  -- the term it was opened in; it does not move with the rollover
  term_id uuid not null references public.terms (id) on delete restrict,
  title text not null check (title <> '' and length(title) <= 200),
  body text not null default '' check (length(body) <= 8000),
  status text not null default 'planning' check (status in ('planning', 'running', 'done')),
  -- Cairo calendar days, both optional
  starts_on date null,
  ends_on date null,
  created_by uuid null references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaigns_dates_check check (starts_on is null or ends_on is null or ends_on >= starts_on)
);

create index if not exists campaigns_committee_id_idx on public.campaigns (committee_id);
create index if not exists campaigns_term_id_idx on public.campaigns (term_id);
create index if not exists campaigns_created_by_idx on public.campaigns (created_by);

create table if not exists public.campaign_notes (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  author_id uuid null references public.profiles (id) on delete set null,
  body text not null check (body <> '' and length(body) <= 4000),
  created_at timestamptz not null default now()
);

create index if not exists campaign_notes_campaign_id_created_at_idx
  on public.campaign_notes (campaign_id, created_at);
create index if not exists campaign_notes_author_id_idx on public.campaign_notes (author_id);

-- A subtask names its campaign; deleting the campaign takes its subtasks along.
alter table public.tasks
  add column if not exists campaign_id uuid null references public.campaigns (id) on delete cascade;
create index if not exists tasks_campaign_id_idx on public.tasks (campaign_id);

-- A line about one person in one subtask ("Coordinator", "Handles the sponsors").
alter table public.task_assignees
  add column if not exists note text not null default '';
alter table public.task_assignees drop constraint if exists task_assignees_note_check;
alter table public.task_assignees add constraint task_assignees_note_check
  check (length(note) <= 200);

-- A deleted campaign takes the notifications about its notes with it (as tasks do theirs).
create index if not exists notifications_campaign_id_idx
  on public.notifications ((payload ->> 'campaign_id'))
  where payload ? 'campaign_id';

-- ---------------------------------------------------------------------------------------------
-- Who may see and manage a campaign (security definer, so policies never recurse)
-- ---------------------------------------------------------------------------------------------

create or replace function app.can_manage_campaign(p_campaign uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.campaigns c
    where c.id = p_campaign
      and (
        app.is_officer_of(c.committee_id)
        or (c.created_by = (select auth.uid()) and app.can_assign_tasks_in(c.committee_id))
      )
  )
$$;

-- Assigned to one of its subtasks.
create or replace function app.is_campaign_member(p_campaign uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tasks t
    join public.task_assignees ta on ta.task_id = t.id
    where t.campaign_id = p_campaign and ta.profile_id = (select auth.uid())
  )
$$;

create or replace function app.can_see_campaign(p_campaign uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.campaigns c
    where c.id = p_campaign
      and (c.created_by = (select auth.uid()) or app.can_assign_tasks_in(c.committee_id))
  ) or app.is_campaign_member(p_campaign)
$$;

-- As 20260920200001, and a campaign's manager manages every subtask in it.
create or replace function app.can_manage_task(p_task uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task
      and (
        app.is_officer_of(t.committee_id)
        or (t.created_by = (select auth.uid()) and app.can_assign_tasks_in(t.committee_id))
        or app.can_manage_campaign(t.campaign_id)
      )
  )
$$;

create or replace function app.can_see_task(p_task uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task
      and (
        t.created_by = (select auth.uid())
        or app.is_officer_of(t.committee_id)
        or app.can_manage_campaign(t.campaign_id)
      )
  ) or app.is_task_assignee(p_task)
$$;

-- ---------------------------------------------------------------------------------------------
-- Triggers: campaigns
-- ---------------------------------------------------------------------------------------------

create or replace function app.guard_campaign()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.title := left(btrim(coalesce(new.title, '')), 200);
  new.body := left(btrim(coalesce(new.body, '')), 8000);

  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    -- a signed-in person opens it in the current term; only a script may name another
    if auth.uid() is not null or new.term_id is null then
      new.term_id := app.current_term_id();
    end if;
    return new;
  end if;

  -- a campaign is never re-homed or re-attributed
  new.committee_id := old.committee_id;
  new.term_id := old.term_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  return new;
end
$$;

create or replace function app.drop_campaign_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.notifications n
   where n.payload ? 'campaign_id' and n.payload ->> 'campaign_id' = old.id::text;
  return null;
end
$$;

drop trigger if exists guard_campaign on public.campaigns;
create trigger guard_campaign before insert or update on public.campaigns
  for each row execute function app.guard_campaign();
drop trigger if exists set_updated_at on public.campaigns;
create trigger set_updated_at before update on public.campaigns
  for each row execute function app.set_updated_at();
drop trigger if exists drop_campaign_notifications on public.campaigns;
create trigger drop_campaign_notifications after delete on public.campaigns
  for each row execute function app.drop_campaign_notifications();
drop trigger if exists audit on public.campaigns;
create trigger audit after insert or update or delete on public.campaigns
  for each row execute function app.audit();

-- ---------------------------------------------------------------------------------------------
-- Triggers: campaign_notes
-- ---------------------------------------------------------------------------------------------

create or replace function app.guard_campaign_note()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.body := left(btrim(coalesce(new.body, '')), 4000);
  new.author_id := coalesce(auth.uid(), new.author_id);
  new.created_at := now();
  if new.body = '' then
    raise exception 'Write something first.' using errcode = '22023';
  end if;
  return new;
end
$$;

-- One notification for everybody in the campaign (its creator and the people on its subtasks),
-- minus whoever wrote the note.
create or replace function app.notify_campaign_note()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (profile_id, kind, payload)
  select who.profile_id, 'campaign_note',
         jsonb_build_object('campaign_id', c.id, 'title', c.title, 'committee_id', c.committee_id,
                            'actor_id', new.author_id, 'excerpt', left(new.body, 140))
  from public.campaigns c
  cross join lateral (
    select c.created_by as profile_id
    union
    select ta.profile_id
    from public.tasks t
    join public.task_assignees ta on ta.task_id = t.id
    where t.campaign_id = c.id
  ) who
  where c.id = new.campaign_id
    and who.profile_id is not null
    and who.profile_id is distinct from new.author_id;
  return null;
end
$$;

drop trigger if exists guard_campaign_note on public.campaign_notes;
create trigger guard_campaign_note before insert on public.campaign_notes
  for each row execute function app.guard_campaign_note();
drop trigger if exists notify_campaign_note on public.campaign_notes;
create trigger notify_campaign_note after insert on public.campaign_notes
  for each row execute function app.notify_campaign_note();
drop trigger if exists audit on public.campaign_notes;
create trigger audit after insert or update or delete on public.campaign_notes
  for each row execute function app.audit();

-- ---------------------------------------------------------------------------------------------
-- Tasks: a subtask sits in its campaign's committee, and never changes campaign
-- ---------------------------------------------------------------------------------------------

-- As 20261008120001, plus the campaign. The committee of a subtask is its campaign's, whatever
-- the request says, and it is set before the insert policy looks at the row: so whoever may
-- hand out tasks in the campaign's committee may add a subtask to it, and nobody else.
create or replace function app.guard_task()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  new.title := left(btrim(coalesce(new.title, '')), 200);
  new.body := left(btrim(coalesce(new.body, '')), 8000);

  if tg_op = 'INSERT' then
    if new.campaign_id is not null then
      select c.committee_id into new.committee_id
      from public.campaigns c where c.id = new.campaign_id;
      if not found then
        raise exception 'That campaign no longer exists.' using errcode = '22023';
      end if;
    end if;
    new.created_by := coalesce(v_uid, new.created_by);
    new.term_id := coalesce(new.term_id, app.current_term_id());
    new.completed_at := case when new.status = 'done' then now() end;
    return new;
  end if;

  -- a task is never re-homed or re-attributed; its term moves only with the rollover
  new.committee_id := old.committee_id;
  new.campaign_id := old.campaign_id;
  if coalesce(current_setting('app.rolling_over', true), '') <> 'on' then
    new.term_id := old.term_id;
  end if;
  new.created_by := old.created_by;
  new.created_at := old.created_at;

  -- an assignee moves the status and nothing else (no session = service role / scripts)
  if v_uid is not null and not app.can_manage_task(old.id) then
    new.title := old.title;
    new.body := old.body;
    new.priority := old.priority;
    new.due_on := old.due_on;
  end if;

  if new.status = 'done' and old.status <> 'done' then
    new.completed_at := now();
  elsif new.status <> 'done' then
    new.completed_at := null;
  else
    new.completed_at := old.completed_at;
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Grants + RLS
-- ---------------------------------------------------------------------------------------------

alter table public.campaigns enable row level security;
alter table public.campaign_notes enable row level security;

revoke all on public.campaigns, public.campaign_notes from anon, authenticated;
grant select, insert, update, delete on public.campaigns to authenticated;
grant select, delete on public.campaign_notes to authenticated;
-- the author and the time are stamped by the trigger
grant insert (campaign_id, body) on public.campaign_notes to authenticated;
grant all on public.campaigns, public.campaign_notes to service_role;
-- the line about a person in a subtask, and nothing else of that row
grant update (note) on public.task_assignees to authenticated;

drop policy if exists campaigns_select on public.campaigns;
create policy campaigns_select on public.campaigns
  for select to authenticated
  using (
    created_by = (select auth.uid())
    or (select app.can_assign_tasks_in(committee_id))
    or (select app.is_campaign_member(id))
  );
drop policy if exists campaigns_insert on public.campaigns;
create policy campaigns_insert on public.campaigns
  for insert to authenticated
  with check ((select app.can_assign_tasks_in(committee_id)));
drop policy if exists campaigns_update on public.campaigns;
create policy campaigns_update on public.campaigns
  for update to authenticated
  using ((select app.can_manage_campaign(id)))
  with check ((select app.can_manage_campaign(id)));
drop policy if exists campaigns_delete on public.campaigns;
create policy campaigns_delete on public.campaigns
  for delete to authenticated
  using ((select app.can_manage_campaign(id)));

drop policy if exists campaign_notes_select on public.campaign_notes;
create policy campaign_notes_select on public.campaign_notes
  for select to authenticated
  using ((select app.can_see_campaign(campaign_id)));
drop policy if exists campaign_notes_insert on public.campaign_notes;
create policy campaign_notes_insert on public.campaign_notes
  for insert to authenticated
  with check (author_id = (select auth.uid()) and (select app.can_see_campaign(campaign_id)));
drop policy if exists campaign_notes_delete on public.campaign_notes;
create policy campaign_notes_delete on public.campaign_notes
  for delete to authenticated
  using (author_id = (select auth.uid()) or (select app.can_manage_campaign(campaign_id)));

-- As 20260920200001, and a campaign's manager reads every subtask in it.
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select to authenticated
  using (
    created_by = (select auth.uid())
    or (select app.is_officer_of(committee_id))
    or (select app.is_task_assignee(id))
    or (select app.can_manage_campaign(campaign_id))
  );

drop policy if exists task_assignees_update on public.task_assignees;
create policy task_assignees_update on public.task_assignees
  for update to authenticated
  using ((select app.can_manage_task(task_id)))
  with check ((select app.can_manage_task(task_id)));

-- ---------------------------------------------------------------------------------------------
-- Ownership + grants on functions
-- ---------------------------------------------------------------------------------------------

alter function app.can_manage_campaign(uuid) owner to postgres;
alter function app.is_campaign_member(uuid) owner to postgres;
alter function app.can_see_campaign(uuid) owner to postgres;
alter function app.can_manage_task(uuid) owner to postgres;
alter function app.can_see_task(uuid) owner to postgres;
alter function app.guard_campaign() owner to postgres;
alter function app.drop_campaign_notifications() owner to postgres;
alter function app.guard_campaign_note() owner to postgres;
alter function app.notify_campaign_note() owner to postgres;
alter function app.guard_task() owner to postgres;

revoke execute on function app.can_manage_campaign(uuid) from public;
revoke execute on function app.is_campaign_member(uuid) from public;
revoke execute on function app.can_see_campaign(uuid) from public;
revoke execute on function app.can_manage_task(uuid) from public;
revoke execute on function app.can_see_task(uuid) from public;
revoke execute on function app.guard_campaign() from public;
revoke execute on function app.drop_campaign_notifications() from public;
revoke execute on function app.guard_campaign_note() from public;
revoke execute on function app.notify_campaign_note() from public;
revoke execute on function app.guard_task() from public;
-- policy helpers run as the caller
grant execute on function app.can_manage_campaign(uuid) to authenticated;
grant execute on function app.is_campaign_member(uuid) to authenticated;
grant execute on function app.can_see_campaign(uuid) to authenticated;
grant execute on function app.can_manage_task(uuid) to authenticated;
grant execute on function app.can_see_task(uuid) to authenticated;
