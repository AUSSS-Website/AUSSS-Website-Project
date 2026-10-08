-- Phase 7, step 1: the term rollover, with the gallery archive as one of its steps.
--
-- Every access check reads the current term (app.current_term_id()), so switching the term on
-- its own would leave everyone, the board member who pressed the button included, holding
-- nothing. The rollover therefore prepares the next term first and switches last, all in one
-- call (rpc/roll_over_term), which the Executive Board runs from the portal:
--
--   1. the next term row is made (or the one already there is used);
--   2. the work accounts carry over: every position with a work email is offered to that
--      address for the next term, and app.handle_new_invite assigns the account straight away
--      when it exists (it signs in as before, and the incoming officer is simply handed the
--      account);
--   3. the roster's positions below officer are offered again for the next term, since the
--      roster says who holds them and the old offers belonged to the old term;
--   4. every open task (to do, doing, blocked) moves into the next term, as it is;
--   5. the albums the board ticked move to the gallery's archive, filed under the term that is
--      ending; their links keep working;
--   6. the term switches, the old term's assignments end (dated in Cairo), its offers nobody
--      took up are withdrawn, and the site is rebuilt.
--
-- It refuses to leave the society without a board: when no board or webmaster position would
-- be held in the new term (no work email, or no account at that address), nothing happens.
--
-- What it leaves alone: membership statuses (the board grants them on the Upgrades panel, never
-- automatically), posts (expired ones are already hidden), positions given by an invite that
-- the roster does not list (they belonged to the old term and end with it), and the seats and
-- secrets of HANDOVER section 6, which are people's work.
--
-- rpc/rollover_preview() shows the board all of the above before it presses the button.
--
-- Also here, because the archive changes albums: app.slugify cut at 60 characters after
-- trimming hyphens, so a title cut just after a hyphen made a link the albums_slug_shape check
-- refused. It now trims after cutting.

-- ---------------------------------------------------------------------------------------------
-- Links: cut, then trim
-- ---------------------------------------------------------------------------------------------

create or replace function app.slugify(p text)
returns text
language sql
stable
parallel safe
set search_path = ''
as $$
  select btrim(
    left(
      btrim(
        regexp_replace(
          regexp_replace(lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p, ''))), '[^a-z0-9]+', '-', 'g'),
          '-{2,}', '-', 'g'
        ),
        '-'
      ),
      60
    ),
    '-'
  )
$$;

