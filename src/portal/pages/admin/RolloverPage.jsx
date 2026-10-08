import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import usePageTitle from '../../../hooks/usePageTitle.js'
import { useRollOverTerm, useRolloverPreview } from '../../rolloverQueries.js'
import {
  STORAGE_LIMIT_BYTES,
  STORAGE_WARN_BYTES,
  boardKept,
  formatBytes,
  formatDay,
  termProblem,
  workAccountState,
} from '../../rollover.js'
import {
  Centered,
  ConfirmButton,
  ErrorText,
  Field,
  PageHeader,
  Panel,
  Spinner,
  inputCls,
  primaryBtnCls,
} from '../../portalUi.jsx'

// /portal/admin/rollover (EB only, gated by RequireEB). Moves the society into
// the next term in one step: the work accounts keep their positions, the
// roster's positions are offered again, open tasks move across, the ticked
// albums go to the gallery archive, and the term switches. Each panel says
// what will happen before the button at the end does it. The seats and
// secrets of HANDOVER section 6 are people's work and stay a checklist.

const STATE = {
  keeps: { text: 'Keeps it', cls: 'text-ok' },
  'first-sign-in': { text: 'From its first sign-in', cls: 'text-warn' },
  'no-email': { text: 'No work email: nobody holds it', cls: 'text-danger' },
}

function positionName(row) {
  return row.committee ? `${row.committee} ${row.title}` : row.title
}

export default function RolloverPage() {
  usePageTitle('New term')
  const preview = useRolloverPreview()
  const roll = useRollOverTerm()
  const [result, setResult] = useState(null)

  return (
    <>
      <PageHeader
        eyebrow="Executive Board"
        title="New term"
        subtitle="Move the society into the next term. Read each part, then press the button at the end."
      />
      {result ? (
        <Done result={result} />
      ) : preview.isPending ? (
        <Centered>
          <Spinner />
        </Centered>
      ) : preview.error ? (
        <Panel>
          <ErrorText>Couldn’t load what the new term would change: {preview.error.message}</ErrorText>
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

  const problem = termProblem({ label, startsOn, endsOn }, current)
  const name = label.trim() || 'the new term'
  const early = startsOn && new Date().toISOString().slice(0, 10) < startsOn

  const accounts = preview.work_accounts
  const board = boardKept(accounts)
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
          <ErrorText>{problem}</ErrorText>
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
          <ErrorText>
            Nobody on the board would keep their access. Set the board’s work emails, and sign in once
            with one of those accounts, before starting the new term.
          </ErrorText>
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
            <div className="mt-3 flex gap-4 text-xs">
              <button
                type="button"
                onClick={() => setArchive(new Set(albums.map((a) => a.id)))}
                className="font-semibold text-accent hover:text-ink"
              >
                Tick all
              </button>
              <button
                type="button"
                onClick={() => setArchive(new Set())}
                className="font-semibold text-accent hover:text-ink"
              >
                Untick all
              </button>
            </div>
            <ul className="mt-3 space-y-2">
              {albums.map((a) => (
                <li key={a.id}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-line/10 bg-sunk px-4 py-3">
                    <input type="checkbox" checked={archive.has(a.id)} onChange={() => toggle(a.id)} />
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{a.title}</span>
                    <span className="shrink-0 text-xs text-soft/55">
                      {a.photos} {a.photos === 1 ? 'photo' : 'photos'}
                      {!a.published && ' · unpublished'}
                    </span>
                  </label>
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

      <Panel title="6. Switch">
        <p className="mt-4 text-sm text-soft/75">
          Everything above happens at once, and {name} becomes the current term. Offers of positions in{' '}
          {current.label} that nobody took up are withdrawn. The public pages are rebuilt within a few
          minutes. The seats and secrets of the handover (HANDOVER section 6) stay a checklist for
          the President and the webmasters.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-4">
          <ConfirmButton
            label={`Start ${name}`}
            confirmLabel={`Click again to start ${name} now`}
            busyLabel="Switching…"
            busy={busy}
            disabled={Boolean(problem) || !board}
            className={primaryBtnCls}
            onConfirm={() =>
              onStart({ label: label.trim(), startsOn, endsOn, archiveAlbums: [...archive] })
            }
          />
        </div>
        {error && <ErrorText>{error.message}</ErrorText>}
      </Panel>
    </div>
  )
}

function Done({ result }) {
  const rows = [
    [`${result.work_accounts} work ${result.work_accounts === 1 ? 'account keeps its' : 'accounts keep their'} position`],
    result.work_accounts_waiting > 0 && [
      `${result.work_accounts_waiting} ${result.work_accounts_waiting === 1 ? 'position waits' : 'positions wait'} for the work account’s first sign-in`,
    ],
    [`${result.roster_offers_made} ${result.roster_offers_made === 1 ? 'position' : 'positions'} from the roster given again`],
    [`${result.tasks_moved} open ${result.tasks_moved === 1 ? 'task' : 'tasks'} moved across`],
    [`${result.albums_archived} ${result.albums_archived === 1 ? 'album' : 'albums'} moved to the gallery archive`],
    [`${result.assignments_ended} ${result.assignments_ended === 1 ? 'position' : 'positions'} of ${result.from} ended`],
  ].filter(Boolean)

  return (
    <div className="max-w-3xl space-y-5">
      <Panel title="Done">
        <p className="mt-4 text-lg text-ink">{result.to} is the current term.</p>
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-soft/75">
          {rows.map(([text]) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-soft/75">
          Next: the seats and secrets of the handover, HANDOVER section 6. The public pages show the new term
          within a few minutes.
        </p>
        <div className="mt-5 flex flex-wrap gap-4 text-sm">
          <Link to="/portal" className="font-semibold text-accent hover:text-ink">
            Back to the dashboard
          </Link>
          <a href="/gallery/archive" className="font-semibold text-accent hover:text-ink">
            See the gallery archive
          </a>
        </div>
      </Panel>
    </div>
  )
}
