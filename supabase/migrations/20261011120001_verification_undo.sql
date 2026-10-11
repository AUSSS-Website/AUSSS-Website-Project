-- Undo on member verification.
--
-- The Executive Board approves or declines a member's request on the portal's verification
-- queue (rpc/decide_verification). A slip there could not be taken back: the function accepts a
-- pending request only, and nothing kept what the member's status had been before an approval.
--
-- From this migration on a decision keeps what it found, on the request's own row:
--   member_status_before, member_tier_before, member_joined_year_before
--       the member's membership fields as the decision found them;
--   member_status_after
--       the status the decision left: the granted one after an approval, the same one after a
--       decline, which changes nothing on the profile.
-- All four are empty while a request is pending.
--
-- rpc/undo_verification_decision(request_id, decision) puts a decided request back to pending
-- and, after an approval, the member's status back to member_status_before. An approval changes
-- nothing else on the profile, so the profile is then exactly what it was (updated_at aside,
-- which the set_updated_at trigger owns). It is for the Executive Board, as deciding is, and
-- only for the board member who made the decision.
--
-- `decision` names the decision being taken back ('approved' or 'declined'). The request's id
-- alone would not do: a request can be decided, undone and decided again, and an Undo left
-- open in another tab, or pressed again after a lost answer, would then take back the later
-- decision, which may be another board member's.
--
-- It refuses, each time with a sentence the portal shows as it is (errcode 22023):
--   * a request that is not decided: still waiting, or undone already;
--   * a request decided again since, so that its decision is not the one named;
--   * a decision made before this migration, which kept nothing to go back to;
--   * a decision another board member made;
--   * a member who has sent a newer request since the decision, or whose other request was
--     decided after this one;
--   * an approval after which the member's status, tier or joining year changed again (the
--     roster, or the board by hand), because going back would overwrite the newer change;
--   * an approval of an unverified member who is by now on the roster or holds a position:
--     either verifies a member by itself, and neither would do so a second time.
--
-- Also here: a member files a request with their profile and a message and nothing else. The
-- insert grant on verification_requests was table-wide, so a request could arrive with a date
-- of its own (the undo compares dates) or with the kept columns already filled. It is now a
-- grant on those two columns.
--
-- What it leaves alone. No notification and no email is sent when a request is decided, so
-- there is none to take back, and the undo sends none either: the member's Verify page reads
-- the request and shows it as pending again. The audit log is only ever added to. The audit
-- triggers on verification_requests and on profiles record the undo as they recorded the
-- decision (the request going from approved to pending, the profile from active to what it
-- was, with whoever undid it as the actor), and the rows of the decision itself stay.

-- ---------------------------------------------------------------------------------------------
-- What a decision keeps
-- ---------------------------------------------------------------------------------------------

alter table public.verification_requests
  add column if not exists member_status_before text null;
alter table public.verification_requests
  add column if not exists member_tier_before text null;
alter table public.verification_requests
  add column if not exists member_joined_year_before int null;
alter table public.verification_requests
  add column if not exists member_status_after text null;

alter table public.verification_requests
  drop constraint if exists verification_requests_member_status_values;
alter table public.verification_requests
  add constraint verification_requests_member_status_values check (
    (member_status_before is null
       or member_status_before in ('unverified', 'candidate', 'active', 'alumni'))
    and (member_status_after is null
       or member_status_after in ('unverified', 'candidate', 'active', 'alumni'))
  );

-- The two statuses are kept together, and a pending request keeps nothing. The column grant
-- below already stops a member from filing a request with a "before" of their own choosing;
-- this holds whoever writes the row.
alter table public.verification_requests
  drop constraint if exists verification_requests_kept_when_decided;
alter table public.verification_requests
  add constraint verification_requests_kept_when_decided check (
    (member_status_before is null) = (member_status_after is null)
    and (
      status <> 'pending'
      or (member_status_before is null
          and member_tier_before is null
          and member_joined_year_before is null)
    )
  );

