import { useCallback, useEffect, useRef, useState } from 'react'
import { examPreferences, examSavePreferences } from '../examApi.js'
import { hasChoice, sectionName } from '../examFlow.js'
import { ExamCard, Problem, Waiting, focusCls, tapLinkCls, tapOutlineCls, tapPrimaryCls } from '../examUi.jsx'
import {
  CLASS_LIMIT,
  canChoose,
  chosenIn,
  classCount,
  classGroups,
  classRule,
  keptPicks,
  movePick,
  offeredProgrammes,
  ordinal,
  pickNote,
  placesWords,
  preferencesProblem,
  rankOf,
  tidyContracts,
  togglePick,
} from '../preferences.js'
import SectionChoice from './SectionChoice.jsx'

// The contracts a student would like, chosen after their details and before
// the start code (rpc/exam_preferences reads them, rpc/exam_save_preferences
// saves them). In each programme: up to two of Class A, up to two of Class B
// and any number of Class C, in the student's order. In an exam with two
// optional sections the student first ticks the sections they will answer,
// and is offered the contracts of those programmes only; their paper then
// sits those sections.
//
// The rules are the database's, and its refusals are shown in its own words.
// preferences.js repeats them so that a tap answers at once: a third contract
// of Class A is not taken, and the row says why.
//
//   exam         the door's exam
//   preferences  the door's { saved, complete, scope, score, picks }
//   onSaved      called with the database's answer, the new `preferences`
//   onCancel     set when there is a start card to go back to
export default function PreferencesScreen({ word, exam, preferences, notice = '', onSaved, onCancel, onSignOut }) {
  const choice = hasChoice(exam)
  // What rpc/exam_preferences said: { status: 'reading' }, { status: 'read' }
  // or { status: 'failed', message }.
  const [reading, setReading] = useState({ status: 'reading' })
  const [contracts, setContracts] = useState([])
  const [picks, setPicks] = useState([])
  const [sits, setSits] = useState({ scope: false, score: false })
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  // What a screen reader is told after a tap.
  const [said, setSaid] = useState('')
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  // Reads the contracts and what the student saved. `keep` holds on to what is
  // on the screen (after a save the database refused because the list changed
  // under it): the picks that still stand stay, and the saved ones are not
  // put back over them.
  const read = useCallback(
    async ({ keep = false } = {}) => {
      if (!keep) setReading({ status: 'reading' })
      try {
        const data = await examPreferences(word)
        if (!alive.current) return
        setContracts(tidyContracts(data?.contracts))
        if (!keep) {
          setPicks(Array.isArray(data?.picks) ? data.picks : [])
          setSits({ scope: data?.scope === true, score: data?.score === true })
        }
        setReading({ status: 'read' })
      } catch (error) {
        if (!alive.current) return
        if (!keep) setReading({ status: 'failed', message: error?.message || 'The contracts could not be read. Try again.' })
      }
    },
    [word],
  )
  useEffect(() => {
    read()
  }, [read])

  const offered = offeredProgrammes(contracts, sits, choice)
  // Only the picks that can stand are shown and sent: a contract that has left
  // the list, or one of a section that is no longer ticked, is not among them.
  // The others are kept meanwhile, so ticking a section back brings its
  // contracts back as they were.
  const standing = keptPicks(contracts, picks, offered)

  const tap = (id) => {
    const next = togglePick(contracts, standing, id)
    // What was chosen in a section that is not ticked just now stays behind it.
    setPicks([...next, ...picks.filter((other) => !standing.includes(other) && !next.includes(other))])
    setSaid(pickNote(contracts, next, id))
    setProblem('')
  }
  const move = (id, step) => {
    const next = movePick(contracts, standing, id, step)
    setPicks([...next, ...picks.filter((other) => !standing.includes(other))])
    setSaid(pickNote(contracts, next, id))
  }

  const save = async (e) => {
    e.preventDefault()
    if (busy) return
    const wrong = preferencesProblem({ contracts, picks: standing, sits, choice })
    if (wrong) {
      setProblem(wrong)
      return
    }
    setBusy(true)
    setProblem('')
    try {
      onSaved(await examSavePreferences(word, standing, choice ? sits : null))
    } catch (error) {
      if (!alive.current) return
      setProblem(error?.message || 'Your preferences could not be saved. Try again.')
      // A refusal usually means the list changed since it was read: read it
      // again behind what is on the screen.
      if (error?.kind === 'refused') read({ keep: true })
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  // Saved once, and the exam now asks for more: the officers changed the list.
  const changed = preferences?.saved === true && preferences?.complete !== true

  return (
    <ExamCard
      title="Your contract preferences"
      subtitle="Choose the contracts you would like, in the order you want them. You can change them until you start the exam."
    >
      {reading.status === 'reading' && (
        <div className="mt-8">
          <Waiting>Reading the contracts…</Waiting>
        </div>
      )}

      {reading.status === 'failed' && (
        <div className="mt-6 text-center">
          <Problem>{reading.message}</Problem>
          <button type="button" onClick={() => read()} className={`${tapOutlineCls} mt-4`}>
            Try again
          </button>
        </div>
      )}

      {reading.status === 'read' && (
        <form onSubmit={save} noValidate className="mt-6">
          {changed && (
            <p className="mb-5 rounded-xl border border-amber-400/50 p-3 text-sm text-warn">
              The list of contracts has changed since you saved. Check your choices and save again.
            </p>
          )}

          {choice && (
            <SectionChoice
              exam={exam}
              sits={sits}
              disabled={busy}
              means="Choose one section or both. You choose contracts for the sections you tick, and your exam will have those sections."
              onChange={(next) => {
                setSits(next)
                setProblem('')
              }}
            />
          )}

          <p role="status" className="sr-only">
            {said}
          </p>

          {choice && offered.length === 0 && !(sits.scope || sits.score) && (
            <p className="text-sm text-soft/70">Tick a section to see its contracts.</p>
          )}

          {offered.map((programme) => (
            <section key={programme} className="mt-6 border-t border-line/10 pt-5 first:mt-0 first:border-t-0 first:pt-0">
              <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">{sectionName(programme)}</h2>
              {classGroups(contracts, programme).map((group) => {
                const chosen = chosenIn(contracts, standing, programme, group.class)
                const full = chosen >= CLASS_LIMIT[group.class]
                const ruleId = `exam-contracts-${programme}-${group.class}`
                return (
                  <fieldset key={group.class} className="mt-4 min-w-0">
                    <legend className="flex w-full items-baseline justify-between gap-3">
                      <span className="text-sm font-semibold text-ink">Class {group.class}</span>
                      <span className="text-xs tabular-nums text-soft/70">{classCount(group.class, chosen)}</span>
                    </legend>
                    <p id={ruleId} className="mt-1 text-sm text-soft/70">
                      {full && CLASS_LIMIT[group.class] !== Infinity
                        ? 'You have chosen two. Take one out to choose another.'
                        : classRule(group.class)}
                    </p>
                    <ul className="mt-3 space-y-2">
                      {group.contracts.map((contract) => {
                        const rank = rankOf(contracts, standing, contract.id)
                        const on = rank > 0
                        const off = !on && !canChoose(contracts, standing, contract.id)
                        return (
                          <li
                            key={contract.id}
                            className={`flex items-stretch rounded-xl border ${
                              on ? 'border-accent bg-accent/10 ring-1 ring-accent' : 'border-line/15 bg-card'
                            } ${off ? 'opacity-55' : ''}`}
                          >
                            <button
                              type="button"
                              aria-pressed={on}
                              aria-disabled={off || undefined}
                              aria-describedby={ruleId}
                              disabled={busy}
                              onClick={() => {
                                // A row that cannot be added stays tappable for a
                                // screen reader to land on; the tap changes nothing.
                                if (!off) tap(contract.id)
                              }}
                              className={`flex min-h-[48px] min-w-0 flex-1 items-start gap-3 rounded-xl px-3 py-3 text-left [&:not(:disabled)]:active:bg-veil/10 ${focusCls}`}
                            >
                              <span
                                aria-hidden="true"
                                className={`mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold tabular-nums ${
                                  on ? 'border-cta bg-cta text-on-cta' : 'border-soft/60'
                                }`}
                              >
                                {on ? rank : ''}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block text-base font-medium leading-snug text-ink [overflow-wrap:anywhere]">
                                  {contract.country}
                                </span>
                                <span className="mt-0.5 block text-sm text-soft/70 [overflow-wrap:anywhere]">
                                  {placesWords(contract)}
                                  {contract.note && ` · ${contract.note}`}
                                </span>
                                {on && <span className="sr-only">, your {ordinal(rank)} choice</span>}
                              </span>
                            </button>
                            {on && chosen > 1 && (
                              <span className="flex shrink-0 items-center pr-1">
                                <MoveButton
                                  up
                                  label={`Move ${contract.country} up`}
                                  disabled={busy || rank === 1}
                                  onClick={() => move(contract.id, -1)}
                                />
                                <MoveButton
                                  label={`Move ${contract.country} down`}
                                  disabled={busy || rank === chosen}
                                  onClick={() => move(contract.id, 1)}
                                />
                              </span>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  </fieldset>
                )
              })}
            </section>
          ))}

          <Problem>{problem || notice}</Problem>

          <button type="submit" disabled={busy} className={`${tapPrimaryCls} mt-6 w-full`}>
            {busy ? 'Saving…' : 'Save my preferences'}
          </button>
        </form>
      )}

      <p className="mt-2 flex flex-wrap items-center justify-center gap-x-4">
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={busy} className={tapLinkCls}>
            Cancel
          </button>
        )}
        <button type="button" onClick={onSignOut} disabled={busy} className={tapLinkCls}>
          Not you? Sign out
        </button>
      </p>
    </ExamCard>
  )
}

// An arrow that moves a chosen contract one place, 44px square for a thumb.
function MoveButton({ up = false, label, disabled, onClick }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-11 w-10 items-center justify-center rounded-lg text-accent disabled:opacity-30 [&:not(:disabled)]:active:bg-veil/10 ${focusCls}`}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={up ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} />
      </svg>
    </button>
  )
}
