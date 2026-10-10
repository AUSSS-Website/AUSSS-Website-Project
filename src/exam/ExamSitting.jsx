import { useEffect, useRef } from 'react'
import ExamLayout from './ExamLayout.jsx'
import { ExamCard, Waiting, tapOutlineCls } from './examUi.jsx'
import { useSitting } from './useSitting.js'
import ElsewhereScreen from './screens/ElsewhereScreen.jsx'
import ReceivedScreen from './screens/ReceivedScreen.jsx'
import SittingScreen from './screens/SittingScreen.jsx'
import TimeUpScreen from './screens/TimeUpScreen.jsx'

// A taker who has started. The door mounts this whenever the database lists
// their paper, running or over, or when the phone holds their paper.
// useSitting does the work; this picks the screen for where the sitting
// stands:
//   loading    the paper is on its way
//   sitting    the paper
//   ending     time is up on this phone, the database is being asked
//   over       received
//   gone       the database no longer knows this sitting: the door is told,
//              and asks again
//   elsewhere  the exam is open in another tab of this browser
//
//   title      the exam's title as the door knew it, until the paper says it
//   attemptId  the paper's id when the database has just said it (it made the
//              paper, or the door listed it), so a copy of another paper left
//              on the phone is not shown; null when the door did not ask
//   onGone     called once with the database's sentence
export default function ExamSitting({ word, userId, attemptId = null, title = '', notice = '', onGone, onSignOut }) {
  const sitting = useSitting({ word, userId, attemptId })
  const { status, problem } = sitting
  const name = sitting.exam?.title || title

  const told = useRef(false)
  useEffect(() => {
    if (status !== 'gone' || told.current) return
    told.current = true
    onGone(problem)
  }, [status, problem, onGone])

  if (status === 'sitting') return <SittingScreen sitting={sitting} title={name} />

  return (
    <ExamLayout title={name}>
      {status === 'over' ? (
        <ReceivedScreen why={sitting.why} unsent={sitting.unsent} notice={notice} onSignOut={onSignOut} />
      ) : status === 'ending' ? (
        <TimeUpScreen
          save={sitting.save}
          onPhone={sitting.onPhone}
          connected={sitting.connected}
          onRetry={sitting.retry}
        />
      ) : status === 'elsewhere' ? (
        <ElsewhereScreen onTakeOver={sitting.takeOver} />
      ) : sitting.connected ? (
        <Waiting>Getting your paper…</Waiting>
      ) : (
        // The paper has not come and the phone holds no copy of it.
        <ExamCard title="Getting your paper" subtitle="The exam could not be reached. Check your connection.">
          <div className="mt-6">
            <Waiting>This page keeps trying on its own.</Waiting>
          </div>
          <button type="button" onClick={sitting.retry} className={`${tapOutlineCls} mt-6 w-full`}>
            Try again now
          </button>
        </ExamCard>
      )}
    </ExamLayout>
  )
}
