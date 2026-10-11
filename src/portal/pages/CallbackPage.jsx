import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import usePageTitle from '../../hooks/usePageTitle.js'
import { supabase } from '../../lib/supabase.js'
import { SIGN_IN_PATH, takeNext } from '../constants.js'
import { AuthCard, Spinner, primaryBtnCls } from '../portalUi.jsx'

// /portal/callback. Both Google and the magic link land here with tokens in
// the URL hash (implicit flow); supabase-js already consumed them when the
// client was created, so we just wait for the session to appear and go. When
// none appears, the card says why in a sentence of its own and offers the
// sign-in page again.

const TIMEOUT_MS = 8000

const LINK_FAILED = 'The sign-in link didn’t complete. It may have expired or already been used.'

// Supabase reports failures (expired link, denied consent) as ?error= or
// #error= depending on the path taken, with a code and a description beside
// it. Only that there was one, and of which kind, is read: the page says its
// own sentence and never the address's, since anyone can write an address and
// its words would be read as ours (/exam/callback does the same). '' when the
// address carries no error.
function problemFromUrl(location) {
  const search = new URLSearchParams(location.search)
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''))
  const read = (name) => search.get(name) || hash.get(name) || ''
  const error = read('error')
  const code = read('error_code')
  if (!error && !code && !read('error_description')) return ''
  // A used or expired email link comes back as access_denied too, so its code
  // is looked at first.
  if (code === 'otp_expired') return LINK_FAILED
  if (error === 'access_denied' && !code) return 'You cancelled the sign-in.'
  return 'The sign-in didn’t complete. It may have been cancelled or left open too long.'
}

export default function CallbackPage() {
  usePageTitle('Signing you in')
  const navigate = useNavigate()
  const location = useLocation()
  const [error] = useState(() => problemFromUrl(location))
  const [timedOut, setTimedOut] = useState(false)
  const done = useRef(false)

  useEffect(() => {
    if (error) return undefined
    // getSession() resolves asynchronously; if the user has already left this
    // page by then (back button, StrictMode re-run) we must not navigate.
    let alive = true
    const go = () => {
      if (!alive || done.current) return
      done.current = true
      navigate(takeNext(), { replace: true })
    }
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) go()
    })
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) go()
    })
    const timer = setTimeout(() => {
      if (!done.current) setTimedOut(true)
    }, TIMEOUT_MS)
    return () => {
      alive = false
      subscription.unsubscribe()
      clearTimeout(timer)
    }
  }, [error, navigate])

  if (error || timedOut) {
    return (
      <AuthCard
        eyebrow="Members"
        title="We couldn’t sign you in"
        // An alert, so the reason is said aloud when the wait runs out and
        // this card takes the place of the spinner.
        subtitle={<span role="alert">{error || LINK_FAILED}</span>}
      >
        {/* The one thing to do next, so it is the card's button and not a
            small grey link. */}
        <Link to={SIGN_IN_PATH} className={`${primaryBtnCls} mt-6 min-h-[44px] w-full`}>
          Try signing in again
        </Link>
      </AuthCard>
    )
  }

  return (
    <AuthCard eyebrow="Members" title="Signing you in…">
      <div className="mt-6 flex justify-center">
        <Spinner />
      </div>
    </AuthCard>
  )
}