-- The same cut before '-2', '-3' ...
create or replace function app.next_free_album_slug(p_base text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_n int := 2;
  v_candidate text;
begin
  loop
    v_candidate := rtrim(left(p_base, 60 - length('-' || v_n::text)), '-') || '-' || v_n::text;
    exit when not exists (select 1 from public.album_slugs s where s.slug = v_candidate);
    v_n := v_n + 1;
    if v_n > 999 then
      raise exception 'could not find a free link for %', p_base using errcode = '22023';
    end if;
  end loop;
  return v_candidate;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- The gallery's archive
-- ---------------------------------------------------------------------------------------------

-- An archived album is filed under a term. It leaves /gallery and appears in /gallery/archive
-- under that term; /gallery/<slug> keeps opening it. archived_at is the database's.
alter table public.albums
  add column if not exists archived_term_id uuid null references public.terms (id) on delete restrict;
alter table public.albums
  add column if not exists archived_at timestamptz null;

alter table public.albums drop constraint if exists albums_archived_pair;
alter table public.albums
  add constraint albums_archived_pair check ((archived_term_id is null) = (archived_at is null));

create index if not exists albums_archived_term_idx on public.albums (archived_term_id);

-- As 20260924120001, plus: 'archive' is the archive's own link, and the archive stamp follows
-- archived_term_id (a new album is never archived).
create or replace function app.normalize_album()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text;
begin
  new.title := left(btrim(coalesce(new.title, '')), 120);
  new.blurb := left(btrim(coalesce(new.blurb, '')), 500);
  if new.title = '' then
    raise exception 'an album needs a title' using errcode = '22023';
  end if;
  v_slug := app.slugify(coalesce(nullif(btrim(new.slug), ''), new.title));
  if v_slug = '' then
    v_slug := 'album';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.archived_term_id := null;
    new.archived_at := null;
    -- '-2', '-3' ... when the natural slug is taken (by any album, now or in the past)
    if v_slug = 'archive' or exists (select 1 from public.album_slugs s where s.slug = v_slug) then
      v_slug := app.next_free_album_slug(v_slug);
    end if;
  else
    new.created_by := old.created_by;
    if v_slug = 'archive' and old.slug <> 'archive' then
      raise exception 'The link /gallery/archive is the archive''s own. Choose another.'
        using errcode = '22023';
    end if;
    if exists (select 1 from public.album_slugs s where s.slug = v_slug and s.album_id <> new.id) then
      raise exception 'the link /gallery/% already belongs to another album', v_slug
        using errcode = '23505';
    end if;
    if new.archived_term_id is null then
      new.archived_at := null;
    elsif new.archived_term_id is distinct from old.archived_term_id then
      new.archived_at := now();
    else
      new.archived_at := old.archived_at;
    end if;
  end if;
  new.slug := v_slug;
  return new;
end
$$;

-- As 20260924120001, with each album's archive term ('term', null while it is in the gallery).
-- Archived albums are still returned: their pages stay up.
create or replace function public.gallery_public()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with visible as (
    select p.*
    from public.gallery_photos p
    where not p.hidden and p.deleted_at is null
  ),
  ordered as (
    select v.*,
      row_number() over (
        partition by v.album_id
        order by v.featured desc, v.sort_order, v.created_at, v.id
      ) as rn
    from visible v
  ),
  per_album as (
    select
      o.album_id,
      count(*)::int as photo_count,
      jsonb_agg(
        jsonb_build_object(
          'id', o.id,
          'path', o.path,
          'w', o.width,
          'h', o.height,
          'featured', o.featured,
          'label', o.label
        )
        order by o.rn
      ) as photos,
      (array_agg(o.path order by o.rn))[1] as first_path
    from ordered o
    group by o.album_id
  )
  select jsonb_build_object(
    'albums', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'slug', a.slug,
          'title', a.title,
          'blurb', a.blurb,
          'count', pa.photo_count,
          'cover', coalesce(
            (select c.path from visible c where c.id = a.cover_photo_id),
            pa.first_path
          ),
          'aliases', coalesce((
            select jsonb_agg(s.slug order by s.created_at)
            from public.album_slugs s
            where s.album_id = a.id and s.slug <> a.slug
          ), '[]'::jsonb),
          'term', t.label,
          'photos', pa.photos
        )
        order by a.sort_order, a.created_at, a.id
      )
      from public.albums a
      join per_album pa on pa.album_id = a.id
      left join public.terms t on t.id = a.archived_term_id
      where a.published
    ), '[]'::jsonb),
    'generated_at', now()
  )
$$;

-- An editor moves one album in or out of the archive (archived_term_id); the stamp is the
-- trigger's.
grant update (archived_term_id) on public.albums to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Tasks may change term during a rollover, and only then
-- ---------------------------------------------------------------------------------------------

-- As 20260920200001, except that a task's term follows the rollover. The flag is set with
-- set_config(..., true) inside rpc/roll_over_term, so it lasts for that call's transaction; no
-- request can set it otherwise.
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
    new.created_by := coalesce(v_uid, new.created_by);
    new.term_id := coalesce(new.term_id, app.current_term_id());
    new.completed_at := case when new.status = 'done' then now() end;
    return new;
  end if;

  -- a task is never re-homed or re-attributed; its term moves only with the rollover
  new.committee_id := old.committee_id;
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
-- The next term's defaults
-- ---------------------------------------------------------------------------------------------

