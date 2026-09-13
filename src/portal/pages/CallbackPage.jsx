import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import usePageTitle from '../../hooks/usePageTitle.js'
import { supabase } from '../../lib/supabase.js'
import { SIGN_IN_PATH, takeNext } from '../constants.js'
import { AuthCard, BackLink, Spinner } from '../portalUi.jsx'

// /portal/callback. Both Google and the magic link land here with tokens in
// the URL hash (implicit flow); supabase-js already consumed them when the
// client was created, so we just wait for the session to appear and go.

const TIMEOUT_MS = 8000

// Supabase reports failures (expired link, denied consent) as
// ?error_description= or #error_description= depending on the path taken.
function errorFromUrl(location) {
  const search = new URLSearchParams(location.search)
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''))
  return (
    search.get('error_description') ||
    hash.get('error_description') ||
    search.get('error') ||
    hash.get('error') ||
    ''
  )
}

export default function CallbackPage() {
  usePageTitle('Signing you in')
  const navigate = useNavigate()
  const location = useLocation()
  const [error, setError] = useState(() => errorFromUrl(location))
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
        subtitle={
          error
            ? error.replace(/\+/g, ' ')
            : 'The sign-in link didn’t complete. It may have expired or already been used.'
        }
      >
        <BackLink to={SIGN_IN_PATH}>Try signing in again</BackLink>
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
