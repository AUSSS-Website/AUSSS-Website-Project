import { useEffect, useMemo, useRef } from 'react'
import { markTile } from './examFlow.js'

// What stands between the paper and a screenshot of it. A web page cannot
// stop the phone from taking one (the phone does that, and tells the page
// nothing), and it cannot see a second phone's camera. So the guard does what
// a page can:
//   - the taker's student ID and email are printed faintly across the paper,
//     so any picture of it says whose it was;
//   - the paper is blurred whenever this page is not the one in front (another
//     app or window, the app switcher, a snipping tool, a screen recorder's
//     window), and after the Print Screen key, which also has what it copied
//     written over;
//   - nothing on the paper can be selected, copied, dragged out, saved by a
//     long press, or printed.
//
// It must never cost a taker their exam. The blur takes no taps away: the
// first touch or key shows the paper again, and that same tap still does what
// it was aimed at. The clock and the save state are outside the guard and
// stay readable throughout.
//
//   mark  the words to print across the paper (markWords in examFlow.js)

// Keys held to take a screenshot. Pressing one must not show the paper again.
const QUIET_KEYS = new Set(['PrintScreen', 'Meta', 'OS', 'Shift', 'Control', 'Alt'])

const stop = (event) => event.preventDefault()

export default function ExamGuard({ mark = '', children }) {
  const root = useRef(null)
  const tile = useMemo(() => markTile(mark), [mark])

  useEffect(() => {
    // Set on the element itself, not through React: the blur has to be on
    // screen before the phone draws the page's picture for its app switcher.
    const set = (away) => root.current?.toggleAttribute('data-away', away)
    const hide = () => set(true)
    const show = () => set(false)
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') hide()
      else if (document.hasFocus()) show()
    }
    const onKeyDown = (event) => {
      // Print and "Save page as".
      if ((event.ctrlKey || event.metaKey) && ['p', 's'].includes(String(event.key).toLowerCase())) {
        event.preventDefault()
        return
      }
      if (!QUIET_KEYS.has(event.key)) show()
    }
    const onKeyUp = (event) => {
      if (event.key !== 'PrintScreen') return
      hide()
      // The key has already copied the screen: write over it.
      try {
        navigator.clipboard?.writeText('Screenshots of the exam are not allowed.')?.catch(() => {})
      } catch {
        // No clipboard to write to.
      }
    }
    window.addEventListener('blur', hide)
    window.addEventListener('focus', show)
    window.addEventListener('pageshow', show)
    window.addEventListener('pointerdown', show, true)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('blur', hide)
      window.removeEventListener('focus', show)
      window.removeEventListener('pageshow', show)
      window.removeEventListener('pointerdown', show, true)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return (
    <>
      <div
        ref={root}
        onCopy={stop}
        onCut={stop}
        onContextMenu={stop}
        onDragStart={stop}
        className="group select-none [-webkit-touch-callout:none] print:hidden"
      >
        <div className="group-data-[away]:blur-xl">{children}</div>
        {/* Over the questions and under the bar with the clock (z-20). */}
        {tile && (
          <div
            aria-hidden="true"
            data-exam-mark=""
            className="pointer-events-none fixed inset-0 z-10"
            style={{ backgroundImage: tile }}
          />
        )}
        {/* Not read out: a screen reader still has the paper itself. */}
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-10 hidden items-center justify-center px-6 group-data-[away]:flex">
          <p className="max-w-sm rounded-2xl border border-line/15 bg-card px-5 py-4 text-center text-sm font-semibold text-ink shadow-lg">
            Your paper is hidden while this page is not in front. Tap anywhere to carry on. The clock is still running.
          </p>
        </div>
      </div>
      <p className="hidden text-center text-sm font-semibold print:block">The exam cannot be printed.</p>
    </>
  )
}
