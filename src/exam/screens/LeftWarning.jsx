import { useEffect, useRef } from 'react'
import { DOUBLE_TAP_MS, leaveWords } from '../examFlow.js'
import { tapPrimaryCls } from '../examUi.jsx'

// What a taker meets when they come back from leaving the page: the first
// time a warning, from the second on that it will be reported (leaveWords in
// examFlow.js). It stays until "I understand" is pressed, over the paper and
// under nothing; the clock above it keeps running and stays readable.
//
// The tap that brought the taker back must not also dismiss it: for a moment
// after it appears, or after the count goes up, the button takes no press.
//
//   count      how many times the taker has left the page
//   onDismiss  "I understand" was pressed
export default function LeftWarning({ count, onDismiss }) {
  const words = leaveWords(count)
  const button = useRef(null)
  const shownAt = useRef(0)
  useEffect(() => {
    shownAt.current = performance.now()
    button.current?.focus()
  }, [count])

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 px-4 print:hidden">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="exam-left-title"
        aria-describedby="exam-left-body"
        // The one button is the only stop, so Tab stays on it.
        onKeyDown={(event) => {
          if (event.key === 'Tab') event.preventDefault()
        }}
        className="w-full max-w-sm rounded-2xl border border-danger/40 bg-card p-5 shadow-xl"
      >
        <h2 id="exam-left-title" className="text-lg font-semibold text-danger">
          {words.title}
        </h2>
        <p id="exam-left-body" className="mt-2 text-sm leading-relaxed text-ink">
          {words.body}
        </p>
        <button
          ref={button}
          type="button"
          onClick={() => {
            if (performance.now() - shownAt.current >= DOUBLE_TAP_MS) onDismiss()
          }}
          className={`${tapPrimaryCls} mt-5 w-full`}
        >
          I understand
        </button>
      </div>
    </div>
  )
}
