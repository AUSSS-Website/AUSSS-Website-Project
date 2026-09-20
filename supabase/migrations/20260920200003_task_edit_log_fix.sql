-- Fix: editing a task's title, details, priority or due date failed with "malformed array
-- literal". In app.log_task(), `v_fields || 'title'` leaves the literal's type unknown, and
-- Postgres resolves text[] || unknown as array || array, so it tried to parse 'title' as an
-- array. array_append() takes the element type. Status changes and comments were unaffected.

create or replace function app.log_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_fields text[] := '{}';
begin
  if tg_op = 'INSERT' then
    insert into public.task_updates (task_id, author_id, kind)
    values (new.id, coalesce(v_uid, new.created_by), 'created');
    return null;
  end if;

  if new.status is distinct from old.status then
    insert into public.task_updates (task_id, author_id, kind, meta)
    values (new.id, v_uid, 'status', jsonb_build_object('from', old.status, 'to', new.status));
    perform app.notify_task(new.id, v_uid, 'task_status',
                            jsonb_build_object('from', old.status, 'to', new.status));
  end if;

  if new.title is distinct from old.title then v_fields := array_append(v_fields, 'title'); end if;
  if new.body is distinct from old.body then v_fields := array_append(v_fields, 'body'); end if;
  if new.priority is distinct from old.priority then v_fields := array_append(v_fields, 'priority'); end if;
  if new.due_on is distinct from old.due_on then v_fields := array_append(v_fields, 'due_on'); end if;
  if cardinality(v_fields) > 0 then
    insert into public.task_updates (task_id, author_id, kind, meta)
    values (new.id, v_uid, 'edited', jsonb_build_object('fields', to_jsonb(v_fields)));
  end if;
  return null;
end
$$;

alter function app.log_task() owner to postgres;
revoke execute on function app.log_task() from public;
