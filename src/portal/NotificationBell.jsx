import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { errorText } from '../lib/errorText.js'
import { pressCls } from '../lib/motion.js'
import {
  useClearNotifications,
  useMarkNotificationsRead,
  useNames,
  useNotifications,
  useUnreadCount,
} from './workQueries.js'
import { ConfirmButton, ErrorText, Spinner } from './portalUi.jsx'
import { UnreadDot, describeNotification, notificationTarget, when } from './workUi.jsx'

// The bell at the side of the portal header. A red dot while anything is
// unread; the panel lists the latest notifications one line each. Opening one
// marks it read and goes to its task, story or order. "Clear all" empties this
// list and nothing else: what the notifications were about is untouched. The
// full list stays at /portal/notifications ("See all").
//
// The panel is a dialog that does not block the page. Opening it puts the
// keyboard inside it, so the list is the next thing Tab reaches and a screen
// reader says where it is. Escape, the bell, or opening a notification closes
// it and hands the keyboard back to the bell. A click anywhere else closes it,
// and so does tabbing on past its last control.

const EMPTY = []
const SHOWN = 8
// The room, in px, kept between the panel and the left edge of the screen.
// Less on a screen so narrow that the panel is at its `max-w`: there the room
// the panel leaves (2rem in all) is shared evenly between the two sides.
const EDGE = 16

// The bell is 40px to the eye and the panel's small links one line of text,
// both smaller still on a 320px phone, where the root size shrinks. Their
// ::after gives a finger 44px, in px for that reason, without changing how
// they look.
const tapCls =
  "relative after:absolute after:left-1/2 after:top-1/2 after:h-[44px] after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']"

const linkBtnCls = `inline-flex items-center text-xs font-semibold text-accent ${pressCls} ${tapCls} after:w-[calc(100%+1rem)] hover:text-ink disabled:opacity-40`

