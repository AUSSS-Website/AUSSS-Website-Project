import { useEffect, useRef, useState } from 'react'
import usePageTitle from '../../../hooks/usePageTitle.js'
import { errorText } from '../../../lib/errorText.js'
import { useDecideVerification, usePendingVerifications } from '../../queries.js'
import {
  ConfirmButton,
  ErrorText,
  PageHeader,
  PageLoading,
  Panel,
  StatusBadge,
  outlineBtnCls,
  primaryBtnCls,
} from '../../portalUi.jsx'
import { when } from '../../workUi.jsx'
import { MEMBERSHIP_LABELS } from '../../constants.js'
import ExportButtons from '../../ExportButtons.jsx'

// /portal/admin/verification (EB only, gated by RequireEB). Approve sets the
// member active; decline leaves them unverified. Both go through the
// decide_verification RPC so the request and the profile change together.
//
// Neither can be taken back from this page, so Decline, which sits beside
// Approve, asks for a second click. A decided request stays where it was for
// the rest of the visit, with what happened written where its buttons were.
// Said above the list, it would be out of sight for every row but the first
// few; and a row that left the list would take the keyboard's place with it.

// On a touch screen the two buttons are at least a thumb tall; with a mouse
// they keep the portal's small pill.
const tapCls = '[@media(pointer:coarse)]:min-h-[44px]'

// Oldest first, the order the queue is fetched in.
const byRequested = (a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0)

// What a row says once its request has been decided.
function outcome(req, decision, byOther = false) {
  const name = req.profile?.full_name || req.profile?.email
  if (byOther) return `Someone else had already ${decision} ${name ? `${name}’s` : 'that'} request.`
  return decision === 'approved'
    ? `Approved. ${name || 'They'} ${name ? 'is' : 'are'} now an active member.`
    : `Declined. ${name ? `${name}’s` : 'Their'} membership status has not changed.`
}

// 'approved' or 'declined' when the database refused because the request was
// decided in the meantime (by another board member, or in another tab), else
// ''. Its own words for that hold the request's id and are not for the page.
function decidedElsewhere(err) {
  if (err?.code !== '22023') return ''
  return /\bis already (approved|declined)\b/.exec(err.message || '')?.[1] || ''
}

// Each row decides for itself, with a write of its own: its buttons are busy
// while it saves and the other rows stay as they are. `done` is how the
// request was decided on this visit ({ decision, byOther }), once it has been.
// `lastPressed` is the page's note of the row whose button was pressed last.
function Row({ req, done, lastPressed, onDecided }) {
  const p = req.profile || {}
  const decide = useDecideVerification()
  const [error, setError] = useState('')
  const sending = decide.isPending ? decide.variables?.decision : ''
  // The buttons go once the request is decided. If the keyboard was on one of
  // them it is now nowhere, and the next Tab would start from the top of the
  // page: put it on the sentence that took their place. Only the row pressed
  // last does this, and only while the keyboard is nowhere, so a person who
  // has gone on to another row while this one was saving is left where they
  // are.
  const said = useRef(null)
  useEffect(() => {
    if (!done || lastPressed.current !== req.id) return
    const active = document.activeElement
    if (!active || active === document.body) said.current?.focus({ preventScroll: true })
  }, [done, lastPressed, req.id])

  const run = async (decision) => {
    lastPressed.current = req.id
    setError('')
    try {
      await decide.mutateAsync({
        request_id: req.id,
        decision,
        new_status: decision === 'approved' ? 'active' : undefined,
      })
      onDecided(req, decision)
    } catch (err) {
      const already = decidedElsewhere(err)
      if (already) onDecided(req, already, true)
      else setError(errorText(err, 'We couldn’t save that decision.'))
    }
  }

  return (
    <li className="rounded-2xl border border-line/10 bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-ink">
            {p.full_name || 'No name yet'}
          </p>
          <p className="truncate text-sm text-soft/70">{p.email || req.profile_id}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-soft/50">
            {/* Approving makes the member active, so the badge says so at once. */}
            <StatusBadge status={done?.decision === 'approved' ? 'active' : p.membership_status || 'unverified'} />
            <span>Requested {when(req.created_at)}</span>
          </div>
          {req.message && (
            <blockquote className="mt-3 border-l-2 border-line/15 pl-4 text-sm text-soft/70">
              {req.message}
            </blockquote>
          )}
        </div>
        {/* Decline is as wide as its "Click again" wording from the start, so
            nothing moves when it asks. Where a narrow phone has no room for
            the pair on one line, each button takes a line of its own, edge to
            edge (`grow` does nothing while they fit side by side). */}
        {!done && (
          <div className="flex flex-wrap items-center gap-2">
            <ConfirmButton
              label="Decline"
              busyLabel="Declining…"
              busy={sending === 'declined'}
              disabled={Boolean(sending)}
              className={`${outlineBtnCls} ${tapCls} grow`}
              keepWidth
              onConfirm={() => run('declined')}
            />
            <button
              type="button"
              disabled={Boolean(sending)}
              onClick={() => run('approved')}
              // The ! is needed: without it the pill's own, larger padding wins
              // and Approve stands taller than Decline beside it. The unseen
              // border stands in for Decline's hairline, for the same reason.
              // min-w holds the longer "Approving…", so Decline never shifts.
              className={`${primaryBtnCls} ${tapCls} min-w-[7.5rem] grow border border-transparent !px-5 !py-1.5 text-xs`}
            >
              {sending === 'approved' ? 'Approving…' : 'Approve'}
            </button>
          </div>
        )}
        {/* What happened, where the buttons were. Always in the row, so a
            screen reader hears the sentence when it comes; out of sight until
            there is one. */}
        <p
          ref={said}
          role="status"
          tabIndex={-1}
          className={done ? 'max-w-xs text-sm text-soft/75 focus:outline-none' : 'sr-only'}
        >
          {done ? outcome(req, done.decision, done.byOther) : ''}
        </p>
      </div>
      {error && (
        <div className="mt-3">
          <ErrorText>{error}</ErrorText>
        </div>
      )}
    </li>
  )
}

