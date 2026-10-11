import { useEffect, useRef, useState } from 'react'
import useLeaveWarning from '../../../hooks/useLeaveWarning.js'
import { errorText } from '../../../lib/errorText.js'
import { PAYMENT_TYPES, normalizePaymentMethods, paymentValueProblem } from '../../../data/merchConfig.js'
import { slugify } from '../../merchForm.js'
import { usePaymentMethods } from '../../merchQueries.js'
import { useSubmissions } from '../../submissionsQueries.js'
import { useSiteSettingsAdmin, useUpsertSiteSetting } from '../../officerQueries.js'
import SortableList from '../../SortableList.jsx'
import {
  CheckField,
  ConfirmButton,
  ErrorText,
  Field,
  Panel,
  SaveStatus,
  Spinner,
  UndoLine,
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
//
// Nothing here is stored until "Save payment methods" is pressed, so the list
// says when it holds unsaved changes, whether a method is on the checkout is a
// tick box and not a switch, and a method added since the last save is removed
// in one click. Removing a saved method asks first: once that is saved, orders
// that name the method show its id in place of its name.

const TYPE_LABEL = Object.fromEntries(PAYMENT_TYPES)
const PLACEHOLDER = {
  link: 'https://ipn.eg/S/…',
  handle: '@name',
  phone: '01012345678',
}

// On a touch screen a button is at least a thumb tall; with a mouse it keeps
// the portal's small pill.
const tapCls = '[@media(pointer:coarse)]:min-h-[44px]'

// The quiet "Remove" at the foot of a method. Its ::after gives a finger more
// to land on than the word itself.
const removeCls =
  "relative text-xs font-semibold text-soft/60 transition-colors hover:text-ink disabled:opacity-40 after:absolute after:-inset-x-3 after:-inset-y-[15px] after:content-['']"

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

// The id of one of a row's inputs, for its label and for taking the cursor to
// it ('row' is the method as a whole).
const fieldId = (row, name) => `pay-${row.key}-${name}`
const DISCARD_ID = 'pay-discard'

// A held Enter presses a button again and again. "Discard changes" and the
// Undo that takes it back each bring the other, so only a fresh press counts.
const freshPressOnly = (e) => {
  if (e.key === 'Enter' && e.repeat) e.preventDefault()
}

let nextKey = 0

function MethodRow({ row, handle, onChange, onRemove, last, busy, showAll }) {
  // Asking to remove the only method is answered with why it stays.
  const [tried, setTried] = useState(false)
  // The fields the cursor has been in and left. What is wrong with a field is
  // said from then on (or once Save was pressed, `showAll`), so a method just
  // added does not open with complaints about boxes nobody has typed in yet.
  const [left, setLeft] = useState({})
  const leave = (name) => setLeft((was) => (was[name] ? was : { ...was, [name]: true }))
  const problems = rowProblems(row)
  const problem = (name) => (showAll || left[name] ? problems[name] : '')
  const f = (name) => fieldId(row, name)
  // What an input with something wrong says of itself to a screen reader.
  const marks = (name) =>
    problem(name) ? { 'aria-invalid': true, 'aria-describedby': f(`${name}-problem`) } : undefined

  return (
    <div
      id={f('row')}
      role="group"
      aria-label={row.label.trim() || 'New method'}
      className="flex gap-2 p-3 sm:gap-3 sm:p-4"
    >
      <div className="pt-0.5">{handle}</div>
      <div className="min-w-0 flex-1">
        {/* On a phone the id has a line to itself and the tick box the next,
            so every method is laid out alike however long its id. */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between sm:gap-x-3">
          <p className="min-w-0 truncate pt-2.5 text-xs text-soft/40 sm:pt-0">
            {row.saved ? row.id : `${row.id} (fixed when saved)`}
          </p>
          <CheckField
            id={f('available')}
            checked={row.available}
            onChange={(v) => onChange({ available: v })}
            label="On the checkout"
            disabled={busy}
          />
        </div>
        <div className="mt-1 grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor={f('label')}>
            <input
              id={f('label')}
              className={inputCls}
              value={row.label}
              onChange={(e) => onChange({ label: e.target.value })}
              onBlur={() => leave('label')}
              maxLength={60}
              placeholder="Instapay"
              {...marks('label')}
            />
            {problem('label') && (
              <p id={f('label-problem')} className="mt-1 text-xs text-danger">
                {problem('label')}
              </p>
            )}
          </Field>
          <Field label="Type" htmlFor={f('type')}>
            <select
              id={f('type')}
              className={inputCls}
              value={row.type}
              onChange={(e) => {
                // What was typed for the old type is now judged as the new one,
                // and that is said at once: the change of type caused it.
                if (row.value.trim()) leave('value')
                onChange({ type: e.target.value })
              }}
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
              onBlur={() => leave('value')}
              maxLength={300}
              placeholder={PLACEHOLDER[row.type]}
              inputMode={row.type === 'phone' ? 'tel' : row.type === 'link' ? 'url' : undefined}
              {...marks('value')}
            />
            {problem('value') && (
              <p id={f('value-problem')} className="mt-1 text-xs text-danger">
                {problem('value')}
              </p>
            )}
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
        <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
          <span role="status" className="text-xs text-soft/60">
            {tried && last ? 'The checkout needs at least one method.' : ''}
          </span>
          {last ? (
            <button type="button" className={removeCls} disabled={busy} onClick={() => setTried(true)}>
              Remove
            </button>
          ) : row.saved ? (
            <ConfirmButton variant="text" className={removeCls} label="Remove" disabled={busy} onConfirm={onRemove} />
          ) : (
            // Not saved yet, so nothing is lost for good: one click, and the
            // line under the list offers it back.
            <button type="button" className={removeCls} disabled={busy} onClick={onRemove}>
              Remove
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default function PaymentMethodsPanel() {
  const methods = usePaymentMethods()
  const settings = useSiteSettingsAdmin()
  const save = useUpsertSiteSetting()
  // The list being edited, or null to show what is saved.
  const [draft, setDraft] = useState(null)
  const [saved, setSaved] = useState(false)
  // The rows that were in the list when Save was pressed with something still
  // wrong: every problem of theirs is said from then on, not only those of the
  // fields already visited. A method added afterwards starts quiet again.
  const [pressed, setPressed] = useState(() => new Set())
  // What the last removal or discard took away, as { said, draft, back }: the
  // line that says so, the list as it was for Undo to put back, and the id of
  // what the keyboard returns to with it.
  const [undone, setUndone] = useState(null)

  const orders = useSubmissions('orders')
  const used = (orders.data || []).map((o) => o.payment_method).filter(Boolean)
  const rows = withIds(draft || asRows(methods), used)
  const clean = normalizePaymentMethods(strip(rows))
  const changed = draft !== null && JSON.stringify(clean) !== JSON.stringify(methods)
  const hasProblem = rows.some((r) => {
    const p = rowProblems(r)
    return p.label || p.value
  })
  // With no method on it the checkout has nowhere to pay and no receipt
  // upload, so a buyer could never place an order.
  const noneOn = !rows.some((r) => r.available)
  const busy = save.isPending
  // The list differs from what is saved: by a change that can be saved, or by
  // a method that cannot be yet (it is left out of `clean`).
  const dirty = draft !== null && (changed || hasProblem)
  useLeaveWarning(dirty)

  // Remove goes with its method, and "Discard changes" and Undo go the moment
  // they are pressed. When the keyboard was on one of them it is moved on,
  // once the list has been drawn again: left alone it would be on nothing,
  // and the next Tab would start from the top of the page. `focusNext` is the
  // id of what takes it, or 'undo' for the Undo that has just come.
  const focusNext = useRef('')
  const undoLine = useRef(null)
  useEffect(() => {
    const next = focusNext.current
    if (!next) return
    focusNext.current = ''
    const el = next === 'undo' ? undoLine.current?.querySelector('button') : document.getElementById(next)
    el?.focus()
  })

  const edit = (fn) => {
    setSaved(false)
    setUndone(null)
    setDraft(fn(draft || asRows(methods)))
  }
  const patch = (key, change) => edit((list) => list.map((r) => (r.key === key ? { ...r, ...change } : r)))
  const remove = (row) => {
    // The keyboard stays in the list, on the tick box of the method that
    // takes this one's place (a tick box, because a held Enter does not press
    // one, and would press the next Remove).
    if (document.getElementById(fieldId(row, 'row'))?.contains(document.activeElement)) {
      const at = rows.findIndex((r) => r.key === row.key)
      const next = rows[at + 1] || rows[at - 1]
      if (next) focusNext.current = fieldId(next, 'available')
    }
    edit((list) => list.filter((r) => r.key !== row.key))
    setUndone({ said: `Removed ${row.label.trim() || 'the new method'}.`, draft, back: fieldId(row, 'available') })
  }
  const add = () =>
    edit((list) => [
      ...list,
      { key: `new-${nextKey++}`, type: 'link', label: '', hint: 'Send + upload receipt', value: '', available: true, saved: false },
    ])
  const reorder = (keys) => edit((list) => keys.map((k) => list.find((r) => r.key === k)))
  const discard = (e) => {
    if (document.activeElement === e.currentTarget) focusNext.current = 'undo'
    setUndone({ said: 'Changes discarded.', draft, back: DISCARD_ID })
    setDraft(null)
    setPressed(new Set())
  }
  // Undo puts the list back as it was, and the keyboard on what came back
  // with it: the method's tick box, or "Discard changes".
  const undo = (e) => {
    if (document.activeElement === e.currentTarget) focusNext.current = undone.back
    setDraft(undone.draft)
    setUndone(null)
  }

  const submit = () => {
    if (!dirty) return
    if (hasProblem || noneOn) {
      // Say everything that is in the way, and take the cursor to the first
      // of it: a field to fill in, or else the first tick box.
      setPressed(new Set(rows.map((r) => r.key)))
      const first = rows
        .map((r) => {
          const p = rowProblems(r)
          return p.label ? fieldId(r, 'label') : p.value ? fieldId(r, 'value') : ''
        })
        .find(Boolean)
      const target = first || (rows[0] ? fieldId(rows[0], 'available') : '')
      if (target) document.getElementById(target)?.focus()
      return
    }
    const sent = draft
    save.mutate(
      { key: 'merchPaymentMethods', value: clean },
      {
        onSuccess: () => {
          // The list goes back to showing what is saved. Anything typed while
          // the save was on its way is kept, and still to be saved.
          setDraft((now) => (now === sent ? null : now))
          setSaved(true)
          setPressed(new Set())
          setUndone(null)
        },
      },
    )
  }

  return (
    <Panel title="Payment methods" className="mt-8">
      <p className="mt-2 text-xs text-soft/55">
        The ways to pay on the checkout, in this order. Drag a method by its handle to move it. A method's id is
        recorded on every order that uses it, so it never changes. Take a method off the checkout rather than removing
        it while orders may still name it.
      </p>

      {settings.isPending ? (
        <div className="mt-6 flex justify-center">
          <Spinner />
        </div>
      ) : settings.data === undefined ? (
        // The setting was never read. Not the shipped copy in its place:
        // saving that would write over the methods the checkout really has.
        // A later reading that fails leaves the list as it was last read,
        // with whatever is being typed in it.
        <div className="mt-4">
          <ErrorText>{errorText(settings.error, 'We couldn’t load the payment methods.')}</ErrorText>
        </div>
      ) : (
        <>
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
                onRemove={() => remove(r)}
                last={rows.length === 1}
                busy={busy}
                showAll={pressed.has(r.key)}
              />
            )}
          />

          {/* Always in the page, and empty until something is removed or
              discarded, so a screen reader says the line when it comes. The
              wrapper is there to find the line's button by. */}
          <div ref={undoLine} onKeyDown={freshPressOnly}>
            <UndoLine onUndo={undo} className="mt-3 py-3">
              {undone ? undone.said : null}
            </UndoLine>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" className={`${outlineBtnCls} ${tapCls}`} onClick={add} disabled={busy}>
              Add a payment method
            </button>
            {/* Never off while there is something to save: pressed with a
                field still wrong, it says which and goes there. */}
            <button type="button" className={`${primaryBtnCls} ${tapCls}`} onClick={submit} disabled={busy || !dirty}>
              {save.isPending ? 'Saving…' : 'Save payment methods'}
            </button>
            {dirty && (
              <button
                id={DISCARD_ID}
                type="button"
                className={`${outlineBtnCls} ${tapCls}`}
                onClick={discard}
                onKeyDown={freshPressOnly}
                disabled={busy}
              >
                Discard changes
              </button>
            )}
            <SaveStatus dirty={dirty && !busy} saved={saved} className="text-sm" />
          </div>
          <p role="status" className={noneOn ? 'mt-3 text-xs text-danger' : 'sr-only'}>
            {noneOn ? 'Keep at least one method on the checkout.' : ''}
          </p>
          {save.error && (
            <div className="mt-3">
              <ErrorText>{errorText(save.error, 'We couldn’t save the payment methods.')}</ErrorText>
            </div>
          )}
        </>
      )}
    </Panel>
  )
}
