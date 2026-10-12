-- Dismissing a member, and reinstating one.
--
-- Until now the roster could lose a member in one way only: the Executive Board's Remove, which
-- deletes the row and is meant for tidying mistakes. A member the society dismisses has to stay
-- on the roster as a record, and nothing but a decision of the President may undo that.
--
-- Who. The President alone: whoever holds an active assignment, this term, to the position
-- whose key is 'eb.president' (app.is_president). Not the rest of the Executive Board and not the
-- webmaster. The two functions check it, and a trigger on the table keeps every other route shut.
--
-- That holds only while the President's position cannot be handed to another address, so the
-- position is the President's own from here (the last section but one): its work email is
-- changed by the President alone, the way only the webmaster changes the webmaster's; the row
-- of the position is changed by the President alone; and nobody removes it or gives it another
-- level, because a position below officer has no work email and goes to any address the board
-- names. When the President's mailbox is lost the owner of the database puts it right with SQL
-- (docs/RUNBOOK.md, section 8).
--
-- What is stored, on the roster row itself:
--   dismissed_at              when; a row is dismissed exactly while this is set
--   dismissed_by              who (the President's account)
--   dismissal_reason          why, required, one to 1,000 characters
--   status_before_dismissal   the status the row had, which reinstating puts back
-- and the row's status reads 'Dismissed'.
--
-- rpc/dismiss_roster_member(entry, reason) marks the row and ends what the member held:
--   * the committee, the position, the contact person marker and the "other positions" text of
--     the row are cleared (the audit log keeps what they were);
--   * every account the row belongs to (the linked one, and any with the row's email) goes back
--     to unverified, and every active assignment it holds is ended the way rpc/remove_position
--     ends one (status 'ended', ended_on today), which asks the public site for a rebuild when
--     the position is an officer's or the board's (the touch_site trigger on assignments);
--   * the offers of positions to those accounts and addresses are deleted: every one still
--     waiting, and this term's accepted ones.
--
-- rpc/reinstate_roster_member(entry) puts the status back to what it was and clears the four
-- columns. It gives nothing else back: the account stays unverified until the member asks for
-- verification again, and the committee and positions are assigned again by hand.
--
-- The guard (app.guard_roster_dismissal, before insert, update and delete on roster_entries)
-- applies to every role, the importer and scripts included:
--   * nothing but the two functions puts a row into or out of the dismissed state, and typing
--     the status "Dismissed" by hand, in a bulk update or in the spreadsheet is refused;
--   * a dismissed row cannot be changed or deleted. The Executive Board still reads it, reason
--     included (row-level security is as it was: the board reads the whole roster). Three things
--     may still happen to it by themselves: the daily count of years spent, the row being tied
--     to the account of its own email at sign-in, and a deleted account's id being cleared;
--   * no second row can be added for a dismissed person (the same email, the email of the
--     account the record is tied to, or the same name where either row has no email), and no
--     other row can be tied to that account.
--
-- While a row is dismissed nothing lifts its member again: claiming at sign-in ties the account
-- to the record and verifies nobody, a change of the row follows through to no profile, the
-- account cannot be given a status other than unverified (so a verification request cannot be
-- approved), and it cannot hold an active assignment. Nobody is offered a position either:
-- rpc/invite_to_position and the policies on invites refuse a dismissed member's address. The
-- places that write offers in bulk (the term rollover, the roster's own trigger) are refused
-- nothing, so that one member cannot stop them: an offer that reaches the table that way is
-- left unaccepted, and the reinstatement deletes it.
--
-- The import (app.apply_roster_rows) leaves a line alone, and counts it as skipped_dismissed,
-- when it names a dismissed member (the same key, the same email, or the same name unless the
-- roster already has an ordinary row for exactly that line, which is a namesake) or when its
-- status says dismissed. A dismissed row is never reported as missing from the sheet.
--
-- Readers. rpc/check_membership answers { "state": "ended" } and nothing else for a dismissed
-- member: no status, no reason, no date. rpc/roster_stats leaves dismissed rows out of the
-- member count. A committee's members list (rpc/committee_roster) reads rows by committee, and a
-- dismissed row has none. Bulk updates and their undo skip a dismissed row and say so.
--
-- The audit log. roster_entries, profiles, assignments and invites all carry the audit trigger,
-- so the dismissal and the reinstatement are on record with the President as the actor, the
-- reason and the earlier status in the row's before and after.

-- ---------------------------------------------------------------------------------------------
-- What is stored
-- ---------------------------------------------------------------------------------------------

alter table public.roster_entries
  add column if not exists dismissed_at timestamptz null;
alter table public.roster_entries
  add column if not exists dismissed_by uuid null references public.profiles (id) on delete set null;
alter table public.roster_entries
  add column if not exists dismissal_reason text null;
alter table public.roster_entries
  add column if not exists status_before_dismissal text null;

create index if not exists roster_entries_dismissed_by_idx
  on public.roster_entries (dismissed_by);
create index if not exists roster_entries_dismissed_at_idx
  on public.roster_entries (dismissed_at) where dismissed_at is not null;

-- The four columns are kept together, and a dismissed row holds a reason, the status
-- 'Dismissed', no committee and no position.
alter table public.roster_entries
  drop constraint if exists roster_entries_dismissal_whole;
alter table public.roster_entries
  add constraint roster_entries_dismissal_whole check (
    (dismissed_at is null
       and dismissed_by is null
       and dismissal_reason is null
       and status_before_dismissal is null)
    or (dismissed_at is not null
       and btrim(coalesce(dismissal_reason, '')) <> ''
       and length(dismissal_reason) <= 1000
       and status is not distinct from 'Dismissed'
       and committee_id is null
       and position_id is null)
  );

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

-- The caller holds the President's position this term. The position is found by its key,
-- which the database never changes (app.normalize_position keeps it on every update).
create or replace function app.is_president()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.assignments a
    join public.positions p on p.id = a.position_id
    where a.profile_id = (select auth.uid())
      and a.status = 'active'
      and a.term_id = app.current_term_id()
      and p.key = 'eb.president'
  )
$$;

-- True while one of the two functions below is writing a roster row. They switch it on for
-- that one statement and off again, so nothing else in the same transaction writes under it.
create or replace function app.roster_dismissing()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('app.roster_dismissal', true), '') = 'on'
$$;

-- The account belongs to a dismissed member: a dismissed row is tied to it, or carries its
-- email (an account made after the dismissal is tied to the record at its first sign-in).
create or replace function app.is_dismissed_profile(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.roster_entries r
    where r.dismissed_at is not null
      and (
        r.profile_id = p_profile
        or r.email_normalized = (
          select p.email_normalized from public.profiles p where p.id = p_profile
        )
      )
  )
$$;

-- The same question about an address, for the places that have no account to ask about (an
-- offer, a new roster row, a line of the sheet): a dismissed row carries it, or is tied to the
-- account that signs in with it.
create or replace function app.is_dismissed_email(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.roster_entries r
    left join public.profiles p on p.id = r.profile_id
    where r.dismissed_at is not null
      and app.norm_email(p_email) in (r.email_normalized, p.email_normalized)
  )
$$;

-- ---------------------------------------------------------------------------------------------
-- The guard on the roster
-- ---------------------------------------------------------------------------------------------

-- Before insert, update and delete. Security definer: it reads profiles and the other roster
-- rows whoever is writing. Its name sorts before normalize_roster_entry, so it compares what
-- the writer sent, before anything is tidied.
create or replace function app.guard_roster_dismissal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_name text;
begin
  -- The two functions below have checked who is asking.
  if app.roster_dismissing() then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.dismissed_at is not null then
      raise exception 'A dismissed member stays on the roster as a record and cannot be removed. The President can reinstate the member first.'
        using errcode = '22023';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.dismissed_at is not null then
    -- years_spent is compared only where the row has no joining year: with one it is counted
    -- from that year, by a daily job too, and without one it is the sheet's own number.
    if (new.id, new.source_key, new.full_name, new.email, new.status, new.joined_year,
        new.lgas, new.ngas, new.current_position, new.committee_id, new.position_id,
        new.is_contact_person, new.origin, new.portal_edited_at, new.upgrade_dismissed_for,
        new.upgrade_dismissed_at, new.dismissed_at, new.dismissal_reason,
        new.status_before_dismissal, new.import_batch, new.imported_at, new.created_at,
        case when new.joined_year is null then new.years_spent end)
       is distinct from
       (old.id, old.source_key, old.full_name, old.email, old.status, old.joined_year,
        old.lgas, old.ngas, old.current_position, old.committee_id, old.position_id,
        old.is_contact_person, old.origin, old.portal_edited_at, old.upgrade_dismissed_for,
        old.upgrade_dismissed_at, old.dismissed_at, old.dismissal_reason,
        old.status_before_dismissal, old.import_batch, old.imported_at, old.created_at,
        case when old.joined_year is null then old.years_spent end)
      -- The record may be tied to the account of its own email (claiming at sign-in), and an
      -- account that has been deleted leaves the three columns that named it.
      or (new.profile_id is distinct from old.profile_id and not (
            (old.profile_id is null and exists (
               select 1 from public.profiles p
               where p.id = new.profile_id and p.email_normalized = old.email_normalized))
            or (new.profile_id is null and not exists (
               select 1 from public.profiles p where p.id = old.profile_id))
          ))
      or (new.dismissed_by is distinct from old.dismissed_by and not (
            new.dismissed_by is null and not exists (
              select 1 from public.profiles p where p.id = old.dismissed_by)
          ))
      or (new.portal_edited_by is distinct from old.portal_edited_by and not (
            new.portal_edited_by is null and not exists (
              select 1 from public.profiles p where p.id = old.portal_edited_by)
          ))
    then
      raise exception 'This member was dismissed, so the record cannot be changed. Only the President can reinstate a dismissed member.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- From here: a new row, or a row that is not dismissed.
  if new.dismissed_at is not null
    or new.dismissed_by is not null
    or new.dismissal_reason is not null
    or new.status_before_dismissal is not null
    or (app.normalize_text(new.status) like '%dismiss%'
        and (tg_op = 'INSERT' or new.status is distinct from old.status))
  then
    raise exception 'Only the President can dismiss a member, with Dismiss member on the Roster page.'
      using errcode = '42501';
  end if;

  -- No second, ordinary row for a dismissed person: none with an address of theirs, no new
  -- one under their name where either row has no email to tell the two apart, and none tied
  -- to their account. email_normalized is a generated column, which is not worked out yet in
  -- a before trigger, hence the two values made here.
  v_email := app.norm_email(new.email);
  v_name := app.normalize_text(new.full_name);
  if ((tg_op = 'INSERT' or v_email is distinct from old.email_normalized)
        and app.is_dismissed_email(v_email))
    or (tg_op = 'INSERT' and exists (
          select 1
          from public.roster_entries d
          where d.dismissed_at is not null
            and d.name_normalized = v_name
            and (v_email is null or d.email_normalized is null)))
    or (new.profile_id is not null
        and (tg_op = 'INSERT' or new.profile_id is distinct from old.profile_id)
        and app.is_dismissed_profile(new.profile_id))
  then
    raise exception 'This person was dismissed and is on the roster as a record. Only the President can reinstate a dismissed member.'
      using errcode = '22023';
  end if;
  return new;
end
$$;

drop trigger if exists guard_roster_dismissal on public.roster_entries;
create trigger guard_roster_dismissal before insert or update or delete on public.roster_entries
  for each row execute function app.guard_roster_dismissal();

-- ---------------------------------------------------------------------------------------------
-- Nothing lifts a dismissed member's account
-- ---------------------------------------------------------------------------------------------

-- Before update of membership_status on profiles. Whatever asks (the board approving a
-- verification request, the board setting a status by hand), the account of a dismissed member
-- stays unverified, and the board reads why.
create or replace function app.guard_dismissed_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.membership_status is distinct from old.membership_status
    and new.membership_status <> 'unverified'
    and app.is_dismissed_profile(new.id)
  then
    raise exception 'This member was dismissed, so the account stays unverified. The President can reinstate the member on the Roster page.'
      using errcode = '22023';
  end if;
  return new;
end
$$;

drop trigger if exists guard_dismissed_profile on public.profiles;
create trigger guard_dismissed_profile before update of membership_status on public.profiles
  for each row execute function app.guard_dismissed_profile();

-- Before insert and update on assignments: a dismissed member's account holds no position,
-- by whichever door it would come (an invite, the invites screen, the roster, by hand). An
-- officer can meet this sentence, so it says no more than the public check does.
create or replace function app.guard_dismissed_holder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active'
    and (tg_op = 'INSERT'
         or old.status is distinct from 'active'
         or new.profile_id is distinct from old.profile_id)
    and app.is_dismissed_profile(new.profile_id)
  then
    raise exception 'The membership of this person has ended, so they cannot hold a position.'
      using errcode = '22023';
  end if;
  return new;
end
$$;

drop trigger if exists guard_dismissed_holder on public.assignments;
create trigger guard_dismissed_holder before insert or update on public.assignments
  for each row execute function app.guard_dismissed_holder();

-- As 20260920090003, leaving a dismissed member's account as it is. The guard above already
-- refuses the assignment itself; this keeps the rule in the one place that verifies a holder.
create or replace function app.verify_position_holder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active' and not app.is_dismissed_profile(new.profile_id) then
    update public.profiles p
      set membership_status = 'active'
    where p.id = new.profile_id
      and p.membership_status = 'unverified';
  end if;
  return null;
end
$$;

-- As 20260919200001. A dismissal and a reinstatement write the member's profile themselves
-- (rpc/dismiss_roster_member; a reinstatement writes none), so step (1) passes them by, and it
-- passes by any row whose account belongs to a dismissed member.
create or replace function app.sync_roster_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_norm text;
  v_profile uuid;
begin
  if tg_op = 'UPDATE'
    and new.profile_id is not null
    and new.profile_id is not distinct from old.profile_id
    and (new.status is distinct from old.status or new.joined_year is distinct from old.joined_year)
    and new.dismissed_at is null
    and old.dismissed_at is null
    and not app.is_dismissed_profile(new.profile_id)
  then
    v_norm := app.normalize_text(new.status);
    update public.profiles p
      set membership_tier = coalesce(new.status, p.membership_tier),
          joined_year = coalesce(new.joined_year, p.joined_year),
          membership_status = case
            when v_norm like '%archiv%' or v_norm like '%suspend%' then p.membership_status
            when v_norm like '%full%' or v_norm like '%associate%' then 'active'
            when v_norm like '%candidate%' then 'candidate'
            when v_norm like '%alumni%' or v_norm like '%honor%' then 'alumni'
            else p.membership_status
          end
    where p.id = new.profile_id;
  end if;

  if new.profile_id is null
    and new.email_normalized is not null
    and not app.roster_importing()
    and (tg_op = 'INSERT' or new.email_normalized is distinct from old.email_normalized)
  then
    for v_profile in
      select p.id
      from public.profiles p
      where p.email_normalized = new.email_normalized
        and not exists (select 1 from public.roster_entries r where r.profile_id = p.id)
    loop
      perform app.claim_for_profile(v_profile);
    end loop;
  end if;
  return null;
end
$$;

-- As 20261005180001. A dismissed row is still tied to the account of its email, first of all
-- the rows that carry it, so the record and the account stay together. It verifies nobody, and
-- no waiting offer becomes an assignment for a dismissed member.
create or replace function app.claim_for_profile(p_profile uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_membership text;
  v_roster public.roster_entries%rowtype;
  v_norm_status text;
begin
  select p.email_normalized, p.membership_status
    into v_email, v_membership
  from public.profiles p
  where p.id = p_profile;

  if v_email is null then
    return;
  end if;

  -- (1) roster link
  if not exists (select 1 from public.roster_entries r where r.profile_id = p_profile) then
    select r.*
      into v_roster
    from public.roster_entries r
    where r.email_normalized = v_email
      and r.profile_id is null
    order by
      (r.dismissed_at is not null) desc,
      (coalesce(r.status, '') ilike '%archiv%' or coalesce(r.status, '') ilike '%suspend%') asc,
      case
        when r.status ilike '%full%' then 3
        when r.status ilike '%associate%' then 2
        when r.status ilike '%candidate%' then 1
        else 0
      end desc,
      r.joined_year desc nulls last,
      r.imported_at desc
    limit 1;

    if found then
      update public.roster_entries
        set profile_id = p_profile
      where id = v_roster.id;

      if v_membership = 'unverified' and not app.is_dismissed_profile(p_profile) then
        v_norm_status := app.normalize_text(v_roster.status);
        update public.profiles
          set membership_status = case
                when v_norm_status like '%archiv%' or v_norm_status like '%suspend%' then membership_status
                when v_norm_status like '%full%' or v_norm_status like '%associate%' then 'active'
                when v_norm_status like '%alumni%' or v_norm_status like '%honor%' then 'alumni'
                -- candidate, blank or anything else: on the roster means a member
                else 'candidate'
              end,
              membership_tier = coalesce(v_roster.status, membership_tier),
              joined_year = coalesce(v_roster.joined_year, joined_year)
        where id = p_profile;
      end if;
    end if;
  end if;

  -- A dismissed member is offered nothing: the offers stay as they are, unaccepted.
  if app.is_dismissed_profile(p_profile) then
    return;
  end if;

  -- (2) standing invites -> assignments (app.verify_position_holder then verifies the holder).
  -- An officer's, the board's or the webmaster's position only for its work email.
  insert into public.assignments (profile_id, position_id, term_id)
  select p_profile, i.position_id, i.term_id
  from public.invites i
  where i.email_normalized = v_email
    and i.accepted_at is null
    and app.work_email_ok(i.position_id, i.email)
  on conflict (profile_id, position_id, term_id) do nothing;

  update public.invites i
    set accepted_at = now(),
        accepted_profile_id = p_profile
  where i.email_normalized = v_email
    and i.accepted_at is null
    and app.work_email_ok(i.position_id, i.email);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- No offer of a position to a dismissed member
-- ---------------------------------------------------------------------------------------------

-- An offer made while the member is dismissed would wait in the table and become a position
-- at the first sign-in after a reinstatement. The two doors a person offers through refuse the
-- address: rpc/invite_to_position, and a direct insert or update of an invite (the policies).
-- There is no raising trigger on invites on purpose: the term rollover and the roster write
-- offers many at a time, and one dismissed member must not stop either. What reaches the table
-- that way is left unaccepted (app.handle_new_invite below, app.claim_for_profile above) and
-- goes when the member is reinstated.

-- As 20261005180001, refusing a dismissed member's address, in the words an officer may read.
create or replace function public.invite_to_position(email text, "position" uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(email, '')));
  v_norm text;
  v_term uuid := app.current_term_id();
  v_profile uuid;
  v_work text;
begin
  if not exists (select 1 from public.positions p where p.id = "position" and p.active)
    or not app.can_manage_position("position")
  then
    raise exception 'You cannot hand out that position.' using errcode = '42501';
  end if;
  if v_term is null then
    raise exception 'There is no current term.' using errcode = '22023';
  end if;
  if length(v_email) > 200 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'That does not look like an email address.' using errcode = '22023';
  end if;
  if not app.work_email_ok("position", v_email) then
    select w.email into v_work from public.position_work_emails w where w.position_id = "position";
    if v_work is null then
      raise exception 'This position has no work email yet. Set it first; the position can only be given to that address.'
        using errcode = '22023';
    end if;
    raise exception 'This position can only be given to its work email, %.', v_work
      using errcode = '22023';
  end if;
  if app.is_dismissed_email(v_email) then
    raise exception 'The membership of this person has ended, so they cannot hold a position.'
      using errcode = '22023';
  end if;
  v_norm := app.norm_email(v_email);

  -- the insert trigger turns it into an assignment when the account already exists
  insert into public.invites (email, position_id, term_id, invited_by)
  values (v_email, "position", v_term, auth.uid())
  on conflict (email_normalized, position_id, term_id) do nothing;

  select p.id into v_profile from public.profiles p
  where p.email_normalized = v_norm order by p.created_at limit 1;
  if v_profile is null then
    return 'invited';
  end if;

  -- held before and removed since: it comes back
  insert into public.assignments (profile_id, position_id, term_id)
  values (v_profile, "position", v_term)
  on conflict (profile_id, position_id, term_id)
    do update set status = 'active', ended_on = null;
  update public.invites i
     set accepted_at = coalesce(i.accepted_at, now()), accepted_profile_id = v_profile
   where i.email_normalized = v_norm and i.position_id = "position" and i.term_id = v_term;
  return 'assigned';
end
$$;

-- As 20261005180001, with the same refusal.
drop policy if exists invites_insert on public.invites;
create policy invites_insert on public.invites
  for insert to authenticated
  with check (
    (select app.can_manage_position(position_id))
    and (select app.work_email_ok(position_id, email))
    and not (select app.is_dismissed_email(email))
  );
drop policy if exists invites_update on public.invites;
create policy invites_update on public.invites
  for update to authenticated
  using ((select app.can_manage_position(position_id)))
  with check (
    (select app.can_manage_position(position_id))
    and (select app.work_email_ok(position_id, email))
    and not (select app.is_dismissed_email(email))
  );

-- As 20261005180001, leaving an offer to a dismissed member's account as it is: unaccepted,
-- with nothing raised, so the statement that wrote it (one of many, in a rollover) goes on.
create or replace function app.handle_new_invite()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
begin
  if new.accepted_at is not null or new.email_normalized is null then
    return new;
  end if;
  if not app.work_email_ok(new.position_id, new.email) then
    return new;
  end if;

  select p.id
    into v_profile
  from public.profiles p
  where p.email_normalized = new.email_normalized
  order by p.created_at
  limit 1;

  if v_profile is null or app.is_dismissed_profile(v_profile) then
    return new;
  end if;

  insert into public.assignments (profile_id, position_id, term_id)
  values (v_profile, new.position_id, new.term_id)
  on conflict (profile_id, position_id, term_id) do nothing;

  update public.invites
    set accepted_at = now(),
        accepted_profile_id = v_profile
  where id = new.id;

  return new;
end
$$;

-- As 20261005170001. The roster offers a dismissed member's address nothing, and gives a
-- dismissed member's account no ended position back: app.guard_dismissed_holder would refuse
-- that update, and with it the change of the roster row, or the whole import, that led here.
create or replace function app.sync_roster_position()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_term uuid := app.current_term_id();
begin
  if v_term is null then
    return null;
  end if;
  if tg_op = 'UPDATE'
    and new.position_id is not distinct from old.position_id
    and new.email_normalized is not distinct from old.email_normalized
    and new.profile_id is not distinct from old.profile_id
  then
    return null;
  end if;

  if tg_op = 'UPDATE' and old.position_id is not null
    and not app.position_is_privileged(old.position_id)
    and (old.position_id is distinct from new.position_id
         or old.email_normalized is distinct from new.email_normalized)
  then
    delete from public.invites i
    where i.position_id = old.position_id and i.term_id = v_term
      and i.email_normalized = old.email_normalized and i.accepted_at is null;
    update public.assignments a
       set status = 'ended', ended_on = current_date
     where a.position_id = old.position_id and a.term_id = v_term and a.status = 'active'
       and a.profile_id in (
         select p.id from public.profiles p
         where p.id = old.profile_id or p.email_normalized = old.email_normalized);
  end if;

  if new.position_id is not null and new.email_normalized is not null
    and not app.position_is_privileged(new.position_id)
    and not app.is_dismissed_email(new.email)
  then
    insert into public.invites (email, position_id, term_id, invited_by)
    values (new.email, new.position_id, v_term, auth.uid())
    on conflict (email_normalized, position_id, term_id) do nothing;
    update public.assignments a
       set status = 'active', ended_on = null
     where a.position_id = new.position_id and a.term_id = v_term and a.status = 'ended'
       and a.profile_id in (
         select p.id from public.profiles p
         where p.id = new.profile_id or p.email_normalized = new.email_normalized)
       and not app.is_dismissed_profile(a.profile_id);
  end if;
  return null;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- rpc/dismiss_roster_member
-- ---------------------------------------------------------------------------------------------

-- Answers { accounts, positions_ended }: how many portal accounts went back to unverified and
-- how many positions those accounts held, for the page to say what happened.
create or replace function public.dismiss_roster_member(entry uuid, reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_reason text := btrim(regexp_replace(coalesce(dismiss_roster_member.reason, ''), '\s+', ' ', 'g'));
  v_row public.roster_entries%rowtype;
  v_profiles uuid[];
  v_emails text[];
  v_work text;
  v_twin text;
  v_positions int;
begin
  if not app.is_president() then
    raise exception 'Only the President can dismiss a member.' using errcode = '42501';
  end if;
  if v_reason = '' then
    raise exception 'Give the reason for the dismissal. It is kept on the record.'
      using errcode = '22023';
  end if;
  if length(v_reason) > 1000 then
    raise exception 'The reason is too long. Keep it under 1,000 characters.'
      using errcode = '22023';
  end if;

  -- The row is the lock: a second dismissal waits here and then finds the first.
  select r.* into v_row
  from public.roster_entries r
  where r.id = dismiss_roster_member.entry
  for update;

  if not found then
    raise exception 'That member is no longer on the roster.' using errcode = '22023';
  end if;
  if v_row.dismissed_at is not null then
    raise exception 'This member has already been dismissed.' using errcode = '22023';
  end if;

  -- The accounts the row belongs to: the one it is tied to, and any that signs in with the
  -- row's email. app.is_dismissed_profile asks the same two questions afterwards.
  select coalesce(array_agg(p.id), '{}'::uuid[]) into v_profiles
  from public.profiles p
  where p.id = v_row.profile_id
     or (v_row.email_normalized is not null and p.email_normalized = v_row.email_normalized);

  if auth.uid() = any (v_profiles) then
    raise exception 'You cannot dismiss yourself.' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct e.email), '{}'::text[]) into v_emails
  from (
    select v_row.email_normalized as email
    union all
    select p.email_normalized from public.profiles p where p.id = any (v_profiles)
  ) e
  where e.email is not null;

  -- A work account belongs to its position and is handed on with it each term. Dismissed, it
  -- would hold nothing until a reinstatement, whoever had the position by then.
  select p.title into v_work
  from public.position_work_emails w
  join public.positions p on p.id = w.position_id
  where w.email_normalized = any (v_emails)
  order by p.title
  limit 1;
  if found then
    raise exception 'This row is tied to the work account of a position (%), which is handed on with the position and cannot be dismissed. Remove the row, add the member again under their own email, and dismiss that row.', v_work
      using errcode = '22023';
  end if;

  -- One person, one record: an ordinary row left beside the dismissed one (under an address
  -- of theirs, or tied to their account) would still read as a member, and its position would
  -- hand the account back what this takes away.
  select o.full_name into v_twin
  from public.roster_entries o
  where o.id <> v_row.id
    and o.dismissed_at is null
    and (o.email_normalized = any (v_emails) or o.profile_id = any (v_profiles))
  order by o.full_name
  limit 1;
  if found then
    raise exception 'This member has another row on the roster, under the name %. Remove the duplicate row first, so that one record is dismissed.', v_twin
      using errcode = '22023';
  end if;

  select count(*)::int into v_positions
  from public.assignments a
  where a.profile_id = any (v_profiles) and a.status = 'active';

  -- The record. Clearing the position lets app.sync_roster_position end what the roster
  -- itself had given; app.normalize_roster_entry stamps the row as the portal's.
  perform set_config('app.roster_dismissal', 'on', true);
  update public.roster_entries r
     set status = 'Dismissed',
         status_before_dismissal = v_row.status,
         dismissed_at = now(),
         dismissed_by = auth.uid(),
         dismissal_reason = v_reason,
         committee_id = null,
         position_id = null,
         is_contact_person = false,
         current_position = null
   where r.id = v_row.id;
  perform set_config('app.roster_dismissal', 'off', true);

  -- Every position the accounts hold ends, as rpc/remove_position ends one.
  update public.assignments a
     set status = 'ended', ended_on = current_date
   where a.profile_id = any (v_profiles) and a.status = 'active';

  -- The offers go too, as rpc/remove_position takes the offer with the position: one still
  -- waiting would become a position again at the next sign-in, and this term's accepted ones
  -- would stand in the way of a clean offer after a reinstatement.
  delete from public.invites i
   where (i.email_normalized = any (v_emails) or i.accepted_profile_id = any (v_profiles))
     and (i.accepted_at is null or i.term_id = app.current_term_id());

  -- The tier goes too: the member's own dashboard shows it.
  update public.profiles p
     set membership_status = 'unverified',
         membership_tier = null
   where p.id = any (v_profiles)
     and (p.membership_status <> 'unverified' or p.membership_tier is not null);

  return jsonb_build_object(
    'accounts', coalesce(array_length(v_profiles, 1), 0),
    'positions_ended', v_positions
  );
