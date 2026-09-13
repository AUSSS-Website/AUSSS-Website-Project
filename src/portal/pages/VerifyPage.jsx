import { useState } from 'react'
import { Link } from 'react-router-dom'
import usePageTitle from '../../hooks/usePageTitle.js'
import { useAuth } from '../../auth/AuthProvider.jsx'
import { useMyVerification, useRequestVerification } from '../queries.js'
import {
  Centered,
  ErrorText,
  Field,
  PageHeader,
  Panel,
  Spinner,
  StatusBadge,
  inputCls,
  primaryBtnCls,
} from '../portalUi.jsx'

// /portal/verify. For people who signed in with an email the roster doesn't
// know: they ask, an EB member confirms. One row per request; the page shows
// the latest request's state instead of letting them pile up.

function when(iso) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' })
  } catch {
    return ''
  }
}

export default function VerifyPage() {
  usePageTitle('Request verification')
  const { user, profile } = useAuth()
  const mine = useMyVerification(user.id)
  const request = useRequestVerification(user.id)
  const [message, setMessage] = useState('')

  const status = profile?.membership_status || 'unverified'

  if (mine.isPending) {
    return (
      <Centered>
        <Spinner />
      </Centered>
    )
  }

  const latest = mine.data

  let body
  if (status !== 'unverified') {
    body = (
      <Panel>
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={status} />
          <p className="text-sm text-silver/70">You’re already verified, nothing to do here.</p>
        </div>
      </Panel>
    )
  } else if (latest?.status === 'pending') {
    body = (
      <Panel title="Request pending">
        <p className="mt-4 text-sm text-silver/70">
          Sent {when(latest.created_at)}. An EB member will confirm you against the
          membership records; you’ll see your badge change on the dashboard.
        </p>
        {latest.message && (
          <blockquote className="mt-4 border-l-2 border-white/15 pl-4 text-sm text-silver/55">
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
      } catch {
        // request.error is rendered below.
      }
    }
    body = (
      <form onSubmit={submit} className="max-w-2xl">
        {latest?.status === 'declined' && (
          <p className="mb-5 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
            Your request from {when(latest.created_at)} was declined
            {latest.decided_at ? ` on ${when(latest.decided_at)}` : ''}. You can send
            another with more detail.
          </p>
        )}
        <Panel className="space-y-5">
          <p className="text-sm text-silver/70">
            You signed in as <span className="text-white">{user.email}</span>. If the
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
          <button type="submit" disabled={request.isPending} className={primaryBtnCls}>
            {request.isPending ? 'Sending…' : 'Request verification'}
          </button>
          <ErrorText>
            {request.error ? request.error.message || 'Could not send the request.' : ''}
          </ErrorText>
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
        <p role="alert" className="mb-5 text-sm text-red-400">
          Couldn’t check earlier requests: {mine.error.message}
        </p>
      )}
      {body}
      <Link
        to="/portal"
        className="mt-8 inline-block text-sm font-semibold text-silver/60 transition-colors hover:text-white"
      >
        &larr; Back to dashboard
      </Link>
    </>
  )
}