export default function NotificationBell() {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const btnRef = useRef(null)
  const panelRef = useRef(null)
  const panelId = useId()
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

  // Closing gives the keyboard back to the bell when it was inside the panel,
  // while the panel is still there to ask: afterwards the browser has already
  // dropped the focus to the top of the page.
  const close = () => {
    if (panelRef.current?.contains(document.activeElement)) btnRef.current?.focus()
    setOpen(false)
  }

  // Going anywhere closes the panel.
  useEffect(() => {
    setOpen(false)
  }, [location.pathname, location.search])

  // The panel hangs from the bell's right edge. On a phone the bell stands
  // well in from the edge of the screen, with the theme, profile and sign-out
  // buttons after it, and a panel hung there ran off the left of the screen.
  // `nudge` is how far it is moved to the right to stay on it, measured before
  // the panel is first drawn and again when the window changes size.
  const [nudge, setNudge] = useState(0)
  useLayoutEffect(() => {
    if (!open) return undefined
    const place = () => {
      const wrap = wrapRef.current
      const panel = panelRef.current
      if (!wrap || !panel) return
      const width = panel.offsetWidth
      const edge = Math.min(EDGE, (document.documentElement.clientWidth - width) / 2)
      setNudge(Math.max(0, width + edge - wrap.getBoundingClientRect().right))
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open])

  // Opening puts the keyboard on the panel itself: the list may still be
  // loading, and the panel is always there. Opened from the keyboard it shows
  // a ring, so the reader can see where the keyboard went; opened with a
  // pointer it shows none.
  useEffect(() => {
    if (open) panelRef.current?.focus({ preventScroll: true })
  }, [open])

  // A button in the panel can go away while it has the keyboard ("Mark all as
  // read" once nothing is unread, "Clear all" once the list is empty). The
  // keyboard then stays in the panel, not at the top of the page.
  useEffect(() => {
    if (open && document.activeElement === document.body) panelRef.current?.focus({ preventScroll: true })
  })

  useEffect(() => {
    if (!open) return undefined
    const onPointer = (e) => {
      // A click elsewhere takes the keyboard where it lands, so nothing is
      // handed back to the bell here.
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false)
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

  // One line, in the order of what matters most: without the list nothing
  // else in the panel can be used. The words are the notifications page's.
  const error = feed.error
    ? errorText(feed.error, 'Couldn’t load your notifications.')
    : clear.error
      ? errorText(clear.error, 'Couldn’t clear your notifications.')
      : markRead.error
        ? errorText(markRead.error, 'Couldn’t mark your notifications as read.')
        : ''
  // A list that could not be loaded is not an empty one: the error line
  // stands in its place, with a way to ask again.
  const listFailed = Boolean(feed.error) && rows.length === 0 && !feed.isPending

  return (
    <div
      ref={wrapRef}
      className="relative"
      onBlur={(e) => {
        // Tabbing on past the panel closes it. Focus that goes nowhere (a
        // button inside was taken away, the window lost focus) leaves it open.
        if (open && e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) setOpen(false)
      }}
    >
      <button
        ref={btnRef}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        className={`flex h-10 w-10 items-center justify-center rounded-full border ${pressCls} ${tapCls} after:w-[44px] ${
          open
            ? 'border-line/40 bg-veil/10 text-ink'
            : 'border-line/20 text-soft/80 hover:bg-veil/10 hover:text-ink'
        }`}
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute right-0 top-0 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-page"
          />
        )}
      </button>

      {/* The panel comes in from the bell (enter-panel in index.css): it grows
          out of the bell's own middle, wherever the nudge has left that along
          the panel's top edge. */}
      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label="Notifications"
          tabIndex={-1}
          style={{ right: -nudge, transformOrigin: `calc(100% - ${nudge}px - 1.25rem) 0` }}
          className="enter-panel absolute z-50 mt-3 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-line/15 bg-sunk shadow-2xl shadow-black/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-medical/60 dark:shadow-black/50"
        >
          <div className="flex items-center justify-between gap-3 border-b border-line/10 px-4 py-3.5">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
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
          ) : rows.length > 0 ? (
            <ul className="max-h-[min(24rem,60vh)] divide-y divide-line/5 overflow-y-auto">
              {shown.map((n) => {
                const { line, detail } = describeNotification(n, names)
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => openOne(n)}
                      className="flex w-full items-start gap-2.5 px-4 py-3 text-left transition-colors duration-150 ease-out hover:bg-veil/5 active:bg-veil/10"
                    >
                      <span className="mt-1.5 w-2 shrink-0">{!n.read_at && <UnreadDot />}</span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block truncate text-sm ${
                            n.read_at ? 'text-soft/70' : 'font-semibold text-ink'
                          }`}
                        >
                          {line}
                          {detail && <span className="font-normal text-soft/55"> · {detail}</span>}
                        </span>
                        <span className="mt-0.5 block text-xs text-soft/40">{when(n.created_at)}</span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : listFailed ? null : (
            <p className="px-4 py-6 text-sm text-soft/60">
              Nothing here. You’ll be told when a task involves you.
            </p>
          )}

          {error && (
            <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3.5 ${listFailed ? '' : 'border-t border-line/10'}`}>
              <ErrorText>{error}</ErrorText>
              {feed.error && (
                <button type="button" disabled={feed.isFetching} onClick={() => feed.refetch()} className={linkBtnCls}>
                  Try again
                </button>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-line/10 px-4 py-3.5">
            <Link to="/portal/notifications" onClick={close} className={linkBtnCls}>
              See all{rows.length > SHOWN ? ` (${rows.length})` : ''} &rarr;
            </Link>
            {rows.length > 0 && (
              // A text link until it is armed, then a small red pill. It is the
              // pill kind of button all along, with a pill's padding unseen, so
              // the armed one keeps the same 44px for a finger.
              <ConfirmButton
                className={`${linkBtnCls} -mr-2.5 rounded-full px-2.5 py-0.5`}
                label="Clear all"
                busyLabel="Clearing…"
                busy={clear.isPending}
                onConfirm={() => clear.mutate()}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
