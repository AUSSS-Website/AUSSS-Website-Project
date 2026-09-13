import { useState } from 'react'
import usePageTitle from '../../../hooks/usePageTitle.js'
import { useDecideVerification, usePendingVerifications } from '../../queries.js'
import {
  Centered,
  ErrorText,
  PageHeader,
  Panel,
  Spinner,
  StatusBadge,
  outlineBtnCls,
  primaryBtnCls,
} from '../../portalUi.jsx'

// /portal/admin/verification (EB only, gated by RequireEB). Approve sets the
// member active; decline leaves them unverified. Both go through the
// decide_verification RPC so the request and the profile change together.

function when(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
  } catch {
    return ''
  }
}

function Row({ req, onDecide, busyId, error }) {
  const p = req.profile || {}
  const busy = busyId === req.id
  return (
    <li className="rounded-2xl border border-white/10 bg-forest-800 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-white">
            {p.full_name || 'No name yet'}
          </p>
          <p className="truncate text-sm text-silver/70">{p.email || req.profile_id}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-silver/50">
            <StatusBadge status={p.membership_status || 'unverified'} />
            <span>Requested {when(req.created_at)}</span>
          </div>
          {req.message && (
            <blockquote className="mt-3 border-l-2 border-white/15 pl-4 text-sm text-silver/70">
              {req.message}
            </blockquote>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            disabled={Boolean(busyId)}
            onClick={() => onDecide(req.id, 'declined')}
            className={outlineBtnCls}
          >
            Decline
          </button>
          <button
            type="button"
            disabled={Boolean(busyId)}
            onClick={() => onDecide(req.id, 'approved')}
            className={`${primaryBtnCls} px-5 py-1.5 text-xs`}
          >
            {busy ? 'Saving…' : 'Approve'}
          </button>
        </div>
      </div>
      {error?.id === req.id && (
        <div className="mt-3">
          <ErrorText>{error.message}</ErrorText>
        </div>
      )}
    </li>
  )
}

export default function VerificationQueuePage() {
  usePageTitle('Verification queue')
  const pending = usePendingVerifications(true)
  const decide = useDecideVerification()
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState(null) // { id, message }

  const onDecide = async (id, decision) => {
    setBusyId(id)
    setError(null)
    try {
      await decide.mutateAsync({
        request_id: id,
        decision,
        new_status: decision === 'approved' ? 'active' : undefined,
      })
    } catch (e) {
      setError({ id, message: e?.message || 'Could not save the decision.' })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Executive Board"
        title="Verification queue"
        subtitle="People who signed in but aren’t on the roster. Approve makes them an active member."
      />

      {pending.isPending ? (
        <Centered>
          <Spinner />
        </Centered>
      ) : pending.error ? (
        <Panel>
          <ErrorText>Couldn’t load the queue: {pending.error.message}</ErrorText>
        </Panel>
      ) : pending.data.length === 0 ? (
        <Panel>
          <p className="text-sm text-silver/70">Nothing waiting. Nice.</p>
        </Panel>
      ) : (
        <ul className="space-y-4">
          {pending.data.map((req) => (
            <Row key={req.id} req={req} onDecide={onDecide} busyId={busyId} error={error} />
          ))}
        </ul>
      )}
    </>
  )
}
