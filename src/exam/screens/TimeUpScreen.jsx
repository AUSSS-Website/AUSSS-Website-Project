import { timeUpWords } from '../examFlow.js'
import { ExamCard, Waiting, tapOutlineCls } from '../examUi.jsx'

// The clock has reached zero on this phone. No more answers are taken; what
// was still waiting is being sent, and the database is asked whether the exam
// is over. It is not the end yet: the received screen follows when the
// database agrees, and the paper comes back if it says there is time left
// (the officers made the exam longer).
// `save` is the sitting's save state; `connected` is false while the database
// is not answering, with answers waiting or with none; `onRetry` asks it now.
export default function TimeUpScreen({ save, onPhone = true, connected = true, onRetry }) {
  return (
    <ExamCard title="Time is up.">
      <div className="mt-6" role="status">
        <Waiting>{timeUpWords(save, onPhone, connected)}</Waiting>
      </div>
      {(save.kind === 'offline' || !connected) && (
        <button type="button" onClick={onRetry} className={`${tapOutlineCls} mt-5 w-full`}>
          Try again now
        </button>
      )}
    </ExamCard>
  )
}
