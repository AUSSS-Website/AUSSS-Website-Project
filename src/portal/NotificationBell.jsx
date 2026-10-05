import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  useClearNotifications,
  useMarkNotificationsRead,
  useNames,
  useNotifications,
  useUnreadCount,
} from './workQueries.js'
import { ErrorText, Spinner } from './portalUi.jsx'
import { UnreadDot, describeNotification, notificationTarget, when } from './workUi.jsx'

// The bell at the side of the portal header. A red dot while anything is
// unread; the panel lists the latest notifications one line each. Opening one
// marks it read and goes to its task, story or order. The full list stays at
// /portal/notifications ("See all").

const EMPTY = []
const SHOWN = 8

const linkBtnCls =
  'text-xs font-semibold text-medical-light transition-colors hover:text-white disabled:opacity-40'

export default function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const wrapRef = useRef(null)
  const btnRef = useRef(null)
  const navigate = useNavigate()
  const location = useLocation()

  const unread = useUnreadCount().data || 0
  // The list itself is only fetched once the panel has been opened.
  const feed = useNotifications(open)
  const markRead = useMarkNotificationsRead()
  const clear = useClearNotifications()
  const rows = feed.data || EMPTY
  const shown = useMemo(() => rows.slice(0, SHOWN), [rows])
  const names = useNames(useMemo(() => shown.map((n) => n.payload?.actor_id), [shown]))

  const close = () => {
    setOpen(false)
    setConfirming(false)
  }

  // Going anywhere closes the panel.
  useEffect(() => {
    setOpen(false)
    setConfirming(false)
  }, [location.pathname, location.search])

  useEffect(() => {
    if (!open) return undefined
    const onPointer = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) close()
    }
    const onKey = (e) => {
      if (e.key === 'Escape') {
        close()
        btnRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const openOne = (n) => {
    if (!n.read_at) markRead.mutate([n.id])
    close()
    const to = notificationTarget(n)
    if (to) navigate(to)
  }

  const error = feed.error || markRead.error || clear.error

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        className={`relative flex h-9 w-9 items-center justify-center rounded-full border transition-colors ${
          open
            ? 'border-white/40 bg-white/10 text-white'
            : 'border-white/20 text-silver/80 hover:bg-white/10 hover:text-white'
        }`}
      >
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute right-0 top-0 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-forest-950"
          />
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 z-50 mt-3 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-white/15 bg-forest-900 shadow-2xl shadow-black/50"
        >
          <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-medical-light">
              Notifications
            </p>
            {unread > 0 && (
              <button
                type="button"
                disabled={markRead.isPending}
                onClick={() => markRead.mutate(undefined)}
                className={linkBtnCls}
              >
                Mark all as read
              </button>
            )}
          </div>

          {feed.isPending ? (
            <div className="flex justify-center py-8">
              <Spinner className="h-5 w-5" />
            </div>
          ) : rows.length === 0 ? (
            <p className="px-4 py-6 text-sm text-silver/60">
              Nothing here. You’ll be told when a task involves you.
            </p>
          ) : (
            <ul className="max-h-[min(24rem,60vh)] divide-y divide-white/5 overflow-y-auto">
              {shown.map((n) => {
                const { line, detail } = describeNotification(n, names)
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => openOne(n)}
                      className="flex w-full items-start gap-2.5 px-4 py-3 text-left transition-colors hover:bg-white/5"
                    >
                      <span className="mt-1.5 w-2 shrink-0">{!n.read_at && <UnreadDot />}</span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block truncate text-sm ${
                            n.read_at ? 'text-silver/70' : 'font-semibold text-white'
                          }`}
                        >
                          {line}
                          {detail && <span className="font-normal text-silver/55"> · {detail}</span>}
                        </span>
                        <span className="mt-0.5 block text-xs text-silver/40">{when(n.created_at)}</span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          {error && (
            <div className="border-t border-white/10 px-4 py-2">
              <ErrorText>{error.message}</ErrorText>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-white/10 px-4 py-3">
            <Link to="/portal/notifications" onClick={close} className={linkBtnCls}>
              See all{rows.length > SHOWN ? ` (${rows.length})` : ''} &rarr;
            </Link>
            {rows.length > 0 &&
              (confirming ? (
                <span className="flex items-center gap-3">
                  <button
                    type="button"
                    disabled={clear.isPending}
                    onClick={() => clear.mutate(undefined, { onSuccess: () => setConfirming(false) })}
                    className="text-xs font-semibold text-red-300 transition-colors hover:text-red-200 disabled:opacity-40"
                  >
                    {clear.isPending ? 'Clearing…' : 'Yes, clear all'}
                  </button>
                  <button type="button" onClick={() => setConfirming(false)} className={linkBtnCls}>
                    Keep
                  </button>
                </span>
              ) : (
                <button type="button" onClick={() => setConfirming(true)} className={linkBtnCls}>
                  Clear all
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}