end
$$;

-- ---------------------------------------------------------------------------------------------
-- rpc/reinstate_roster_member
-- ---------------------------------------------------------------------------------------------

-- Answers { status }: the status the row has again (null when it had none).
create or replace function public.reinstate_roster_member(entry uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.roster_entries%rowtype;
begin
  if not app.is_president() then
    raise exception 'Only the President can reinstate a member.' using errcode = '42501';
  end if;

  select r.* into v_row
  from public.roster_entries r
  where r.id = reinstate_roster_member.entry
  for update;

  if not found then
    raise exception 'That member is no longer on the roster.' using errcode = '22023';
  end if;
  if v_row.dismissed_at is null then
    raise exception 'This member is not dismissed, so there is nothing to reinstate.'
      using errcode = '22023';
  end if;

  -- The status alone. app.sync_roster_entry passes this update by, so the account stays
  -- unverified, and the row keeps no committee and no position.
  perform set_config('app.roster_dismissal', 'on', true);
  update public.roster_entries r
     set status = v_row.status_before_dismissal,
         status_before_dismissal = null,
         dismissed_at = null,
         dismissed_by = null,
         dismissal_reason = null
   where r.id = v_row.id;
  perform set_config('app.roster_dismissal', 'off', true);

  -- An offer that reached the table while the member was dismissed (the rollover and the
  -- roster write theirs many at a time) was never taken up. It goes, so that the
  -- reinstatement gives no position back by itself at the next sign-in. One the roster itself
  -- stands behind stays: an ordinary row lists that address with that position, the offer is
  -- that row's to withdraw (app.guard_invite_delete would refuse it here), and a member who
  -- is one again may take it up.
  delete from public.invites i
   where i.accepted_at is null
     and i.email_normalized in (
       select v_row.email_normalized
       union all
       select p.email_normalized
       from public.profiles p
       where p.id = v_row.profile_id or p.email_normalized = v_row.email_normalized
     )
     and not app.position_from_roster(i.position_id, i.email_normalized, null);

  return jsonb_build_object('status', v_row.status_before_dismissal);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- The import leaves a dismissed member alone
-- ---------------------------------------------------------------------------------------------

-- As 20260920110001, with one more way for a line to be left alone (skipped_dismissed): it
-- names a dismissed member, or its status says dismissed, which only the President can do. The
-- match is wider here than in the guard, the same name alone being enough: an hourly job cannot
-- ask whether a changed email is a correction or another person, and the board can still add a
-- namesake by hand, with their own email. A namesake who was on the roster before the
-- dismissal is not frozen by it: their line is the one an ordinary row already answers to.
create or replace function app.apply_roster_rows(p_rows jsonb, p_batch text, p_source text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_name text;
  v_name_norm text;
  v_email text;
  v_status text;
  v_joined int;
  v_years int;
  v_lgas text;
  v_ngas text;
  v_position text;
  v_key text;
  v_seen text[] := '{}';
  v_row public.roster_entries%rowtype;
  v_batch text := left(nullif(btrim(coalesce(p_batch, '')), ''), 80);
  v_inserted int := 0;
  v_updated int := 0;
  v_unchanged int := 0;
  v_kept int := 0;
  v_invalid int := 0;
  v_duplicates int := 0;
  v_dismissed int := 0;
  v_missing int;
  v_missing_names jsonb;
  v_claimed int;
  v_result jsonb;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be a JSON array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) = 0 then
    raise exception 'No member rows found in that file.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 5000 then
    raise exception 'Too many rows (limit 5000).' using errcode = '22023';
  end if;
  if v_batch is null then
    v_batch := to_char(now() at time zone 'Africa/Cairo', 'YYYY-MM-DD');
  end if;

  perform set_config('app.roster_import', 'on', true);

  for v_item in select e from jsonb_array_elements(p_rows) as t(e) loop
    if jsonb_typeof(v_item) <> 'object' then
      v_invalid := v_invalid + 1;
      continue;
    end if;
    v_name := left(btrim(regexp_replace(coalesce(v_item ->> 'full_name', ''), '\s+', ' ', 'g')), 200);
    if v_name = '' then
      v_invalid := v_invalid + 1;
      continue;
    end if;
    v_name_norm := app.normalize_text(v_name);
    v_email := left(nullif(btrim(v_item ->> 'email'), ''), 200);
    v_status := left(nullif(btrim(v_item ->> 'status'), ''), 80);
    v_lgas := left(nullif(btrim(v_item ->> 'lgas'), ''), 20);
    v_ngas := left(nullif(btrim(v_item ->> 'ngas'), ''), 20);
    v_position := left(nullif(btrim(v_item ->> 'current_position'), ''), 400);
    v_joined := case when (v_item ->> 'joined_year') ~ '^\s*\d{1,4}\s*$'
                     then btrim(v_item ->> 'joined_year')::int end;
    v_years := case when (v_item ->> 'years_spent') ~ '^\s*\d{1,3}\s*$'
                    then btrim(v_item ->> 'years_spent')::int end;
    -- years spent is counted from the joining year (app.years_spent); the sheet's own number only
    -- matters for the few rows with no joining year, so it never makes a row look changed
    if v_joined is not null then
      v_years := coalesce(app.years_spent(v_joined), v_years);
    end if;

    v_key := encode(
      sha256(convert_to(v_name_norm || '|' || coalesce(app.norm_email(v_email), ''), 'UTF8')),
      'hex'
    );
    if v_key = any (v_seen) then
      v_duplicates := v_duplicates + 1;
      continue;
    end if;
    v_seen := v_seen || v_key;

    -- a dismissed member's line changes nothing and adds nobody; neither does a line that
    -- would dismiss somebody. The name alone is enough, except for a namesake the roster
    -- already has: an ordinary row with this line's own key (the same name and email) is
    -- another person, and their line goes on as it always did
    if app.normalize_text(v_status) like '%dismiss%'
      or app.is_dismissed_email(v_email)
      or exists (
        select 1 from public.roster_entries d
        where d.dismissed_at is not null and d.source_key = v_key)
      or (exists (
            select 1 from public.roster_entries d
            where d.dismissed_at is not null and d.name_normalized = v_name_norm)
          and not exists (
            select 1 from public.roster_entries o
            where o.dismissed_at is null and o.source_key = v_key))
    then
      v_dismissed := v_dismissed + 1;
      continue;
    end if;

    select r.* into v_row from public.roster_entries r where r.source_key = v_key;
    if not found and v_email is not null then
      -- the sheet gained an email for someone it already listed without one
      if (select count(*) from public.roster_entries r
          where r.name_normalized = v_name_norm and r.email_normalized is null
            and r.origin = 'sheet' and r.source_key <> all (v_seen)) = 1 then
        select r.* into v_row
        from public.roster_entries r
        where r.name_normalized = v_name_norm and r.email_normalized is null
          and r.origin = 'sheet' and r.source_key <> all (v_seen);
      end if;
    end if;

    if v_row.id is null then
      insert into public.roster_entries (
        source_key, full_name, name_normalized, email, status, joined_year, years_spent,
        lgas, ngas, current_position, import_batch, imported_at, origin
      )
      values (
        v_key, v_name, v_name_norm, v_email, v_status, v_joined, v_years,
        v_lgas, v_ngas, v_position, v_batch, now(), 'sheet'
      );
      v_inserted := v_inserted + 1;
    elsif (v_name, v_email, v_status, v_joined, v_years, v_lgas, v_ngas, v_position)
          is not distinct from
          (v_row.full_name, v_row.email, v_row.status, v_row.joined_year, v_row.years_spent,
           v_row.lgas, v_row.ngas, v_row.current_position) then
      v_unchanged := v_unchanged + 1;
    elsif v_row.portal_edited_at is not null then
      v_kept := v_kept + 1;
    else
      update public.roster_entries r
        set source_key = v_key,
            full_name = v_name,
            email = v_email,
            status = v_status,
            joined_year = v_joined,
            years_spent = v_years,
            lgas = v_lgas,
            ngas = v_ngas,
            current_position = v_position,
            import_batch = v_batch,
            imported_at = now()
      where r.id = v_row.id;
      v_updated := v_updated + 1;
    end if;
    v_row := null;
  end loop;

  if v_inserted + v_updated + v_unchanged + v_kept + v_dismissed = 0 then
    raise exception 'No member rows found in that file.' using errcode = '22023';
  end if;

  -- a dismissed member taken off the sheet is what one would expect, so is not reported
  select count(*)::int,
         coalesce(jsonb_agg(m.full_name order by m.full_name) filter (where m.rn <= 50), '[]'::jsonb)
    into v_missing, v_missing_names
  from (
    select r.full_name, row_number() over (order by r.full_name) as rn
    from public.roster_entries r
    where r.origin = 'sheet'
      and r.portal_edited_at is null
      and r.dismissed_at is null
      and r.source_key <> all (v_seen)
  ) m;

  v_claimed := app.claim_unlinked();

  v_result := jsonb_build_object(
    'received', jsonb_array_length(p_rows),
    'inserted', v_inserted,
    'updated', v_updated,
    'unchanged', v_unchanged,
    'kept_portal_edits', v_kept,
    'skipped_invalid', v_invalid,
    'skipped_duplicates', v_duplicates,
    'missing_from_sheet', v_missing,
    'missing_names', v_missing_names,
    'profiles_checked', v_claimed
  );
  -- Only when a line was left alone for it, so a run with none answers in the shape it
  -- always had.
  if v_dismissed > 0 then
    v_result := v_result || jsonb_build_object('skipped_dismissed', v_dismissed);
  end if;

  insert into public.roster_sync_runs (source, actor, batch, result)
  values (p_source, auth.uid(), v_batch, v_result);

  perform set_config('app.roster_import', 'off', true);
  return v_result;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Bulk updates and their undo skip a dismissed row
-- ---------------------------------------------------------------------------------------------

-- As 20260921090001. A dismissed member on the pasted list is skipped with the reason
-- "dismissed" and the rest of the list goes through; the guard alone would have refused the
-- whole update. Setting the status "Dismissed" in bulk is refused before anything is written.
create or replace function public.bulk_update_roster(
  ids uuid[],
  action text,
  label text,
  value text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_label text := left(btrim(regexp_replace(coalesce(label, ''), '\s+', ' ', 'g')), 120);
  v_value text := left(nullif(btrim(coalesce(value, '')), ''), 80);
  v_row public.roster_entries%rowtype;
  v_field text;
  v_before text;
  v_after text;
  v_committee uuid;
  v_changes jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_log bigint;
begin
  if not app.is_eb() then
    raise exception 'only the executive board can update the roster in bulk' using errcode = '42501';
  end if;
  if action is null or action not in ('lga', 'nga', 'status', 'committee') then
    raise exception 'action must be lga, nga, status or committee' using errcode = '22023';
  end if;
  if v_label = '' then
    raise exception 'Name the event or the reason, so this update can be found again.' using errcode = '22023';
  end if;
  if action = 'status' and v_value is null then
    raise exception 'Choose the status to set.' using errcode = '22023';
  end if;
  if action = 'status' and app.normalize_text(v_value) like '%dismiss%' then
    raise exception 'Only the President can dismiss a member, with Dismiss member on the Roster page.'
      using errcode = '42501';
  end if;
  if action = 'committee' and v_value is not null then
    select c.id into v_committee from public.committees c where c.slug = lower(v_value);
    if v_committee is null then
      raise exception 'Unknown committee "%".', v_value using errcode = '22023';
    end if;
  end if;
  if coalesce(array_length(ids, 1), 0) = 0 then
    raise exception 'Nobody is selected.' using errcode = '22023';
  end if;
  if array_length(ids, 1) > 1000 then
    raise exception 'Too many members at once (limit 1000).' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.roster_bulk_updates b
    where b.action = bulk_update_roster.action
      and lower(b.label) = lower(v_label)
      and b.undone_at is null
  ) then
    raise exception '"%" has already been applied. Undo it first, or give this one another name.', v_label
      using errcode = '22023';
  end if;

  v_field := case action
    when 'lga' then 'lgas' when 'nga' then 'ngas' when 'committee' then 'committee_id' else 'status' end;

  for v_row in
    select r.* from public.roster_entries r
    where r.id = any (select distinct unnest(ids))
    order by r.full_name
    for update
  loop
    if v_row.dismissed_at is not null then
      v_skipped := v_skipped || jsonb_build_object(
        'id', v_row.id, 'full_name', v_row.full_name, 'reason', 'dismissed');
      continue;
    end if;

    v_before := case v_field
      when 'lgas' then v_row.lgas when 'ngas' then v_row.ngas
      when 'committee_id' then v_row.committee_id::text else v_row.status end;
    v_after := case action
      when 'status' then v_value
      when 'committee' then v_committee::text
      else app.bump_count(v_before) end;

    if v_after is null and action <> 'committee' then
      v_skipped := v_skipped || jsonb_build_object(
        'id', v_row.id, 'full_name', v_row.full_name,
        'reason', format('"%s" is not a number', v_before));
      continue;
    end if;
    if v_after is not distinct from v_before then
      v_skipped := v_skipped || jsonb_build_object(
        'id', v_row.id, 'full_name', v_row.full_name,
        'reason', case when action = 'committee' then 'already there' else 'already ' || v_after end);
      continue;
    end if;

    if v_field = 'lgas' then
      update public.roster_entries set lgas = v_after where id = v_row.id;
    elsif v_field = 'ngas' then
      update public.roster_entries set ngas = v_after where id = v_row.id;
    elsif v_field = 'committee_id' then
      update public.roster_entries set committee_id = v_committee where id = v_row.id;
    else
      update public.roster_entries set status = v_after where id = v_row.id;
    end if;

    v_changes := v_changes || jsonb_build_object(
      'id', v_row.id, 'full_name', v_row.full_name,
      'field', v_field, 'before', v_before, 'after', v_after);
  end loop;

  if jsonb_array_length(v_changes) = 0 then
    return jsonb_build_object('updated', 0, 'skipped', v_skipped, 'log_id', null);
  end if;

  insert into public.roster_bulk_updates (actor, action, value, label, changes)
  values (auth.uid(), action, v_value, v_label, v_changes)
  returning id into v_log;

  return jsonb_build_object(
    'updated', jsonb_array_length(v_changes), 'skipped', v_skipped, 'log_id', v_log);
end
$$;

-- As 20260921090001. A member dismissed since the update keeps the record as it stands and
-- is reported ("dismissed since"), so the rest of the update can still be undone.
create or replace function public.undo_roster_bulk_update(log_id bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_log public.roster_bulk_updates%rowtype;
  v_change jsonb;
  v_current text;
  v_dismissed boolean;
  v_restored int := 0;
  v_skipped jsonb := '[]'::jsonb;
begin
  if not app.is_eb() then
    raise exception 'only the executive board can undo a bulk update' using errcode = '42501';
  end if;
  select * into v_log from public.roster_bulk_updates b
  where b.id = undo_roster_bulk_update.log_id for update;
  if not found then
    raise exception 'bulk update % not found', log_id using errcode = 'P0002';
  end if;
  if v_log.undone_at is not null then
    raise exception 'That update was already undone.' using errcode = '22023';
  end if;

  for v_change in select e from jsonb_array_elements(v_log.changes) as t(e) loop
    select case v_change ->> 'field'
             when 'lgas' then r.lgas when 'ngas' then r.ngas
             when 'committee_id' then r.committee_id::text else r.status end,
           r.dismissed_at is not null
      into v_current, v_dismissed
    from public.roster_entries r where r.id = (v_change ->> 'id')::uuid for update;

    if not found then
      v_skipped := v_skipped || jsonb_build_object(
        'full_name', v_change ->> 'full_name', 'reason', 'no longer on the roster');
    elsif v_dismissed then
      v_skipped := v_skipped || jsonb_build_object(
        'full_name', v_change ->> 'full_name', 'reason', 'dismissed since');
    elsif v_current is distinct from (v_change ->> 'after') then
      v_skipped := v_skipped || jsonb_build_object(
        'full_name', v_change ->> 'full_name', 'reason', 'changed again since');
    else
      if v_change ->> 'field' = 'lgas' then
        update public.roster_entries set lgas = v_change ->> 'before' where id = (v_change ->> 'id')::uuid;
      elsif v_change ->> 'field' = 'ngas' then
        update public.roster_entries set ngas = v_change ->> 'before' where id = (v_change ->> 'id')::uuid;
      elsif v_change ->> 'field' = 'committee_id' then
        -- a committee deleted since then simply leaves the member without one
        update public.roster_entries
           set committee_id = (select c.id from public.committees c where c.id = (v_change ->> 'before')::uuid)
         where id = (v_change ->> 'id')::uuid;
      else
        update public.roster_entries set status = v_change ->> 'before' where id = (v_change ->> 'id')::uuid;
      end if;
      v_restored := v_restored + 1;
    end if;
  end loop;

  update public.roster_bulk_updates
    set undone_at = now(), undone_by = auth.uid()
  where id = v_log.id;

  return jsonb_build_object('restored', v_restored, 'skipped', v_skipped);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Public readers
-- ---------------------------------------------------------------------------------------------

-- The member count on the home page, as 20260919200001, without dismissed members.
create or replace function public.roster_stats()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'count', count(*) filter (
      where r.dismissed_at is null
        and not (coalesce(r.status, '') ilike '%archiv%' or coalesce(r.status, '') ilike '%suspend%')),
    'updated_at', max(r.updated_at)
  )
  from public.roster_entries r
$$;

-- rpc/check_membership, as 20261005190001, with a fifth answer. For a dismissed member it is
-- { "state": "ended" } and nothing else: the page says that the membership has ended and who
-- to ask, and no status, date or reason leaves the database. A dismissed row is taken first
-- among the rows of an email, so no other row can answer for the same person.
create or replace function public.check_membership(
  name text default '',
  email text default '',
  role text default null,
  accept_near boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_name text := app.normalize_text(left(coalesce(check_membership.name, ''), 200));
  v_email text := app.norm_email(left(coalesce(check_membership.email, ''), 200));
  v_headers jsonb;
  v_ip text;
  v_ip_hash text;
  v_row public.roster_entries%rowtype;
  v_count int;
  v_near_id uuid;
  v_near_email text;
  v_names text[];
begin
  if v_name = '' and v_email is null and role is null then
    return jsonb_build_object('state', 'not-found');
  end if;

  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    v_headers := null;
  end;
  v_ip := btrim(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1));
  if v_ip <> '' then
    v_ip_hash := encode(sha256(convert_to(v_ip, 'UTF8')), 'hex');
  end if;

  delete from app.membership_lookup_hits h where h.at < now() - interval '1 hour';
  if (select count(*) from app.membership_lookup_hits h where h.at > now() - interval '1 minute') >= 300
    or (v_ip_hash is not null and (
      select count(*) from app.membership_lookup_hits h
      where h.ip_hash = v_ip_hash and h.at > now() - interval '10 minutes') >= 30)
  then
    raise exception 'Too many lookups right now, please retry in a few minutes.' using errcode = '22023';
  end if;
  insert into app.membership_lookup_hits (ip_hash) values (v_ip_hash);

  if role = 'supervising-council' then
    select count(*) into v_count
    from public.roster_entries r where r.current_position ilike '%supervising council%';
    if v_count = 1 then
      select r.* into v_row
      from public.roster_entries r where r.current_position ilike '%supervising council%';
    end if;
  end if;

  if v_row.id is null and v_email is not null then
    select r.* into v_row
    from public.roster_entries r
    where r.email_normalized = v_email
    order by
      (r.dismissed_at is not null) desc,
      (coalesce(r.status, '') ilike '%archiv%' or coalesce(r.status, '') ilike '%suspend%') asc,
      case
        when r.status ilike '%full%' then 3
        when r.status ilike '%associate%' then 2
        when r.status ilike '%candidate%' then 1
        else 0
      end desc,
      r.joined_year desc nulls last,
      r.updated_at desc
    limit 1;
  end if;

  if v_row.id is null and v_name <> '' then
    select count(*) into v_count from public.roster_entries r where r.name_normalized = v_name;
    if v_count > 1 then
      return jsonb_build_object('state', 'ambiguous');
    elsif v_count = 1 then
      select r.* into v_row from public.roster_entries r where r.name_normalized = v_name;
    end if;
  end if;

  -- near-miss email: only a unique neighbour counts, and only for something shaped like an email
  if v_row.id is null and v_email ~ '^[^@\s]{2,}@[^@\s]+\.[^@\s]+$' then
    select count(*), (array_agg(r.id))[1], (array_agg(r.email_normalized))[1]
      into v_count, v_near_id, v_near_email
    from public.roster_entries r
    where r.email_normalized is not null
      and extensions.levenshtein_less_equal(r.email_normalized, v_email, 2) <= 2;
    if v_count = 1 and coalesce(accept_near, false) then
      select r.* into v_row from public.roster_entries r where r.id = v_near_id;
    elsif v_count <> 1 then
      v_near_email := null;
    end if;
  end if;

  if v_row.id is null then
    if v_near_email is not null then
      return jsonb_build_object(
        'state', 'not-found',
        'suggestions', jsonb_build_object('email', app.mask_email(v_near_email)));
    end if;
    if v_name <> '' then
      v_names := app.roster_name_suggestions(v_name);
      if v_names is not null then
        return jsonb_build_object(
          'state', 'not-found',
          'suggestions', jsonb_build_object('names', to_jsonb(v_names)));
      end if;
    end if;
    return jsonb_build_object('state', 'not-found');
  end if;

  if v_row.dismissed_at is not null then
    return jsonb_build_object('state', 'ended');
  end if;

  return jsonb_build_object(
    'state', 'found',
    'record', jsonb_build_object(
      'status', coalesce(v_row.status, ''),
      'yearJoined', coalesce(v_row.joined_year::text, ''),
      'yearsSpent', coalesce(v_row.years_spent::text, ''),
      'lgas', coalesce(v_row.lgas, ''),
      'ngas', coalesce(v_row.ngas, ''),
      'currentPosition', app.roster_positions_text(v_row)
    )
  );
end
$$;

-- ---------------------------------------------------------------------------------------------
-- The President's position is the President's own
-- ---------------------------------------------------------------------------------------------

-- "The President alone" is worth what the road to that position is worth. Until here any
-- member of the Executive Board could take it: point its work email at an address of their
-- own and invite that address, or give the position a level below officer (which needs no
-- work email at all), or delete it and add another under the same key.

-- As 20261005180001, with a second position that only its holder repoints: the President's
-- work email is changed by the President, as the webmaster's is by the webmaster. Not by the
-- rest of the board, and not by the webmaster either.
create or replace function app.can_set_work_email(p_position uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_eb() and coalesce((
    select case
      when p.key = 'eb.president' then app.is_president()
      when p.level = 'webmaster' then app.is_webmaster()
      else true
    end
    from public.positions p
    where p.id = p_position
  ), true)
$$;

-- Before insert, update and delete on positions. The President's position is never removed
-- and never leaves the Executive Board's level, whoever asks; and of the people signed in to
-- the portal only the President changes anything else about it. A session with no account
-- (the owner of the database, at the SQL editor) may still rename or retire it. The name sorts
-- before normalize_position, so this reads what the writer sent; the key itself never changes
-- on an update (normalize_position puts the old one back).
create or replace function app.guard_president_position()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.key = 'eb.president' then
      raise exception 'The President''s position cannot be removed.' using errcode = '42501';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.key = 'eb.president' and (new.level is distinct from 'eb' or new.committee_id is not null) then
      raise exception 'The President''s position belongs to the Executive Board.' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.key = 'eb.president' then
    if new.level is distinct from old.level then
      raise exception 'The President''s position belongs to the Executive Board. Its level cannot be changed.'
        using errcode = '42501';
    end if;
    if new is distinct from old and auth.uid() is not null and not app.is_president() then
      raise exception 'Only the President changes the President''s position.' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists guard_president_position on public.positions;
create trigger guard_president_position before insert or update or delete on public.positions
  for each row execute function app.guard_president_position();

-- ---------------------------------------------------------------------------------------------
-- Ownership + grants
-- ---------------------------------------------------------------------------------------------

alter function app.is_president() owner to postgres;
alter function app.roster_dismissing() owner to postgres;
alter function app.is_dismissed_profile(uuid) owner to postgres;
alter function app.is_dismissed_email(text) owner to postgres;
alter function app.can_set_work_email(uuid) owner to postgres;
alter function app.guard_president_position() owner to postgres;
alter function app.handle_new_invite() owner to postgres;
alter function app.sync_roster_position() owner to postgres;
alter function public.invite_to_position(text, uuid) owner to postgres;
alter function app.guard_roster_dismissal() owner to postgres;
alter function app.guard_dismissed_profile() owner to postgres;
alter function app.guard_dismissed_holder() owner to postgres;
alter function app.verify_position_holder() owner to postgres;
alter function app.sync_roster_entry() owner to postgres;
alter function app.claim_for_profile(uuid) owner to postgres;
alter function app.apply_roster_rows(jsonb, text, text) owner to postgres;
alter function public.dismiss_roster_member(uuid, text) owner to postgres;
alter function public.reinstate_roster_member(uuid) owner to postgres;
alter function public.bulk_update_roster(uuid[], text, text, text) owner to postgres;
alter function public.undo_roster_bulk_update(bigint) owner to postgres;
alter function public.roster_stats() owner to postgres;
alter function public.check_membership(text, text, text, boolean) owner to postgres;

-- A signed-in person may ask whether they are the President. The other helpers and the
-- trigger functions are called only inside security-definer functions, so nobody is granted
-- them.
revoke execute on function app.is_president() from public;
grant execute on function app.is_president() to authenticated;
revoke execute on function app.roster_dismissing() from public;
revoke execute on function app.is_dismissed_profile(uuid) from public;
-- these two run inside row-level security policies, as the caller
revoke execute on function app.is_dismissed_email(text) from public;
grant execute on function app.is_dismissed_email(text) to authenticated;
revoke execute on function app.can_set_work_email(uuid) from public;
grant execute on function app.can_set_work_email(uuid) to authenticated;
revoke execute on function app.guard_president_position() from public;
revoke execute on function app.handle_new_invite() from public;
revoke execute on function app.sync_roster_position() from public;
revoke execute on function app.guard_roster_dismissal() from public;
revoke execute on function app.guard_dismissed_profile() from public;
revoke execute on function app.guard_dismissed_holder() from public;
revoke execute on function app.verify_position_holder() from public;
revoke execute on function app.sync_roster_entry() from public;
revoke execute on function app.claim_for_profile(uuid) from public, anon, authenticated, service_role;
revoke execute on function app.apply_roster_rows(jsonb, text, text) from public, anon, authenticated, service_role;

-- The secret key is nobody's account, so it could not be the President; it is not granted the
-- two functions either, and that is said here because the hosted project grants every new
-- function in public to it by default.
revoke execute on function public.dismiss_roster_member(uuid, text) from public, anon, service_role;
grant execute on function public.dismiss_roster_member(uuid, text) to authenticated;
revoke execute on function public.reinstate_roster_member(uuid) from public, anon, service_role;
grant execute on function public.reinstate_roster_member(uuid) to authenticated;

revoke execute on function public.invite_to_position(text, uuid) from public, anon;
grant execute on function public.invite_to_position(text, uuid) to authenticated;

revoke execute on function public.bulk_update_roster(uuid[], text, text, text) from public, anon;
grant execute on function public.bulk_update_roster(uuid[], text, text, text) to authenticated;
revoke execute on function public.undo_roster_bulk_update(bigint) from public, anon;
grant execute on function public.undo_roster_bulk_update(bigint) to authenticated;

revoke execute on function public.roster_stats() from public;
grant execute on function public.roster_stats() to anon, authenticated;
revoke execute on function public.check_membership(text, text, text, boolean) from public;
grant execute on function public.check_membership(text, text, text, boolean) to anon, authenticated;
