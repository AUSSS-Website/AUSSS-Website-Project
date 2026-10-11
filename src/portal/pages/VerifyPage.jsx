import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import usePageTitle from '../../hooks/usePageTitle.js'
import { useAuth } from '../../auth/AuthProvider.jsx'
import { useLoadedProfile, useMyVerification, useRequestVerification } from '../queries.js'
import {
  ErrorText,
  Field,
  PageHeader,
  PageLoading,
  Panel,
  StatusBadge,
  inputCls,
  outlineBtnCls,
  panelTitleCls,
  primaryBtnCls,
} from '../portalUi.jsx'
import { errorText } from '../../lib/errorText.js'

// /portal/verify. For people who signed in with an email the roster doesn't
// know: they ask, an EB member confirms. One row per request; the page shows
// the latest request's state instead of letting them pile up.

// The portal's pills are under 44px tall to the eye. This ::after gives a
// finger the difference without changing how they look.
const tapCls = "relative after:absolute after:inset-x-0 after:-inset-y-[10px] after:content-['']"

function when(iso) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' })
  } catch {
    return ''
  }
}

export default function VerifyPage() {
  usePageTitle('Request verification')
  const { user, profile, profileError } = useAuth()
  // The row the sign-in check read, held here to ask for it again.
  const row = useLoadedProfile(user.id)
  const mine = useMyVerification(user.id)
  const request = useRequestVerification(user.id)
  const [message, setMessage] = useState('')
  // True once a request has gone out from this page.
  const [sent, setSent] = useState(false)
  const pendingTitle = useRef(null)

  const status = profile?.membership_status || 'unverified'
  const latest = mine.data
  const pending = status === 'unverified' && latest?.status === 'pending'

  // Sending takes the form away, and the button that had the focus with it.
  // The focus goes to the title of the panel that took its place, so the
  // keyboard carries on from there and a screen reader says what happened.
  useEffect(() => {
    if (sent && pending) pendingTitle.current?.focus()
  }, [sent, pending])

  let body
  if (profileError && !profile) {
    // With no profile to read, "unverified" would be a guess, and the form
    // would invite a member who is verified to ask again.
    body = (
      <Panel>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <ErrorText>{errorText(profileError, 'We couldn’t load your profile. Try again in a moment.')}</ErrorText>
          <button type="button" onClick={() => row.refetch()} className={`${outlineBtnCls} ${tapCls}`}>
            Try again
          </button>
        </div>
      </Panel>
    )
  } else if (mine.isPending) {
    body = <PageLoading />
  } else if (status !== 'unverified') {
    body = (
      <Panel>
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={status} />
          <p className="text-sm text-soft/70">You’re already verified. There’s nothing to do here.</p>
        </div>
      </Panel>
    )
  } else if (pending) {
    body = (
      <Panel>
        <p ref={pendingTitle} tabIndex={-1} className={`${panelTitleCls} focus:outline-none`}>
          Request pending
        </p>
        <p className="mt-4 text-sm text-soft/70">
          Sent {when(latest.created_at)}. An EB member will check you against the
          membership records. You’ll see your badge change on the dashboard.
        </p>
        {latest.message && (
          <blockquote className="mt-4 whitespace-pre-wrap break-words border-l-2 border-line/15 pl-4 text-sm text-soft/55">
            {latest.message}
          </blockquote>
        )}
      </Panel>
    )
  } else {
    const submit = async (e) => {
      e.preventDefault()
      try {
        await request.mutateAsync(message.trim())
        setMessage('')
        setSent(true)
      } catch {
        // request.error is rendered below.
      }
    }
    body = (
      <form onSubmit={submit} className="max-w-2xl">
        {latest?.status === 'declined' && (
          <p className="mb-5 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-warn">
            Your request from {when(latest.created_at)} was declined
            {latest.decided_at ? ` on ${when(latest.decided_at)}` : ''}. You can send
            another with more detail.
          </p>
        )}
        <Panel className="space-y-5">
          <p className="text-sm text-soft/70">
            You signed in as <span className="break-words text-ink">{user.email}</span>. If the
            roster has you under a different email, say so below so the EB can match you.
          </p>
          <Field
            label="Message to the EB"
            htmlFor="vr-message"
            hint="Optional. Your year, committee, who recruited you, or the email the society knows you by."
          >
            <textarea
              id="vr-message"
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={1000}
              className={`${inputCls} resize-y`}
            />
          </Field>
        </Panel>
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <button type="submit" disabled={request.isPending} className={`${primaryBtnCls} ${tapCls}`}>
            {request.isPending ? 'Sending…' : 'Request verification'}
          </button>
          <ErrorText>{request.error ? errorText(request.error, 'Could not send the request.') : ''}</ErrorText>
        </div>
      </form>
    )
  }

  return (
    <>
      <PageHeader
        eyebrow="Membership"
        title="Verify your membership"
        subtitle="Verified members see their positions and appear to their officers."
      />
      {mine.error && (
        <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-3">
          <ErrorText>{errorText(mine.error, 'Couldn’t check your earlier requests.')}</ErrorText>
          <button type="button" onClick={() => mine.refetch()} className={`${outlineBtnCls} ${tapCls}`}>
            Try again
          </button>
        </div>
      )}
      {body}
      <Link
        to="/portal"
        className="mt-5 inline-flex min-h-[44px] items-center text-sm font-semibold text-soft/60 transition-colors hover:text-ink"
      >
        &larr; Back to dashboard
      </Link>
    </>
  )
}
