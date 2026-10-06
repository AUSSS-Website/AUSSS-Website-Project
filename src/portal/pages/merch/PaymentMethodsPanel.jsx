import { useState } from 'react'
import { PAYMENT_TYPES, normalizePaymentMethods, paymentValueProblem } from '../../../data/merchConfig.js'
import { slugify } from '../../merchForm.js'
import { usePaymentMethods } from '../../merchQueries.js'
import { useSubmissions } from '../../submissionsQueries.js'
import { useSiteSettingsAdmin, useUpsertSiteSetting } from '../../officerQueries.js'
import SortableList from '../../SortableList.jsx'
import {
  ConfirmButton,
  ErrorText,
  Field,
  Panel,
  Toggle,
  inputCls,
  outlineBtnCls,
  primaryBtnCls,
} from '../../portalUi.jsx'

// The payment methods on the checkout, edited in place and saved together as
// the site setting `merchPaymentMethods` (src/data/merchConfig.js reads it).
// Until the setting exists the list starts from the shipped copy.
//
// A method's id is what an order records, so a saved id never changes. A new
// method shows the id its name will give it, and keeps that id from the save.

const TYPE_LABEL = Object.fromEntries(PAYMENT_TYPES)
const PLACEHOLDER = {
  link: 'https://ipn.eg/S/…',
  handle: '@name',
  phone: '01012345678',
}

// Rows carry a local `key` for the list; saved rows use their id.
const asRows = (methods) => methods.map((m) => ({ ...m, key: m.id, saved: true }))
const strip = (rows) => rows.map(({ key, saved, ...m }) => m)

// The id a new method gets from its name: lower case with dashes, unique
// among the ids before it and every id an order has recorded, so an old order
// never shows a newer method's name.
function idFor(label, taken) {
  const base = slugify(label).slice(0, 36).replace(/-+$/, '') || 'method'
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
  return id
}

// Every row with its final id, in order. `used` holds the ids orders name.
function withIds(rows, used) {
  const taken = new Set([...used, ...rows.filter((r) => r.saved).map((r) => r.id)])
  return rows.map((r) => {
    if (r.saved) return r
    const id = idFor(r.label, taken)
    taken.add(id)
    return { ...r, id }
  })
}

function rowProblems(r) {
  return {
    label: r.label.trim() ? '' : 'Give it a name.',
    value: paymentValueProblem(r.type, r.value),
  }
}

let nextKey = 0