-- The year after the current term: '2026-27' (1 Sept 2026 to 31 Aug 2027) gives '2027-28',
-- 1 Sept 2027 to 31 Aug 2028. Null when there is no current term.
create or replace function app.next_term_defaults()
returns table (label text, starts_on date, ends_on date)
language sql
stable
security definer
set search_path = ''
as $$
  select
    to_char(n.starts_on, 'YYYY') || '-' || to_char(n.starts_on + interval '1 year', 'YY'),
    n.starts_on,
    (n.starts_on + interval '1 year' - interval '1 day')::date
  from (
    select (t.ends_on + 1) as starts_on
    from public.terms t
    where t.is_current
  ) n
$$;

-- ---------------------------------------------------------------------------------------------
-- rpc/rollover_preview(): what the rollover would do, for the board
-- ---------------------------------------------------------------------------------------------

create or replace function public.rollover_preview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_current public.terms%rowtype;
  v_label text;
  v_starts date;
  v_ends date;
  v_next public.terms%rowtype;
begin
  if not app.is_eb() then
    raise exception 'Only the Executive Board can roll the society over to a new term.'
      using errcode = '42501';
  end if;

  select t.* into v_current from public.terms t where t.is_current;
  if not found then
    raise exception 'There is no current term to roll over from.' using errcode = '22023';
  end if;
  select d.label, d.starts_on, d.ends_on into v_label, v_starts, v_ends from app.next_term_defaults() d;
  select t.* into v_next from public.terms t where t.label = v_label;

  return jsonb_build_object(
    'current', jsonb_build_object(
      'id', v_current.id, 'label', v_current.label,
      'starts_on', v_current.starts_on, 'ends_on', v_current.ends_on),
    'next', jsonb_build_object(
      'id', v_next.id,
      'label', coalesce(v_next.label, v_label),
      'starts_on', coalesce(v_next.starts_on, v_starts),
      'ends_on', coalesce(v_next.ends_on, v_ends)),

    -- Every officer's, board and webmaster position, with its work email when it has one and
    -- whether an account of that address exists (it then holds the position from the switch;
    -- otherwise from its first sign-in).
    'work_accounts', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'position_id', p.id,
          'title', p.title,
          'level', p.level,
          'committee', c.abbr,
          'email', w.email,
          'has_account', exists (
            select 1 from public.profiles pr where pr.email_normalized = w.email_normalized),
          'holds_now', exists (
            select 1
            from public.assignments a
            join public.profiles pr on pr.id = a.profile_id
            where a.position_id = p.id and a.term_id = v_current.id and a.status = 'active'
              and pr.email_normalized = w.email_normalized)
        )
        order by case p.level when 'webmaster' then 0 when 'eb' then 1 else 2 end,
                 c.abbr nulls first, p.sort, p.title
      )
      from public.positions p
      left join public.committees c on c.id = p.committee_id
      left join public.position_work_emails w on w.position_id = p.id
      where p.active and p.level in ('officer', 'eb', 'webmaster')
    ), '[]'::jsonb),

    -- Positions below officer that the roster lists, offered again for the next term.
    'roster_positions', (
      select count(*)::int
      from public.roster_entries r
      where r.position_id is not null and r.email_normalized is not null
        and not app.position_is_privileged(r.position_id)
    ),

    -- Positions below officer held this term that the roster does not list: they end.
    'ending', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'title', p.title,
          'committee', c.abbr,
          'name', coalesce(nullif(btrim(pr.full_name), ''), pr.email)
        )
        order by c.abbr nulls first, p.title, pr.full_name
      )
      from public.assignments a
      join public.positions p on p.id = a.position_id
      join public.profiles pr on pr.id = a.profile_id
      left join public.committees c on c.id = p.committee_id
      where a.term_id = v_current.id and a.status = 'active'
        and not app.position_is_privileged(a.position_id)
        and not app.position_from_roster(a.position_id, pr.email_normalized, pr.id)
    ), '[]'::jsonb),

    'open_tasks', (
      select count(*)::int from public.tasks t where t.status <> 'done'
    ),

    -- The albums still in the gallery (the board ticks the ones to archive).
    'albums', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'title', a.title,
          'slug', a.slug,
          'published', a.published,
          'photos', (
            select count(*)::int from public.gallery_photos g
            where g.album_id = a.id and g.deleted_at is null)
        )
        order by a.sort_order, a.created_at, a.id
      )
      from public.albums a
      where a.archived_term_id is null
    ), '[]'::jsonb),

    -- Every file in Storage, against the free plan's 1 GB.
    'storage_bytes', (
      select coalesce(sum((o.metadata ->> 'size')::bigint), 0)
      from storage.objects o
    )
  );
