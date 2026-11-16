import { useEffect, useMemo, useRef } from 'react'
import { LEAVE_MS, markTile } from './examFlow.js'

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
// It also says when the taker left the page and came back (`onLeft`): the page
// stopped being the one in front, through another app, tab or window, for a
// second or more. The sitting counts those times (useLeaves). And it asks the
// phone to keep its screen on, so a taker who reads a long question without
// touching the screen is not locked out of the page and counted as gone.
//
//   mark    the words to print across the paper (markWords in examFlow.js)
//   onLeft  called each time the taker comes back from leaving the page

// Keys held to take a screenshot. Pressing one must not show the paper again.
const QUIET_KEYS = new Set(['PrintScreen', 'Meta', 'OS', 'Shift', 'Control', 'Alt'])

const stop = (event) => event.preventDefault()

export default function ExamGuard({ mark = '', onLeft, children }) {
  const root = useRef(null)
  const tile = useMemo(() => markTile(mark), [mark])
  const tell = useRef(onLeft)
  tell.current = onLeft

  // The screen stays on while the paper is. The phone drops the request each
  // time the page is hidden, so it is made again on every return.
  useEffect(() => {
    let lock = null
    let over = false
    const ask = async () => {
      if (over || document.visibilityState !== 'visible' || !navigator.wakeLock) return
      try {
        const got = await navigator.wakeLock.request('screen')
        if (over) got.release().catch(() => {})
        else lock = got
      } catch {
        // Refused (a low battery, an old phone): the screen dims as it always did.
      }
    }
    ask()
    document.addEventListener('visibilitychange', ask)
    return () => {
      over = true
      document.removeEventListener('visibilitychange', ask)
      lock?.release().catch(() => {})
    }
  }, [])

  useEffect(() => {
    // Set on the element itself, not through React: the blur has to be on
    // screen before the phone draws the page's picture for its app switcher.
    const set = (away) => root.current?.toggleAttribute('data-away', away)
    const hide = () => set(true)
    // When the page stopped being the one in front, on both clocks: the one
    // that only runs forwards can stand still while a phone sleeps.
    let since = null
    const leave = () => {
      if (since === null) since = { run: performance.now(), wall: Date.now() }
      hide()
    }
    const show = () => {
      set(false)
      if (since === null) return
      const gone = Math.max(performance.now() - since.run, Date.now() - since.wall)
      since = null
      if (gone >= LEAVE_MS) tell.current?.()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') leave()
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
    window.addEventListener('blur', leave)
    window.addEventListener('focus', show)
    window.addEventListener('pageshow', show)
    window.addEventListener('pointerdown', show, true)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('blur', leave)
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