-- ---------------------------------------------------------------------------------------------
-- A member files a request with a profile and a message
-- ---------------------------------------------------------------------------------------------

-- The grant was on the whole table (20260913100005, issued again in 20260919160004), which let
-- a member set created_at, and now the kept columns, through the API. The portal sends
-- profile_id and message only, and everything else takes its default. Revoking the table's
-- insert takes any column grants with it, so the two lines can be run again.
revoke insert on public.verification_requests from authenticated;
grant insert (profile_id, message) on public.verification_requests to authenticated;

-- ---------------------------------------------------------------------------------------------
-- rpc/decide_verification: as 20260913100004, and it keeps what it found
-- ---------------------------------------------------------------------------------------------

-- The checks and their words are unchanged (the portal reads "is already approved" out of the
-- last one). New: the member's row is locked and read before anything is written, and the
-- request keeps its membership fields beside the decision.
create or replace function public.decide_verification(
  request_id uuid,
  decision text,
  new_status text default 'active'
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
  v_status text;
  v_was_status text;
  v_was_tier text;
  v_was_year int;
begin
  if not app.is_eb() then
    raise exception 'only the executive board can decide verification requests' using errcode = '42501';
  end if;
  if decision is null or decision not in ('approved', 'declined') then
    raise exception 'decision must be approved or declined' using errcode = '22023';
  end if;
  if new_status is null or new_status not in ('unverified', 'candidate', 'active', 'alumni') then
    raise exception 'invalid membership status %', new_status using errcode = '22023';
  end if;

  select vr.profile_id, vr.status
    into v_profile, v_status
  from public.verification_requests vr
  where vr.id = decide_verification.request_id
  for update;

  if v_profile is null then
    raise exception 'verification request % not found', request_id using errcode = 'P0002';
  end if;
  if v_status <> 'pending' then
    raise exception 'verification request % is already %', request_id, v_status using errcode = '22023';
  end if;

  -- Locked until the end of the call, so what is kept below is what the decision found.
  select p.membership_status, p.membership_tier, p.joined_year
    into v_was_status, v_was_tier, v_was_year
  from public.profiles p
  where p.id = v_profile
  for update;

  update public.verification_requests
    set status = decide_verification.decision,
        decided_by = auth.uid(),
        decided_at = now(),
        member_status_before = v_was_status,
        member_tier_before = v_was_tier,
        member_joined_year_before = v_was_year,
        member_status_after = case
          when decide_verification.decision = 'approved' then decide_verification.new_status
          else v_was_status
        end
  where id = decide_verification.request_id;

  if decision = 'approved' then
    update public.profiles
      set membership_status = decide_verification.new_status
    where id = v_profile;
  end if;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- rpc/undo_verification_decision: take a decision back
-- ---------------------------------------------------------------------------------------------

-- An earlier form of this migration made the function with the request's id alone. Where that
-- form was applied it goes, so that nothing can still call an undo that does not name its
-- decision.
drop function if exists public.undo_verification_decision(uuid);

create or replace function public.undo_verification_decision(request_id uuid, decision text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_req public.verification_requests%rowtype;
  v_status text;
  v_tier text;
  v_year int;
begin
  if not app.is_eb() then
    raise exception 'Only the Executive Board can undo a verification decision.'
      using errcode = '42501';
  end if;
  if decision is null or decision not in ('approved', 'declined') then
    raise exception 'decision must be approved or declined' using errcode = '22023';
  end if;

  -- The request's row is the first lock: a second undo, or a decision, waits here and then
  -- reads what the first one left.
  select vr.* into v_req
  from public.verification_requests vr
  where vr.id = undo_verification_decision.request_id
  for update;

  if not found then
    raise exception 'That verification request no longer exists.' using errcode = '22023';
  end if;

  -- The member's row is the second, in the order decide_verification takes the two, and for a
  -- decline as well as an approval. It is `for update` and nothing weaker: a new request
  -- takes a key-share lock on this row through its foreign key, and only this strength makes
  -- it wait. So no request of this member can arrive between the checks below and the write.
  select p.membership_status, p.membership_tier, p.joined_year
    into v_status, v_tier, v_year
  from public.profiles p
  where p.id = v_req.profile_id
  for update;

  if v_req.status = 'pending' then
    raise exception 'This request is waiting for a decision, so there is nothing to undo.'
      using errcode = '22023';
  end if;
  if v_req.status <> undo_verification_decision.decision then
    raise exception 'This request has been decided again since, so that decision is no longer there to undo.'
      using errcode = '22023';
  end if;
  if v_req.member_status_before is null then
    raise exception 'This decision was made before decisions could be undone. The webmaster can change the status of the member by hand.'
      using errcode = '22023';
  end if;
  -- The same decision made twice has one name, so the name alone does not tell a board
  -- member's own decision from a later one of a colleague's.
  if v_req.decided_by is distinct from auth.uid() then
    raise exception 'This decision was made by another board member, and only they can undo it.'
      using errcode = '22023';
  end if;

  -- The member's Verify page shows their latest request. With a newer one there, this one
  -- coming back would leave two answers to give for one person.
  if exists (
    select 1
    from public.verification_requests n
    where n.profile_id = v_req.profile_id
      and n.id <> v_req.id
      and n.created_at > v_req.decided_at
  ) then
    raise exception 'This member has sent a newer request since the decision. Decide that request instead.'
      using errcode = '22023';
  end if;
  -- Another request of theirs decided later is the newer word on this member, whichever way
  -- it went, and what this decision kept is from before it.
  if exists (
    select 1
    from public.verification_requests n
    where n.profile_id = v_req.profile_id
      and n.id <> v_req.id
      and n.decided_at > v_req.decided_at
  ) then
    raise exception 'Another request from this member has been decided since, so this decision can no longer be undone.'
      using errcode = '22023';
  end if;

  -- A decline wrote nothing on the profile, so there is nothing of it to put back.
  if v_req.status = 'approved' then
    if v_status is distinct from v_req.member_status_after
       or v_tier is distinct from v_req.member_tier_before
       or v_year is distinct from v_req.member_joined_year_before then
      raise exception 'The membership of this member has changed since the approval, so the approval cannot be undone.'
        using errcode = '22023';
    end if;

    -- The roster and a position each lift an unverified account once, when the link or the
    -- assignment is made (app.claim_for_profile, app.verify_position_holder), and found this
    -- account approved already. Taken back to unverified it would stay there for good.
    if v_req.member_status_before = 'unverified' and (
         exists (
           select 1 from public.assignments a
           where a.profile_id = v_req.profile_id and a.status = 'active'
         )
         or exists (
           select 1 from public.roster_entries r
           where r.profile_id = v_req.profile_id
             and not (coalesce(r.status, '') ilike '%archiv%' or coalesce(r.status, '') ilike '%suspend%')
         )
       ) then
      raise exception 'This member is now on the roster or holds a position, which verifies them, so the approval cannot be undone.'
        using errcode = '22023';
    end if;

    -- Not when the approval left the status as it found it: there is nothing to put back,
    -- and the audit log would gain a row that says nothing.
    update public.profiles p
      set membership_status = v_req.member_status_before
    where p.id = v_req.profile_id
      and p.membership_status is distinct from v_req.member_status_before;
  end if;

  update public.verification_requests vr
    set status = 'pending',
        decided_by = null,
        decided_at = null,
        member_status_before = null,
        member_tier_before = null,
        member_joined_year_before = null,
        member_status_after = null
  where vr.id = v_req.id;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Ownership + grants
-- ---------------------------------------------------------------------------------------------

alter function public.decide_verification(uuid, text, text) owner to postgres;
alter function public.undo_verification_decision(uuid, text) owner to postgres;

revoke execute on function public.decide_verification(uuid, text, text) from public, anon;
grant execute on function public.decide_verification(uuid, text, text) to authenticated;
revoke execute on function public.undo_verification_decision(uuid, text) from public, anon;
grant execute on function public.undo_verification_decision(uuid, text) to authenticated;
