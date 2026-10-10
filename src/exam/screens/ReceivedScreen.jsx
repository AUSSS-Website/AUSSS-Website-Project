import { receivedWords } from '../examFlow.js'
import { ExamCard, Problem, tapOutlineCls } from '../examUi.jsx'

// The end of a taker's exam: handed in, or the clock ran out. Nothing else is
// shown on purpose: no grade, no answers, no link.
//   why     'handed_in' or 'time'
//   unsent  answers the clock beat before they reached the database; the
//           screen then says so, since "received" would not be true of them
export default function ReceivedScreen({ why, unsent = 0, notice = '', onSignOut }) {
  const words = receivedWords(why, unsent)
  return (
    <ExamCard title={words.title}>
      {words.note && <p className="mt-4 text-center text-sm font-semibold text-warn">{words.note}</p>}
      <p className="mt-4 text-center text-sm text-soft/80">You can close this page.</p>
      <Problem>{notice}</Problem>
      <button type="button" onClick={onSignOut} className={`${tapOutlineCls} mt-6 w-full`}>
        Sign out
      </button>
    </ExamCard>
  )
}
