import { useMemo, useState } from 'react'
import { formatEGP } from '../../../lib/cart.js'
import { paymentMethodLabel } from '../../../data/merchConfig.js'
import { usePaymentMethods } from '../../merchQueries.js'
import { useSubmissionMutations, useSubmissions } from '../../submissionsQueries.js'
import { when } from '../../workUi.jsx'
import { ErrorText, Panel, Spinner, outlineBtnCls } from '../../portalUi.jsx'
import { ReceiptButton } from '../submissions/SubmissionsPage.jsx'

// The orders on the Merch page: every order placed through the checkout,
// newest first, with who placed it, how to reach them, what they ordered, the
// payment screenshot they uploaded, and where the EB has got to with it:
// new, contacted (the buyer has heard from us), delivered (handed over; the
// order greys out). The same rows are on Submissions > Orders, where the EB
// can also keep notes, export and delete.

export const ORDER_STATUSES = [
  ['new', 'New'],
  ['contacted', 'Contacted'],
  ['delivered', 'Delivered'],
]

const FILTERS = [['all', 'All'], ...ORDER_STATUSES]

const chipCls = (on) =>
  `rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
    on ? 'border-medical bg-medical/15 text-accent' : 'border-line/15 text-soft/70 hover:text-ink'
  }`

function StatusPicker({ order, onChange, busy }) {
  return (
    <div role="group" aria-label={`Status of ${order.ref}`} className="inline-flex rounded-full border border-line/15 p-0.5">
      {ORDER_STATUSES.map(([value, label]) => {
        const on = order.status === value
        return (
          <button
            key={value}
            type="button"
            aria-pressed={on}
            disabled={busy}
            onClick={() => !on && onChange(value)}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${
              on ? 'bg-cta text-on-cta' : 'text-soft/70 hover:text-ink'
            }`}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

function OrderRow({ order, onStatus, busy }) {
  const methods = usePaymentMethods()
  const items = Array.isArray(order.items) ? order.items : []
  const delivered = order.status === 'delivered'
  return (
    <li
      className={`rounded-2xl border border-line/10 bg-card p-4 transition-opacity sm:p-5 ${
        delivered ? 'opacity-50 grayscale' : ''
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-base font-semibold text-ink">{order.name}</p>
          <p className="mt-0.5 text-xs text-soft/55">
            {order.ref} · {when(order.created_at)}
          </p>
        </div>
        <StatusPicker order={order} onChange={(status) => onStatus(order, status)} busy={busy} />
      </div>

      <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <a href={`mailto:${order.email}`} className="break-all text-accent hover:text-ink">
          {order.email}
        </a>
        {order.phone && (
          <a href={`tel:${order.phone.replace(/[^\d+]/g, '')}`} className="text-accent hover:text-ink">
            {order.phone}
          </a>
        )}
      </p>

      <ul className="mt-3 space-y-1 text-sm text-soft/80">
        {items.map((it, i) => (
          <li key={i} className="flex flex-wrap gap-x-2">
            <span className="text-ink">
              {it.qty}× {it.name}
            </span>
            {(it.size || it.design) && (
              <span className="text-soft/55">({[it.size, it.design].filter(Boolean).join(', ')})</span>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold text-ink">{formatEGP(order.subtotal)}</span>
        {order.payment_method && <span className="text-xs text-soft/55">via {paymentMethodLabel(methods, order.payment_method)}</span>}
        <span className="ml-auto">
          <ReceiptButton path={order.receipt_path} label="Payment" className={outlineBtnCls} />
        </span>
      </div>
      {order.price_flag && (
        <p className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-warn">
          Check the amount: {order.price_flag}.
        </p>
      )}
    </li>
  )
}

export default function OrdersPanel() {
  const orders = useSubmissions('orders')
  const { update } = useSubmissionMutations('orders')
  const [filter, setFilter] = useState('all')
  const [error, setError] = useState('')
  const rows = useMemo(() => orders.data || [], [orders.data])
  const counts = useMemo(() => {
    const c = { all: rows.length }
    for (const [value] of ORDER_STATUSES) c[value] = rows.filter((r) => r.status === value).length
    return c
  }, [rows])
  const shown = filter === 'all' ? rows : rows.filter((r) => r.status === filter)

  const setStatus = async (order, status) => {
    setError('')
    try {
      await update.mutateAsync({ id: order.id, patch: { status } })
    } catch (e) {
      setError(e?.message || 'Could not change the status.')
    }
  }

  return (
    <Panel title="Orders" className="mt-10">
      <p className="mt-2 text-xs text-soft/55">
        Every order placed at the checkout, newest first. Mark an order contacted once the buyer has heard
        from us, and delivered once it is handed over.
      </p>

      {orders.isPending ? (
        <div className="mt-6 flex justify-center">
          <Spinner />
        </div>
      ) : orders.error ? (
        <div className="mt-4">
          <ErrorText>Couldn’t load the orders: {orders.error.message}</ErrorText>
        </div>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-sm text-soft/70">No orders yet.</p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Show orders">
            {FILTERS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
                className={chipCls(filter === value)}
              >
                {label} ({counts[value]})
              </button>
            ))}
          </div>
          {error && (
            <div className="mt-3">
              <ErrorText>{error}</ErrorText>
            </div>
          )}
          {shown.length === 0 ? (
            <p className="mt-4 text-sm text-soft/70">No orders with that status.</p>
          ) : (
            <ul className="mt-4 grid gap-3">
              {shown.map((o) => (
                <OrderRow
                  key={o.id}
                  order={o}
                  onStatus={setStatus}
                  busy={update.isPending && update.variables?.id === o.id}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </Panel>
  )
}
