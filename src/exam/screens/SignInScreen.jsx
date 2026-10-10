import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { signInWithGoogle } from '../examApi.js'
import { inAppBrowser } from '../examFlow.js'
import { ExamCard, GoogleButton, Problem, tapLinkCls } from '../examUi.jsx'

// No session: the sign-in card. Google only, and back to /exam/callback,
// which returns the taker to this address (examApi.js remembers the word).
// `problem` is a sentence to show from the start, such as a session the
// database did not accept.
export default function SignInScreen({ word, problem = '' }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // A link opened from inside Facebook, Messenger or Instagram: Google will
  // answer the button with an error page of its own, so the way out is said here.
  const [inApp] = useState(() => typeof navigator !== 'undefined' && inAppBrowser(navigator.userAgent))

  // A taker who comes back from Google with the back button gets this page
  // as it was left, with the button still saying it is on its way.
  useEffect(() => {
    const back = (event) => {
      if (event.persisted) setBusy(false)
    }
    window.addEventListener('pageshow', back)
    return () => window.removeEventListener('pageshow', back)
  }, [])

  const google = async () => {
    setBusy(true)
    setError('')
    try {
      await signInWithGoogle(word)
      // The browser is now leaving for Google; nothing else to do.
    } catch (e) {
      setError(e?.message || 'Google sign-in failed. Try again.')
      setBusy(false)
    }
  }

  return (
    <ExamCard eyebrow="AUSSS" title="Exchange exam" subtitle="Sign in with the Google account you will use on the day.">
      <GoogleButton busy={busy} onClick={google} />
      {inApp && (
        <p className="mt-3 text-center text-xs text-soft/70">
          If Google will not open, open this page in Chrome or Safari.
        </p>
      )}
      <Problem>{error || problem}</Problem>
      <p className="mt-4 text-center">
        <Link to="/privacy" className={tapLinkCls}>
          Privacy
        </Link>
      </p>
    </ExamCard>
  )
}
