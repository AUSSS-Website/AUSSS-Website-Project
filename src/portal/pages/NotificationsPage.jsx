import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import usePageTitle from '../../hooks/usePageTitle.js'
import { useClearNotifications, useMarkNotificationsRead, useNames, useNotifications } from '../workQueries.js'
import { Centered, ConfirmButton, ErrorText, PageHeader, Panel, Spinner, outlineBtnCls } from '../portalUi.jsx'
import { UnreadDot, describeNotification, notificationTarget, when } from '../workUi.jsx'

// /portal/notifications. What happened on tasks this person is part of. Rows
// are written by database triggers (never for your own actions); opening one
// marks it read and goes to the task.

const EMPTY = []

export default function NotificationsPage() {
  usePageTitle('Notifications')
  const navigate = useNavigate()
  const feed = useNotifications()
  const markRead = useMarkNotificationsRead()
  const clear = useClearNotifications()
  const rows = feed.data || EMPTY
  const names = useNames(useMemo(() => rows.map((n) => n.payload?.actor_id), [rows]))
  const unread = rows.filter((n) => !n.read_at).length

  const open = (n) => {
    if (!n.read_at) markRead.mutate([n.id])
    const to = notificationTarget(n)
    if (to) navigate(to)
  }

  return (
    <>
      <PageHeader
        eyebrow="Notifications"
        title="Notifications"
        subtitle="Activity on your tasks, and what came in through the website forms."
        action={
          rows.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {unread > 0 && (
                <button type="button" disabled={markRead.isPending} onClick={() => markRead.mutate(undefined)} className={outlineBtnCls}>
                  Mark all as read
                </button>
              )}
              <ConfirmButton
                label="Clear all"
                busyLabel="Clearing…"
                busy={clear.isPending}
                onConfirm={() => clear.mutate()}
              />
            </div>
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
          <p className="text-sm text-soft/70">Nothing yet. You’ll be notified here when a task involves you.</p>
        </Panel>
      ) : (
        <ul className="max-w-3xl space-y-3">
          {rows.map((n) => {
            const { line, detail } = describeNotification(n, names)
            return (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => open(n)}
                  className={`flex w-full items-start gap-3 rounded-2xl border bg-card p-4 text-left transition-colors hover:border-line/25 ${
                    n.read_at ? 'border-line/10' : 'border-medical/50'
                  }`}
                >
                  <span className="mt-1.5 w-2 shrink-0">{!n.read_at && <UnreadDot />}</span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm ${n.read_at ? 'text-soft/75' : 'font-semibold text-ink'}`}>{line}</span>
                    {detail && <span className="mt-0.5 block truncate text-sm text-soft/60">{detail}</span>}
                    <span className="mt-1 block text-xs text-soft/40">{when(n.created_at)}</span>
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
