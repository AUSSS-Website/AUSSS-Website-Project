import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import usePageTitle from '../../../hooks/usePageTitle.js'
import useLeaveWarning from '../../../hooks/useLeaveWarning.js'
import { UNREACHED, errorText } from '../../../lib/errorText.js'
import { useRollOverTerm, useRolloverPreview } from '../../rolloverQueries.js'
import {
  STORAGE_LIMIT_BYTES,
  STORAGE_WARN_BYTES,
  boardKept,
  examLoss,
  formatBytes,
  formatDay,
  startBlocker,
  termProblem,
  workAccountState,
} from '../../rollover.js'
import {
  CheckField,
  ConfirmButton,
  ErrorText,
  Field,
  PageHeader,
  PageLoading,
  Panel,
  inputCls,
  primaryBtnCls,
} from '../../portalUi.jsx'

// /portal/admin/rollover (EB only, gated by RequireEB). Moves the society into
// the next term in one step: the work accounts keep their positions, the
// roster's positions are offered again, open tasks move across, the ticked
// albums go to the gallery archive, the exam's registered IDs and papers are
// deleted (they are kept for one term), and the term switches. Each panel says
// what will happen before the button at the end does it. The seats and
// secrets of HANDOVER section 6 are people's work and stay a checklist.
//
// Nothing in the portal is harder to take back, so the button at the end is
// guarded twice: the new term's name has to be typed beside it first, and it
// then asks for a second click like every other button of its kind.

const STATE = {
  keeps: { text: 'Keeps it', cls: 'text-ok' },
  'first-sign-in': { text: 'From its first sign-in', cls: 'text-warn' },
  'no-email': { text: 'No work email: nobody holds it', cls: 'text-danger' },
}

// A small blue link or button that stands on its own, with a thumb's 44px to
// land on (in px: the root size shrinks on a 320px phone).
const textLinkCls =
  'inline-flex min-h-[44px] items-center font-semibold text-accent transition-colors hover:text-ink'

function positionName(row) {
  return row.committee ? `${row.committee} ${row.title}` : row.title
}

// The sentence for a switch that failed. The database does all of it or none
// of it, so a refusal changed nothing. A request that got no answer is the one
// case where nobody can tell: it may have gone through before the line dropped.
function startError(err) {
  const text = errorText(err, 'We couldn’t start the new term. Nothing was changed.')
  if (text !== UNREACHED) return text
  return 'We couldn’t reach the server, so we can’t tell whether the new term started. Reload the page to see which term is current before trying again.'
}

export default function RolloverPage() {
  usePageTitle('New term')
  const preview = useRolloverPreview()
  const roll = useRollOverTerm()
  const [result, setResult] = useState(null)
  // The switch finishes in the database whatever the tab does, but its summary
  // is only shown here: ask before the tab is closed or reloaded on the way.
  useLeaveWarning(roll.isPending)

  return (
    <>
      <PageHeader
        eyebrow={
          // The ::after gives the small link a thumb's 44px to land on without
          // moving the title under it (in px: the root size shrinks on a phone).
          <Link
            to="/portal/admin/settings"
            className="relative transition-colors after:absolute after:-inset-x-2 after:-inset-y-[15px] after:content-[''] hover:text-ink"
          >
            &larr; Site settings
          </Link>
        }
        title="New term"
        subtitle="Move the society into the next term. Read each part, then press the button at the end."
      />
      {result ? (
        <Done result={result} />
      ) : preview.isPending ? (
        <PageLoading />
      ) : preview.error && !preview.data ? (
        // Only when there is nothing to show. If the preview is up and could
        // not be fetched again (a connection that came and went), the form
        // stays, with what was typed and unticked in it; the database checks
        // everything again when the button is pressed.
        <Panel>
          <ErrorText>{errorText(preview.error, 'We couldn’t load what the new term would change.')}</ErrorText>
        </Panel>
      ) : (
        <Wizard
          preview={preview.data}
          busy={roll.isPending}
          error={roll.error}
          onStart={async (input) => {
            try {
              setResult(await roll.mutateAsync(input))
              window.scrollTo({ top: 0 })
            } catch {
              // roll.error is shown by the button
            }
          }}
        />
      )}
    </>
  )
}

