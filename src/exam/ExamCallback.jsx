import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import usePageTitle from '../hooks/usePageTitle.js'
import { getSession, onAuthStateChange, takeWord } from './examApi.js'
import { callbackProblem } from './examFlow.js'
import ExamLayout from './ExamLayout.jsx'
import { ExamCard, Waiting, tapPrimaryCls } from './examUi.jsx'

// /exam/callback. Google sends the taker back here with the tokens in the
// address (as /portal/callback, src/portal/pages/CallbackPage.jsx);
// supabase-js has read them by the time this page shows, so it waits for the
// session and goes on to /exam/<the word remembered before leaving>. With no
// word remembered there is no exam to go back to, and it goes to the home page.

const TIMEOUT_MS = 8000

export default function ExamCallback() {
  usePageTitle('Signing you in')
  const navigate = useNavigate()
  const location = useLocation()
  // Supabase reports failures (denied consent, an expired link) as ?error= or
  // #error= depending on the path taken. Only that there was one is read:
  // the page says its own sentence, never the address's (callbackProblem).
  const [error] = useState(() => callbackProblem(location.search, location.hash))
  const [timedOut, setTimedOut] = useState(false)
  // The word to go back to. Reading it clears it (examApi.js), and StrictMode
  // runs the effect twice, so it is read once and kept.
  const taken = useRef(undefined)
  const [word, setWord] = useState(null)
  const done = useRef(false)

  useEffect(() => {
    if (taken.current === undefined) taken.current = takeWord()
    const back = taken.current
    setWord(back)
    if (error) return undefined
    // The session arrives a moment later; if the taker has left this page by
    // then (the back button, StrictMode's second run) it must not navigate.
    let alive = true
    const go = () => {
      if (!alive || done.current) return
      done.current = true
      navigate(back ? `/exam/${back}` : '/', { replace: true })
    }
    getSession().then(
      (session) => {
        if (session) go()
      },
      () => {},
    )
    const stop = onAuthStateChange((_event, session) => {
      if (session) go()
    })
    const timer = setTimeout(() => {
      if (!done.current) setTimedOut(true)
    }, TIMEOUT_MS)
    return () => {
      alive = false
      stop()
      clearTimeout(timer)
    }
  }, [error, navigate])

  if (error || timedOut) {
    return (
      <ExamLayout>
        <ExamCard
          title="We could not sign you in"
          subtitle={error || 'The sign-in did not finish. It may have been cancelled or left open too long.'}
        >
          {word ? (
            <Link to={`/exam/${word}`} replace className={`${tapPrimaryCls} mt-6 w-full`}>
              Try again
            </Link>
          ) : (
            <p className="mt-6 text-center text-sm text-soft/70">Open the link the exchange team sent you and sign in again.</p>
          )}
        </ExamCard>
      </ExamLayout>
    )
  }

  return (
    <ExamLayout>
      <ExamCard title="Signing you in…">
        <div className="mt-6">
          <Waiting />
        </div>
      </ExamCard>
    </ExamLayout>
  )
}
