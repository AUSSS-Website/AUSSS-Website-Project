import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { programmesOf } from '../../examStats.js'
import { chipBtnCls } from '../../workUi.jsx'
import { tapCls } from './ExamsPage.jsx'

// An exam with two optional sections has two rankings, one for each exchange
// programme: a paper's mark in a programme is the shared questions plus that
// programme's section, and only the papers that sit the section are ranked in
// it. The Results and the Overview show one programme at a time, and this is
// the switch between them.
//
// Which one is shown is in the address (?programme=score), so it stays when a
// paper is opened and closed, when the page is refreshed, and from Results to
// Overview. An exam without the choice has no switch and one ranking.

// [programme, setProgramme, programmes, total]: the programme shown (null in
// an exam without the choice), and the exam's programmes from the `sections`
// its results name.
//
// The Results also have a list of everyone who took the exam, whichever
// section they sit (?programme=total). A page that asks for it (`withTotal`)
// gets `total` true and no programme while it is shown; a page that does not
// (the Overview) shows its first programme at that address.
export const TOTAL = 'total'
export function useProgramme(sections, withTotal = false) {
  const [params, setParams] = useSearchParams()
  const programmes = useMemo(() => programmesOf(sections), [sections])
  const asked = params.get('programme')
  const total = withTotal && programmes.length > 0 && asked === TOTAL
  const programme = total ? null : programmes.find((p) => p.id === asked) || programmes[0] || null
  const setProgramme = useCallback(
    (id) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set('programme', id)
          return next
        },
        { replace: true },
      ),
    [setParams],
  )
  return [programme, setProgramme, programmes, total]
}

// `counts` is how many papers sit each programme, by its id. `total` adds the
// list of everyone after the programmes: true while it is the one shown, false
// while a programme is, and left out on a page that has no such list.
// `totalCount` is how many papers there are in all.
export default function ProgrammeSwitch({ programmes, programme, onChange, counts = null, total = null, totalCount = null }) {
  if (programmes.length === 0) return null
  return (
    <div className="mt-4">
      <div role="group" aria-label="Which programme’s ranking" className="flex flex-wrap items-center gap-2">
        {programmes.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={programme?.id === p.id}
            onClick={() => onChange(p.id)}
            className={`${chipBtnCls(programme?.id === p.id)} ${tapCls}`}
          >
            {p.name}
            {counts ? ` · ${counts[p.id] ?? 0}` : ''}
          </button>
        ))}
        {total !== null && (
          <button
            type="button"
            aria-pressed={total}
            onClick={() => onChange(TOTAL)}
            className={`${chipBtnCls(total)} ${tapCls}`}
          >
            Total
            {totalCount !== null ? ` · ${totalCount}` : ''}
          </button>
        )}
      </div>
      {total && (
        <p className="mt-2 text-xs text-soft/55">
          Everyone who took the exam, by every question their paper sits. A paper that sits both sections has more
          questions than one that sits one, so compare students in a programme’s own ranking.
        </p>
      )}
      {programme && (
        <p className="mt-2 text-xs text-soft/55">
          A {programme.short} mark is out of {programme.of}: the {programme.sharedOf} shared{' '}
          {programme.sharedOf === 1 ? 'question' : 'questions'} and the {programme.blockOf} of the{' '}
          {programme.block.toLowerCase()}. Only the papers that sit that section are ranked here.
        </p>
      )}
    </div>
  )
}