function Wizard({ preview, busy, error, onStart }) {
  const current = preview.current
  const [label, setLabel] = useState(preview.next.label)
  const [startsOn, setStartsOn] = useState(preview.next.starts_on)
  const [endsOn, setEndsOn] = useState(preview.next.ends_on)
  const albums = preview.albums
  // Every album starts ticked. Only the first answer seeds the ticks, so a refetch
  // (the tab regaining focus) never undoes what the board unticked.
  const [archive, setArchive] = useState(() => new Set(albums.map((a) => a.id)))
  // The exams whose registered IDs and papers go with the term. None, and the
  // page has no exam panel (nor has it on a database from before the exam).
  const exams = preview.exams ?? []
  // The new term's name, typed a second time beside the button.
  const [typed, setTyped] = useState('')

  const problem = termProblem({ label, startsOn, endsOn }, current)
  const name = label.trim() || 'the new term'
  const early = startsOn && new Date().toISOString().slice(0, 10) < startsOn

  const accounts = preview.work_accounts
  const board = boardKept(accounts)
  // Why the button is off, in words. Empty when it can be pressed.
  const blocker = startBlocker({ problem, board, label, typed })
  const counts = useMemo(() => {
    const c = { keeps: 0, 'first-sign-in': 0, 'no-email': 0 }
    for (const row of accounts) c[workAccountState(row)] += 1
    return c
  }, [accounts])

  const toggle = (id) =>
    setArchive((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="max-w-3xl space-y-5">
      <Panel title="1. The new term">
        <p className="mt-4 text-sm text-soft/75">
          The current term is <strong className="text-ink">{current.label}</strong>, {formatDay(current.starts_on)}{' '}
          to {formatDay(current.ends_on)}.
        </p>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <Field label="Name" htmlFor="term-label">
            <input
              id="term-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className={inputCls}
              placeholder="2027-28"
            />
          </Field>
          <Field label="First day" htmlFor="term-start">
            <input
              id="term-start"
              type="date"
              value={startsOn}
              onChange={(e) => setStartsOn(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Last day" htmlFor="term-end">
            <input
              id="term-end"
              type="date"
              value={endsOn}
              onChange={(e) => setEndsOn(e.target.value)}
              className={inputCls}
            />
          </Field>
        </div>
        {problem ? (
          <div className="mt-3">
            <ErrorText>{problem}</ErrorText>
          </div>
        ) : (
          early && (
            <p className="mt-3 text-xs text-soft/60">
              {name} starts on {formatDay(startsOn)}. Switching before then is fine for an early handover: it
              happens the moment you press the button.
            </p>
          )
        )}
      </Panel>

      <Panel title="2. Officers and the board">
        <p className="mt-4 text-sm text-soft/75">
          Every position stays with its work account. Whoever takes a position over is handed that account;
          nobody is invited on a personal email. {counts.keeps} of {accounts.length} keep their position straight
          away
          {counts['first-sign-in'] > 0 && `, ${counts['first-sign-in']} from their first sign-in`}
          {counts['no-email'] > 0 &&
            `, and ${counts['no-email']} ${counts['no-email'] === 1 ? 'has' : 'have'} no work email yet`}
          .
        </p>
        <ul className="mt-4 divide-y divide-line/10 rounded-xl border border-line/10 bg-sunk">
          {accounts.map((row) => {
            const state = STATE[workAccountState(row)]
            return (
              <li
                key={row.position_id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5"
              >
                <span className="min-w-0">
                  <span className="block text-sm text-ink">{positionName(row)}</span>
                  <span className="block break-all text-xs text-soft/55">{row.email || 'No work email'}</span>
                </span>
                <span className={`text-xs font-semibold ${state.cls}`}>{state.text}</span>
              </li>
            )
          })}
        </ul>
        {!board && (
          <div className="mt-3">
            <ErrorText>
              Nobody on the board would keep their access. Set the board’s work emails, and sign in once
              with one of those accounts, before starting the new term.
            </ErrorText>
          </div>
        )}
        <p className="mt-3 text-xs text-soft/55">
          A work email is changed under “Work emails” on the{' '}
          <Link to="/portal/admin/roster" className="font-semibold text-accent hover:text-ink">
            Roster page
          </Link>
          . Change it before the switch and the new address is the one carried over.
        </p>
      </Panel>

      <Panel title="3. Members and assistants">
        <p className="mt-4 text-sm text-soft/75">
          The {preview.roster_positions} {preview.roster_positions === 1 ? 'position' : 'positions'} the roster
          lists below officer {preview.roster_positions === 1 ? 'is' : 'are'} given again for {name}.
        </p>
        {preview.ending.length === 0 ? (
          <p className="mt-2 text-sm text-soft/75">Nothing else ends.</p>
        ) : (
          <>
            <p className="mt-2 text-sm text-soft/75">
              These end with {current.label}, because the roster does not list them. Hand them out again in
              the committee’s Invites tab if they should continue.
            </p>
            <ul className="mt-3 space-y-1 text-sm text-ink">
              {preview.ending.map((row, i) => (
                <li key={i}>
                  {positionName(row)}: {row.name}
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>

      <Panel title="4. Tasks">
        <p className="mt-4 text-sm text-soft/75">
          {preview.open_tasks === 0
            ? 'No task is open, so nothing moves.'
            : `${preview.open_tasks} open ${preview.open_tasks === 1 ? 'task moves' : 'tasks move'} into ${name} as ${
                preview.open_tasks === 1 ? 'it is' : 'they are'
              }. Done tasks stay with ${current.label}.`}
        </p>
      </Panel>

      <Panel title="5. Gallery">
        <p className="mt-4 text-sm text-soft/75">
          Ticked albums move to the gallery archive, under {current.label}. Their links keep working, and an
          album can be moved back from the Gallery page. Untick any that should stay in the gallery.
        </p>
        {albums.length === 0 ? (
          <p className="mt-3 text-sm text-soft/60">The gallery has no albums to archive.</p>
        ) : (
          <>
            <div className="flex gap-5 text-xs">
              <button
                type="button"
                onClick={() => setArchive(new Set(albums.map((a) => a.id)))}
                className={textLinkCls}
              >
                Tick all
              </button>
              <button type="button" onClick={() => setArchive(new Set())} className={textLinkCls}>
                Untick all
              </button>
            </div>
            {/* The portal's own tick box: these ticks count only when the button
                at the end is pressed. The title wraps in full on a phone, with
                the number of photos under it. */}
            <ul className="space-y-2">
              {albums.map((a) => (
                <li key={a.id}>
                  <CheckField
                    checked={archive.has(a.id)}
                    onChange={() => toggle(a.id)}
                    label={a.title}
                    hint={`${a.photos} ${a.photos === 1 ? 'photo' : 'photos'}${a.published ? '' : ' · unpublished'}`}
                    className="rounded-xl border border-line/10 bg-sunk px-4"
                  />
                </li>
              ))}
            </ul>
          </>
        )}
        <p className={`mt-4 text-xs ${preview.storage_bytes >= STORAGE_WARN_BYTES ? 'text-warn' : 'text-soft/55'}`}>
          Storage used: {formatBytes(preview.storage_bytes)} of {formatBytes(STORAGE_LIMIT_BYTES)}.
          {preview.storage_bytes >= STORAGE_WARN_BYTES &&
            ' That is past 600 MB: ask the webmaster about shrinking the archived photos (roadmap, phase 7).'}
        </p>
      </Panel>

      {exams.length > 0 && (
        <Panel title="6. Exam">
          <p className="mt-4 text-sm text-soft/75">
            An exam’s registered IDs, papers and answers are kept for one term. They are deleted with{' '}
            {current.label} and cannot be brought back, so download the results you need first. The exam
            itself, its questions and their right answers stay, and so do the students’ accounts.
          </p>
          <ul className="mt-4 divide-y divide-line/10 rounded-xl border border-line/10 bg-sunk">
            {exams.map((exam) => {
              const loss = examLoss(exam)
              return (
                <li
                  key={exam.id}
                  className="flex flex-wrap items-center justify-between gap-x-4 px-4 py-1.5"
                >
                  <span className="min-w-0 py-1">
                    <span className="block text-sm text-ink">{exam.title}</span>
                    <span className="block text-xs text-soft/55">
                      {loss ? `${loss} will be deleted` : 'Nothing to delete'}
                    </span>
                  </span>
                  <Link
                    to={loss ? `/portal/exam/${exam.id}?tab=results` : `/portal/exam/${exam.id}`}
                    className={`${textLinkCls} text-xs`}
                  >
                    {loss ? 'Open its results' : 'Open the exam'}
                  </Link>
                </li>
              )
            })}
          </ul>
        </Panel>
      )}

      <Panel title={`${exams.length > 0 ? 7 : 6}. Switch`}>
        <p className="mt-4 text-sm text-soft/75">
          Everything above happens at once, and {name} becomes the current term. Offers of positions in{' '}
          {current.label} that nobody took up are withdrawn. The public pages are rebuilt within a few
          minutes. The seats and secrets of the handover (HANDOVER section 6) stay a checklist for
          the President and the webmasters.
        </p>
        {/* The name typed again: the one step a slip of the hand cannot take. */}
        <div className="mt-5 max-w-xs">
          <Field
            label={problem ? 'Type the new term’s name to confirm' : `Type ${label.trim()} to confirm`}
            htmlFor="term-confirm"
          >
            <input
              id="term-confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className={inputCls}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              aria-describedby="term-no-undo term-start-why"
            />
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <ConfirmButton
            label={`Start ${name}`}
            confirmLabel={`Click again to start ${name} now`}
            busyLabel="Switching…"
            busy={busy}
            disabled={Boolean(blocker)}
            className={primaryBtnCls}
            keepWidth
            onConfirm={() =>
              onStart({ label: label.trim(), startsOn, endsOn, archiveAlbums: [...archive] })
            }
          />
          <p id="term-no-undo" className="text-sm font-semibold text-warn">
            This cannot be undone.
          </p>
        </div>
        {/* Why the button is off. Always in the page, so a screen reader hears
            it change; out of sight when there is nothing to say. */}
        <p id="term-start-why" role="status" className={blocker ? 'mt-3 text-xs text-soft/70' : 'sr-only'}>
          {blocker}
        </p>
        {error && (
          <div className="mt-3">
            <ErrorText>{startError(error)}</ErrorText>
          </div>
        )}
      </Panel>
    </div>
  )
}

function Done({ result }) {
  // The button that was pressed went with the form, taking the keyboard's
  // place with it: put it on the outcome, which is also read out from there.
  const outcome = useRef(null)
  useEffect(() => {
    outcome.current?.focus({ preventScroll: true })
  }, [])
  const examIds = result.exam_registrations_deleted ?? 0
  const examPapers = result.exam_attempts_deleted ?? 0
  const rows = [
    [`${result.work_accounts} work ${result.work_accounts === 1 ? 'account keeps its' : 'accounts keep their'} position`],
    result.work_accounts_waiting > 0 && [
      `${result.work_accounts_waiting} ${result.work_accounts_waiting === 1 ? 'position waits' : 'positions wait'} for the work account’s first sign-in`,
    ],
    [`${result.roster_offers_made} ${result.roster_offers_made === 1 ? 'position' : 'positions'} from the roster given again`],
    [`${result.tasks_moved} open ${result.tasks_moved === 1 ? 'task' : 'tasks'} moved across`],
    [`${result.albums_archived} ${result.albums_archived === 1 ? 'album' : 'albums'} moved to the gallery archive`],
    (examIds > 0 || examPapers > 0) && [
      `${examIds} registered ${examIds === 1 ? 'ID' : 'IDs'} and ${examPapers} exam ${examPapers === 1 ? 'paper' : 'papers'} deleted`,
    ],
    [`${result.assignments_ended} ${result.assignments_ended === 1 ? 'position' : 'positions'} of ${result.from} ended`],
  ].filter(Boolean)

  return (
    <div className="max-w-3xl space-y-5">
      <Panel title="Done">
        <p ref={outcome} tabIndex={-1} className="mt-4 text-lg text-ink focus:outline-none">
          {result.to} is the current term.
        </p>
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-soft/75">
          {rows.map(([text]) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-soft/75">
          Next: the seats and secrets of the handover, HANDOVER section 6. The public pages show the new term
          within a few minutes.
        </p>
        <div className="mt-2 flex flex-wrap gap-x-5 text-sm">
          <Link to="/portal" className={textLinkCls}>
            Back to the dashboard
          </Link>
          <a href="/gallery/archive" className={textLinkCls}>
            See the gallery archive
          </a>
        </div>
      </Panel>
    </div>
  )
}