function MethodRow({ row, handle, onChange, onRemove, last, busy }) {
  const [tried, setTried] = useState(false)
  const problems = rowProblems(row)
  const f = (name) => `pay-${row.key}-${name}`
  return (
    <div className="flex gap-2 p-3 sm:gap-3 sm:p-4">
      <div className="pt-1">{handle}</div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 truncate text-xs text-soft/40">
            {row.saved ? row.id : `${row.id} (fixed when saved)`}
          </p>
          <div className="flex items-center gap-3">
            <span className="text-xs text-soft/60">On the checkout</span>
            <Toggle
              checked={row.available}
              onChange={(v) => onChange({ available: v })}
              label={`${row.label || 'This method'} on the checkout`}
              disabled={busy}
            />
          </div>
        </div>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor={f('label')}>
            <input
              id={f('label')}
              className={inputCls}
              value={row.label}
              onChange={(e) => onChange({ label: e.target.value })}
              maxLength={60}
              placeholder="Instapay"
            />
            {problems.label && <p className="mt-1 text-xs text-danger">{problems.label}</p>}
          </Field>
          <Field label="Type" htmlFor={f('type')}>
            <select
              id={f('type')}
              className={inputCls}
              value={row.type}
              onChange={(e) => onChange({ type: e.target.value })}
            >
              {PAYMENT_TYPES.map(([t, label]) => (
                <option key={t} value={t}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label={TYPE_LABEL[row.type] || 'Value'} htmlFor={f('value')}>
            <input
              id={f('value')}
              className={inputCls}
              value={row.value}
              onChange={(e) => onChange({ value: e.target.value })}
              maxLength={300}
              placeholder={PLACEHOLDER[row.type]}
              inputMode={row.type === 'phone' ? 'tel' : row.type === 'link' ? 'url' : undefined}
            />
            {problems.value && <p className="mt-1 text-xs text-danger">{problems.value}</p>}
          </Field>
          <Field label="Hint" htmlFor={f('hint')}>
            <input
              id={f('hint')}
              className={inputCls}
              value={row.hint}
              onChange={(e) => onChange({ hint: e.target.value })}
              maxLength={80}
              placeholder="Send + upload receipt"
            />
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-end gap-3">
          {tried && last && <span className="text-xs text-soft/60">The checkout needs at least one method.</span>}
          <ConfirmButton
            variant="text"
            label="Remove"
            disabled={busy}
            onConfirm={() => (last ? setTried(true) : onRemove())}
          />
        </div>
      </div>
    </div>
  )
}

export default function PaymentMethodsPanel() {
  const methods = usePaymentMethods()
  const { isPending, error: loadError } = useSiteSettingsAdmin()
  const save = useUpsertSiteSetting()
  // The list being edited, or null to show what is saved.
  const [draft, setDraft] = useState(null)
  const [saved, setSaved] = useState(false)

  const orders = useSubmissions('orders')
  const used = (orders.data || []).map((o) => o.payment_method).filter(Boolean)
  const rows = withIds(draft || asRows(methods), used)
  const clean = normalizePaymentMethods(strip(rows))
  const changed = draft !== null && JSON.stringify(clean) !== JSON.stringify(methods)
  const hasProblem = rows.some((r) => {
    const p = rowProblems(r)
    return p.label || p.value
  })
  // With every method switched off the checkout has nowhere to pay and no
  // receipt upload, so a buyer could never place an order.
  const noneOn = !rows.some((r) => r.available)
  const busy = isPending || save.isPending

  const edit = (fn) => {
    setSaved(false)
    setDraft(fn(draft || asRows(methods)))
  }
  const patch = (key, change) => edit((list) => list.map((r) => (r.key === key ? { ...r, ...change } : r)))
  const remove = (key) => edit((list) => list.filter((r) => r.key !== key))
  const add = () =>
    edit((list) => [
      ...list,
      { key: `new-${nextKey++}`, type: 'link', label: '', hint: 'Send + upload receipt', value: '', available: true, saved: false },
    ])
  const reorder = (keys) => edit((list) => keys.map((k) => list.find((r) => r.key === k)))

  const submit = () => {
    if (!changed || hasProblem || noneOn) return
    save.mutate(
      { key: 'merchPaymentMethods', value: clean },
      {
        onSuccess: () => {
          setDraft(null)
          setSaved(true)
        },
      },
    )
  }

  return (
    <Panel title="Payment methods" className="mt-8">
      <p className="mt-2 text-xs text-soft/55">
        The ways to pay on the checkout, in this order. Drag a method by its handle to move it. A method's id is
        recorded on every order that uses it, so it never changes. Switch a method off rather than removing it while
        orders may still name it.
      </p>

      <SortableList
        items={rows}
        getId={(r) => r.key}
        getLabel={(r) => r.label || 'New method'}
        onReorder={reorder}
        disabled={busy}
        className="mt-4 grid gap-3"
        itemClassName="min-w-0 rounded-2xl border border-line/10 bg-page/60"
        renderItem={(r, handle) => (
          <MethodRow
            row={r}
            handle={handle}
            onChange={(change) => patch(r.key, change)}
            onRemove={() => remove(r.key)}
            last={rows.length === 1}
            busy={busy}
          />
        )}
      />

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" className={outlineBtnCls} onClick={add} disabled={busy}>
          Add a payment method
        </button>
        <button type="button" className={primaryBtnCls} onClick={submit} disabled={busy || !changed || hasProblem || noneOn}>
          {save.isPending ? 'Saving…' : 'Save payment methods'}
        </button>
        {noneOn && <span className="text-xs text-danger">Switch at least one method on for the checkout.</span>}
        {draft !== null && (
          <button type="button" className={outlineBtnCls} onClick={() => setDraft(null)} disabled={busy}>
            Discard changes
          </button>
        )}
        {saved && !draft && <span className="text-sm text-ok">Saved.</span>}
      </div>
      {(loadError || save.error) && (
        <div className="mt-3">
          <ErrorText>{(loadError || save.error).message}</ErrorText>
        </div>
      )}
    </Panel>
  )
}
