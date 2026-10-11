import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import usePageTitle from '../../hooks/usePageTitle.js'
import { useClearNotifications, useMarkNotificationsRead, useNames, useNotifications } from '../workQueries.js'
import { ConfirmButton, ErrorText, PageHeader, PageLoading, Panel, outlineBtnCls } from '../portalUi.jsx'
import { UnreadDot, describeNotification, notificationTarget, when } from '../workUi.jsx'
import { errorText } from '../../lib/errorText.js'

// /portal/notifications. What happened on tasks this person is part of. Rows
// are written by database triggers (never for your own actions); opening one
// marks it read and goes to the task.

const EMPTY = []

// The portal's pills are under 44px tall to the eye. This ::after gives a
// finger the difference without changing how they look.
const tapCls = "relative after:absolute after:inset-x-0 after:-inset-y-[10px] after:content-['']"

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

  // Both buttons leave the page once they have worked (nothing is unread, or
  // nothing is left), so what they did is also said in words: a line a screen
  // reader speaks, and an error where the eye already is when one fails.
  const actionError = clear.error
    ? errorText(clear.error, 'Couldn’t clear your notifications.')
    : markRead.error
      ? errorText(markRead.error, 'Couldn’t mark your notifications as read.')
      : ''
  const done = clear.isSuccess
    ? 'Notifications cleared.'
    : markRead.isSuccess && markRead.variables === undefined
      ? 'All notifications marked as read.'
      : ''

  return (
    <>
      <PageHeader
        eyebrow="Notifications"
        title="Notifications"
        subtitle="Activity on your tasks, and what came in through the website forms."
        action={
          rows.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-5">
              {unread > 0 && (
                <button
                  type="button"
                  disabled={markRead.isPending}
                  onClick={() => {
                    clear.reset()
                    markRead.mutate(undefined)
                  }}
                  className={`${outlineBtnCls} ${tapCls}`}
                >
                  Mark all as read
                </button>
              )}
              <ConfirmButton
                label="Clear all"
                busyLabel="Clearing…"
                busy={clear.isPending}
                onConfirm={() => {
                  markRead.reset()
                  clear.mutate()
                }}
                className={`${outlineBtnCls} ${tapCls}`}
                keepWidth
              />
            </div>
          )
        }
      />

      <p role="status" className="sr-only">
        {done}
      </p>
      {actionError && (
        <div className="max-w-3xl pb-4">
          <ErrorText>{actionError}</ErrorText>
        </div>
      )}

      {feed.isPending ? (
        <PageLoading />
      ) : feed.error ? (
        <Panel>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <ErrorText>{errorText(feed.error, 'Couldn’t load your notifications.')}</ErrorText>
            <button type="button" onClick={() => feed.refetch()} className={`${outlineBtnCls} ${tapCls}`}>
              Try again
            </button>
          </div>
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
                  // A row is the full width of the list, so it sinks by a hair
                  // where a pill sinks by 3%; the border darkens with it, and
                  // alone when the reader has asked for less motion.
                  className={`flex w-full items-start gap-3 rounded-2xl border bg-card p-4 text-left transition-[border-color,transform] duration-150 ease-out hover:border-line/25 active:border-line/40 motion-safe:active:scale-[0.99] ${
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
