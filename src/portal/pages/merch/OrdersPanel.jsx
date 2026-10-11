import { useMemo, useRef, useState } from 'react'
import { formatEGP } from '../../../lib/cart.js'
import { errorText } from '../../../lib/errorText.js'
import { pressCls } from '../../../lib/motion.js'
import { paymentMethodLabel } from '../../../data/merchConfig.js'
import { useInstantSave, usePaymentMethods } from '../../merchQueries.js'
import { useSubmissionMutations, useSubmissions } from '../../submissionsQueries.js'
import { chipBtnCls, when } from '../../workUi.jsx'
import { ErrorText, Panel, Spinner, UndoLine, outlineBtnCls } from '../../portalUi.jsx'
import { ReceiptButton } from '../submissions/SubmissionsPage.jsx'

// The orders on the Merch page: every order placed through the checkout,
// newest first, with who placed it, how to reach them, what they ordered, the
// payment screenshot they uploaded, and where the EB has got to with it:
// new, contacted (the buyer has heard from us), delivered (handed over; the
// order's text steps back). The same rows are on Submissions > Orders, where
// the EB can also keep notes, export and delete.
//
// A status is saved the moment it is picked (useInstantSave in
// merchQueries.js). The order then stays where it is, even under a filter it
// no longer fits, with a line that offers to take the change back; it leaves
// the list when a filter is next chosen.

export const ORDER_STATUSES = [
  ['new', 'New'],
  ['contacted', 'Contacted'],
  ['delivered', 'Delivered'],
]
const STATUS_LABEL = Object.fromEntries(ORDER_STATUSES)

const FILTERS = [['all', 'All'], ...ORDER_STATUSES]

// On a touch screen a button is at least a thumb tall; with a mouse it keeps
// the portal's small pill.
const tapCls = '[@media(pointer:coarse)]:min-h-[44px]'

function StatusPicker({ order, status, onChange, groupRef }) {
  return (
    <div
      ref={groupRef}
      role="group"
      aria-label={`Status of ${order.ref}`}
      className="inline-flex rounded-full border border-line/15 p-0.5"
    >
      {ORDER_STATUSES.map(([value, label]) => {
        const on = status === value
        return (
          <button
            key={value}
            type="button"
            data-status={value}
            aria-pressed={on}
            onClick={() => !on && onChange(value)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${pressCls} ${tapCls} ${
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

function OrderRow({ order, onSave, onTouched }) {
  const methods = usePaymentMethods()
  const [status, setStatus, { error }] = useInstantSave(order.status, (next) => onSave(order.id, next))
  // The last change made here, as { from, to }, for the line that offers to
  // take it back.
  const [moved, setMoved] = useState(null)
  const picker = useRef(null)
  const items = Array.isArray(order.items) ? order.items : []

  const pick = (next) => {
    onTouched(order.id)
    setMoved({ from: status, to: next })
    setStatus(next)
  }
  const undo = (e) => {
    // Undo leaves the page the moment it is pressed. If the keyboard was on
    // it, it goes to the status that is picked again: left alone it would be
    // on nothing, and the next Tab would start from the top of the page.
    if (document.activeElement === e.currentTarget) {
      const buttons = Array.from(picker.current?.querySelectorAll('button') || [])
      buttons.find((b) => b.dataset.status === moved.from)?.focus()
    }
    onTouched(order.id)
    setMoved(null)
    setStatus(moved.from)
  }
  // The line speaks of the status on show. Once that is another one (a save
  // that failed, a change made on Submissions), there is nothing here to undo.
  const said = moved && moved.to === status ? `Moved to ${STATUS_LABEL[moved.to]}.` : null

  // A delivered order is finished with, so what it says steps back. Its text
  // takes the theme's quiet steps, which stay readable, and its controls keep
  // their full strength: fading the whole row dimmed the buttons with it.
  const delivered = status === 'delivered'
  const strong = `transition-colors duration-200 ${delivered ? 'text-soft/50' : 'text-ink'}`
  const quiet = `transition-colors duration-200 ${delivered ? 'text-soft/40' : 'text-soft/55'}`

  return (
    <li className="rounded-2xl border border-line/10 bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <p className={`text-base font-semibold ${strong}`}>{order.name}</p>
          <p className={`mt-0.5 text-xs ${quiet}`}>
            {order.ref} · {when(order.created_at)}
          </p>
        </div>
        <div className="flex min-w-0 flex-col items-start sm:items-end">
          <StatusPicker order={order} status={status} onChange={pick} groupRef={picker} />
          {/* Always in the page, and empty until a status is changed, so a
              screen reader says the line when it comes. */}
          <UndoLine onUndo={undo} className="py-3">
            {said}
          </UndoLine>
        </div>
      </div>
      {error && (
        <div className="mt-2">
          <ErrorText>{errorText(error, 'We couldn’t change the status. It is back where it was.')}</ErrorText>
        </div>
      )}

      <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <a href={`mailto:${order.email}`} className={`inline-flex items-center break-all text-accent hover:text-ink ${tapCls}`}>
          {order.email}
        </a>
        {order.phone && (
          <a
            href={`tel:${order.phone.replace(/[^\d+]/g, '')}`}
            className={`inline-flex items-center text-accent hover:text-ink ${tapCls}`}
          >
            {order.phone}
          </a>
        )}
      </p>

      <ul className="mt-3 space-y-1 text-sm">
        {items.map((it, i) => (
          <li key={i} className="flex flex-wrap gap-x-2">
            <span className={strong}>
              {it.qty}× {it.name}
            </span>
            {(it.size || it.design) && (
              <span className={quiet}>({[it.size, it.design].filter(Boolean).join(', ')})</span>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span className={`text-sm font-semibold ${strong}`}>{formatEGP(order.subtotal)}</span>
        {order.payment_method && (
          <span className={`text-xs ${quiet}`}>via {paymentMethodLabel(methods, order.payment_method)}</span>
        )}
        <span className="ml-auto">
          <ReceiptButton path={order.receipt_path} label="Payment" className={`${outlineBtnCls} ${tapCls}`} />
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
  // The orders whose status was changed under the filter now showing. Each
  // stays in the list, where the change was made and can be taken back, until
  // a filter is chosen again.
  const [kept, setKept] = useState(() => new Set())
  const rows = useMemo(() => orders.data || [], [orders.data])
  const counts = useMemo(() => {
    const c = { all: rows.length }
    for (const [value] of ORDER_STATUSES) c[value] = rows.filter((r) => r.status === value).length
    return c
  }, [rows])
  const shown = filter === 'all' ? rows : rows.filter((r) => r.status === filter || kept.has(r.id))

  const choose = (value) => {
    setFilter(value)
    setKept(new Set())
  }
  const keep = (id) => setKept((ids) => (ids.has(id) ? ids : new Set(ids).add(id)))
  const save = (id, status) => update.mutateAsync({ id, patch: { status } })

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
          <ErrorText>{errorText(orders.error, 'We couldn’t load the orders.')}</ErrorText>
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
                onClick={() => choose(value)}
                className={`${chipBtnCls(filter === value)} ${tapCls}`}
              >
                {label} ({counts[value]})
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <p className="mt-4 text-sm text-soft/70">No orders with that status.</p>
          ) : (
            <ul className="mt-4 grid gap-3">
              {shown.map((o) => (
                <OrderRow key={o.id} order={o} onSave={save} onTouched={keep} />
              ))}
            </ul>
          )}
        </>
      )}
    </Panel>
  )
}
