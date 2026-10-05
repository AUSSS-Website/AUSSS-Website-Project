-- Phase 5b, step 1: the notifications bell gets a "Clear all" action.
--
-- Until now a person could read their notifications and mark them read; the rows themselves
-- stayed for good. Clearing is a delete of one's own rows, nothing more: the same ownership
-- test as the select and update policies. A cleared notification that was never emailed simply
-- drops out of the next digest, which is what clearing it means.

grant delete on public.notifications to authenticated;

drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications
  for delete to authenticated
  using (profile_id = (select auth.uid()));