end
$$;

-- ---------------------------------------------------------------------------------------------
-- rpc/roll_over_term(): the rollover itself
-- ---------------------------------------------------------------------------------------------

create or replace function public.roll_over_term(
  label text,
  starts_on date,
  ends_on date,
  archive_albums uuid[] default '{}'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
-- The parameters share their names with the terms' columns: in a query a bare name is the
-- column, and a parameter is always written roll_over_term.<name>.
declare
  v_label text := btrim(coalesce(roll_over_term.label, ''));
  v_current public.terms%rowtype;
  v_next public.terms%rowtype;
  v_offered int;
  v_roster int;
  v_tasks int;
  v_albums int;
  v_ended int;
  v_held int;
  v_waiting int;
begin
  if not app.is_eb() then
    raise exception 'Only the Executive Board can roll the society over to a new term.'
      using errcode = '42501';
  end if;

  -- One rollover at a time: the current term's row is the lock. A second one that waited on it
  -- finds no current row when it wakes (the first moved the flag).
  select t.* into v_current from public.terms t where t.is_current for update;
  if not found then
    raise exception 'There is no current term to roll over from. If someone has just started a new term, reload the page.'
      using errcode = '22023';
  end if;

  if v_label !~ '^\d{4}-\d{2}$' then
    raise exception 'A term is named like 2027-28.' using errcode = '22023';
  end if;
  if roll_over_term.starts_on is null or roll_over_term.ends_on is null
     or roll_over_term.ends_on <= roll_over_term.starts_on then
    raise exception 'The new term needs a first and a last day, the last after the first.'
      using errcode = '22023';
  end if;
  if roll_over_term.starts_on <= v_current.starts_on then
    raise exception 'The new term must start after % started.', v_current.label
      using errcode = '22023';
  end if;
  if v_label = v_current.label then
    raise exception '% is already the current term.', v_label using errcode = '22023';
  end if;
  if exists (select 1 from public.terms t where t.label = v_label and t.starts_on <= v_current.starts_on) then
    raise exception 'The term % is over. The new term needs a name of its own.', v_label
      using errcode = '22023';
  end if;

  -- 1. The next term.
  insert into public.terms (label, starts_on, ends_on, is_current)
  values (v_label, roll_over_term.starts_on, roll_over_term.ends_on, false)
  on conflict (label) do update
    set starts_on = excluded.starts_on, ends_on = excluded.ends_on
  returning * into v_next;

  -- 2. The work accounts carry over. app.handle_new_invite assigns an existing account at once.
  insert into public.invites (email, position_id, term_id, invited_by)
  select w.email, w.position_id, v_next.id, auth.uid()
  from public.position_work_emails w
  join public.positions p on p.id = w.position_id
  where p.active
  on conflict (email_normalized, position_id, term_id) do nothing;
  get diagnostics v_offered = row_count;

  -- A society with no board after the switch could not be put right from the portal again.
  if not exists (
    select 1
    from public.assignments a
    join public.positions p on p.id = a.position_id
    where a.term_id = v_next.id and a.status = 'active' and p.level in ('eb', 'webmaster')
  ) then
    raise exception 'Nobody would keep the Executive Board''s access in %. Set the board''s work emails, and sign in once with one of those accounts, first.', v_label
      using errcode = '22023';
  end if;

  -- 3. The roster's positions below officer, for the next term, on the address of the account
  --    the row is linked to (else the row's own), so a linked member keeps the position.
  insert into public.invites (email, position_id, term_id, invited_by)
  select coalesce(pr.email, r.email), r.position_id, v_next.id, auth.uid()
  from public.roster_entries r
  join public.positions p on p.id = r.position_id and p.active
  left join public.profiles pr on pr.id = r.profile_id and pr.email_normalized is not null
  where coalesce(pr.email_normalized, r.email_normalized) is not null
    and not app.position_is_privileged(r.position_id)
  on conflict (email_normalized, position_id, term_id) do nothing;
  get diagnostics v_roster = row_count;

  -- 4. Open tasks move into the next term (app.guard_task lets the term change for this call).
  perform set_config('app.rolling_over', 'on', true);
  update public.tasks t
     set term_id = v_next.id
   where t.status <> 'done' and t.term_id <> v_next.id;
  get diagnostics v_tasks = row_count;
  perform set_config('app.rolling_over', '', true);

  -- 5. The ticked albums go to the archive, under the term that is ending.
  update public.albums a
     set archived_term_id = v_current.id
   where a.id = any (coalesce(roll_over_term.archive_albums, '{}'))
     and a.archived_term_id is null;
  get diagnostics v_albums = row_count;

  -- 6. The switch, then the old term's assignments end.
  update public.terms t set is_current = false where t.is_current;
  update public.terms t set is_current = true where t.id = v_next.id;

  update public.assignments a
     set status = 'ended', ended_on = (now() at time zone 'Africa/Cairo')::date
   where a.term_id = v_current.id and a.status = 'active';
  get diagnostics v_ended = row_count;

  -- The old term's offers nobody took up: a first sign-in would otherwise still turn them into
  -- assignments of a term that is over.
  delete from public.invites i
   where i.term_id = v_current.id and i.accepted_at is null;

  perform app.request_site_rebuild('rollover');

  select count(*)::int,
         count(*) filter (where i.accepted_at is null)::int
    into v_held, v_waiting
  from public.position_work_emails w
  join public.positions p on p.id = w.position_id and p.active
  left join public.invites i
    on i.position_id = w.position_id and i.term_id = v_next.id
   and i.email_normalized = w.email_normalized;

  return jsonb_build_object(
    'from', v_current.label,
    'to', v_next.label,
    'work_accounts', v_held - v_waiting,
    'work_accounts_waiting', v_waiting,
    'work_offers_made', v_offered,
    'roster_offers_made', v_roster,
    'tasks_moved', v_tasks,
    'albums_archived', v_albums,
    'assignments_ended', v_ended
  );
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Ownership + grants
-- ---------------------------------------------------------------------------------------------

alter function app.slugify(text) owner to postgres;
alter function app.next_free_album_slug(text) owner to postgres;
alter function app.normalize_album() owner to postgres;
alter function public.gallery_public() owner to postgres;
alter function app.guard_task() owner to postgres;
alter function app.next_term_defaults() owner to postgres;
alter function public.rollover_preview() owner to postgres;
alter function public.roll_over_term(text, date, date, uuid[]) owner to postgres;

revoke execute on function app.slugify(text) from public;
grant execute on function app.slugify(text) to authenticated, service_role;
revoke execute on function app.next_free_album_slug(text) from public;
revoke execute on function app.normalize_album() from public;
revoke execute on function public.gallery_public() from public;
grant execute on function public.gallery_public() to anon, authenticated;
revoke execute on function app.guard_task() from public;
revoke execute on function app.next_term_defaults() from public;
revoke execute on function public.rollover_preview() from public, anon;
grant execute on function public.rollover_preview() to authenticated;
revoke execute on function public.roll_over_term(text, date, date, uuid[]) from public, anon;
grant execute on function public.roll_over_term(text, date, date, uuid[]) to authenticated;
