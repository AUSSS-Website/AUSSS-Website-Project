import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import usePageTitle from '../../hooks/usePageTitle.js'
import { useMarkNotificationsRead, useNames, useNotifications } from '../workQueries.js'
import { Centered, ErrorText, PageHeader, Panel, Spinner, outlineBtnCls } from '../portalUi.jsx'
import { STATUS_LABEL, UnreadDot, personName, when } from '../workUi.jsx'

// /portal/notifications. What happened on tasks this person is part of. Rows
// are written by database triggers (never for your own actions); opening one
// marks it read and goes to the task.

const EMPTY = []

function describe(n, names) {
  const p = n.payload || {}
  const who = personName(names, p.actor_id, 'Someone')
  switch (n.kind) {
    case 'task_assigned':
      return { line: `${who} assigned you a task`, detail: p.title }
    case 'task_status':
      return { line: `${who} moved a task to ${STATUS_LABEL[p.to] || p.to}`, detail: p.title }
    case 'task_comment':
      return { line: `${who} commented on “${p.title}”`, detail: p.excerpt }
    default:
      return { line: 'Something changed', detail: p.title }
  }
}

export default function NotificationsPage() {
  usePageTitle('Notifications')
  const navigate = useNavigate()
  const feed = useNotifications()
  const markRead = useMarkNotificationsRead()
  const rows = feed.data || EMPTY
  const names = useNames(useMemo(() => rows.map((n) => n.payload?.actor_id), [rows]))
  const unread = rows.filter((n) => !n.read_at).length

  const open = (n) => {
    if (!n.read_at) markRead.mutate([n.id])
    if (n.payload?.task_id) navigate(`/portal/tasks/${n.payload.task_id}`)
  }

  return (
    <>
      <PageHeader
        eyebrow="Notifications"
        title="Notifications"
        subtitle="Activity on tasks you created or were assigned."
        action={
          unread > 0 && (
            <button type="button" disabled={markRead.isPending} onClick={() => markRead.mutate(undefined)} className={outlineBtnCls}>
              Mark all as read
            </button>
          )
        }
      />

      {feed.isPending ? (
        <Centered>
          <Spinner />
        </Centered>
      ) : feed.error ? (
        <Panel>
          <ErrorText>Couldn’t load notifications: {feed.error.message}</ErrorText>
        </Panel>
      ) : rows.length === 0 ? (
        <Panel>
          <p className="text-sm text-silver/70">Nothing yet. You’ll hear here when a task involves you.</p>
        </Panel>
      ) : (
        <ul className="max-w-3xl space-y-3">
          {rows.map((n) => {
            const { line, detail } = describe(n, names)
            return (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => open(n)}
                  className={`flex w-full items-start gap-3 rounded-2xl border bg-forest-800 p-4 text-left transition-colors hover:border-white/25 ${
                    n.read_at ? 'border-white/10' : 'border-medical/50'
                  }`}
                >
                  <span className="mt-1.5 w-2 shrink-0">{!n.read_at && <UnreadDot />}</span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm ${n.read_at ? 'text-silver/75' : 'font-semibold text-white'}`}>{line}</span>
                    {detail && <span className="mt-0.5 block truncate text-sm text-silver/60">{detail}</span>}
                    <span className="mt-1 block text-xs text-silver/40">{when(n.created_at)}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