const REQUEST_COLUMNS = [
  { label: 'Name', value: (r) => r.profile?.full_name || '' },
  { label: 'Email', value: (r) => r.profile?.email || '' },
  { label: 'Status', value: (r) => MEMBERSHIP_LABELS[r.profile?.membership_status] || r.profile?.membership_status || '' },
  { label: 'Requested', value: (r) => when(r.created_at) },
  { label: 'Message', value: (r) => r.message || '' },
]

export default function VerificationQueuePage() {
  usePageTitle('Verification queue')
  const pending = usePendingVerifications(true)
  // The requests decided on this visit, by id, each with its row as it was.
  // The list is fetched again a moment after a decision and no longer holds
  // them; the page goes on showing them where they stood, without their
  // buttons.
  const [decided, setDecided] = useState(() => new Map())
  // The id of the request whose Approve or Decline was pressed last (see Row).
  const lastPressed = useRef(null)
  const waiting = (pending.data || []).filter((req) => !decided.has(req.id))
  const rows = [...waiting, ...[...decided.values()].map((d) => d.req)].sort(byRequested)

  const onDecided = (req, decision, byOther = false) => {
    setDecided((prev) => new Map(prev).set(req.id, { req, decision, byOther }))
    // Decided elsewhere, the list here is out of date: other rows may be too.
    if (byOther) pending.refetch()
  }

  return (
    <>
      <PageHeader
        eyebrow="Executive Board"
        title="Verification queue"
        subtitle="People who signed in but aren’t on the roster. Approve makes them an active member."
        action={
          <ExportButtons
            title="Verification queue"
            subtitle="Members waiting for the Executive Board to confirm them."
            filename="ausss-verification-queue"
            columns={REQUEST_COLUMNS}
            rows={waiting}
          />
        }
      />

      {pending.isPending ? (
        <PageLoading />
      ) : pending.error && !pending.data ? (
        // Only when there is no list to show. A list that could not be fetched
        // again stays up, and with it what was decided on this visit.
        <Panel>
          <ErrorText>{errorText(pending.error, 'We couldn’t load the queue.')}</ErrorText>
        </Panel>
      ) : (
        <>
          {rows.length > 0 && (
            <ul className="space-y-4">
              {rows.map((req) => (
                <Row
                  key={req.id}
                  req={req}
                  done={decided.get(req.id)}
                  lastPressed={lastPressed}
                  onDecided={onDecided}
                />
              ))}
            </ul>
          )}
          {waiting.length === 0 && (
            <Panel className={rows.length > 0 ? 'mt-4' : ''}>
              <p className="text-sm text-soft/70">Nothing waiting. Nice.</p>
            </Panel>
          )}
        </>
      )}
    </>
  )
}
