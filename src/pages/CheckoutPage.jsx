import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import useReveal from '../hooks/useReveal.js'
import usePageTitle from '../hooks/usePageTitle.js'
import {
  useCart,
  cartSubtotal,
  cartCount,
  clearCart,
  formatEGP,
  cartDropped,
} from '../lib/cart.js'
import { useMerchCatalogue } from '../lib/merch.js'
import { useSiteSettings } from '../hooks/useSiteSettings.js'
import { submitOrder } from '../lib/orders.js'
import { paymentMethodsFrom } from '../data/merchConfig.js'
import { pressCls, scrollBehavior } from '../lib/motion.js'

// The faculty's years of study (five, then the two intern years; STUDY_YEARS
// in src/portal/constants.js has the same in the portal's words), and two more
// for buyers who are not students here.
const YEAR_OPTIONS = [
  '1st year',
  '2nd year',
  '3rd year',
  '4th year',
  '5th year',
  '1st year intern',
  '2nd year intern',
  'Resident / Graduate',
  'Other / External',
]

const MAX_SCREENSHOT_MB = 5
const MAX_NOTES_LENGTH = 280

// One rule for each contact field that can be wrong. Each answers with the
// words to show under the field, or with nothing when the field is fine. The
// same rules run when a field is left, while a flagged field is being put
// right, and for the whole form on Place order. (The receipt has its own
// check below: it is a file, not part of `contact`.)
const RULES = {
  name: (c) => (c.name.trim() ? '' : 'Required'),
  email: (c) =>
    c.email.trim() && /^\S+@\S+\.\S+$/.test(c.email) ? '' : 'Enter a valid email',
  phone: (c) => {
    // Numbers in local Egyptian format must be a full mobile (01x + 8 digits);
    // anything else (international WhatsApp) just needs a plausible length.
    const digits = c.phone.replace(/\D/g, '')
    const ok = digits.startsWith('0') ? /^01[0125][0-9]{8}$/.test(digits) : digits.length >= 10
    return c.phone.trim() && ok
      ? ''
      : 'Enter a valid phone / WhatsApp number (e.g. 01x xxxx xxxx)'
  },
  isMember: (c) => (c.isMember ? '' : 'Pick one'),
  lc: (c) => (c.isMember === 'No' && !c.lc.trim() ? 'Tell us which local committee' : ''),
  year: (c) => (c.year ? '' : 'Pick one'),
  notes: (c) =>
    c.notes.length > MAX_NOTES_LENGTH ? `Keep it under ${MAX_NOTES_LENGTH} characters` : '',
}
// The order the fields come in on the page, to find the first one in error.
const FIELD_ORDER = ['name', 'email', 'phone', 'isMember', 'lc', 'year', 'notes', 'screenshot']

// The pills of this page: the green one, the blue one and the outlined one.
// Colours ease and the pill sinks a little when pressed (pressCls); the small
// growth under the pointer is left out for a reader who asked for less motion.
// The least height is in px: the padding is in rem, and the root size shrinks
// on a 320px phone, which left a pill a little under the 44px a thumb needs.
const pillCls = 'inline-flex min-h-[44px] items-center justify-center rounded-full text-sm font-semibold'
const solidPillCls = `${pillCls} bg-solid text-on-solid hover:bg-solid-hover ${pressCls} motion-safe:hover:scale-[1.02]`
const ctaPillCls = `${pillCls} bg-cta text-on-cta hover:bg-cta-hover ${pressCls} motion-safe:hover:scale-[1.02]`
const outlinePillCls = `${pillCls} border border-line/25 text-ink hover:bg-veil/10 ${pressCls}`

export default function CheckoutPage() {
  useReveal()
  usePageTitle('Checkout')
  const navigate = useNavigate()
  const cart = useCart()
  const { byId: productById } = useMerchCatalogue()
  const { settings } = useSiteSettings()
  // The payment methods the EB set on the portal's Merch page, or the shipped
  // ones (src/data/merchConfig.js) until that setting is read.
  const availablePaymentMethods = useMemo(
    () => paymentMethodsFrom(settings.merchPaymentMethods).filter((m) => m.available),
    [settings.merchPaymentMethods],
  )
  const count = cartCount(cart)
  const subtotal = cartSubtotal(cart)
  // Lines the cart store dropped because the EB removed or hid their product,
  // surfaced so the user isn't surprised by a smaller order.
  const droppedCount = cartDropped(cart)

  const [contact, setContact] = useState({
    name: '',
    email: '',
    phone: '',
    isMember: '',
    lc: '', // populated only when isMember === 'No'
    year: '',
    notes: '',
    website: '', // honeypot: hidden, stays blank for people
  })
  const [picked, setPaymentMethod] = useState('')
  // The buyer's pick, else the first method on offer (the list can change
  // under them when the live setting arrives).
  const paymentMethod = availablePaymentMethods.some((m) => m.id === picked)
    ? picked
    : availablePaymentMethods[0]?.id || ''
  const [screenshot, setScreenshot] = useState(null) // File | null
  const [screenshotError, setScreenshotError] = useState('')
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState(null) // { ok, reference, error }

  // Only redirect away if the page was loaded with an empty cart, i.e.
  // the user bookmarked /merch/checkout after a previous order. Don't
  // redirect when the cart empties as a side effect of a successful
  // submit: the cart store re-renders synchronously and would fire this
  // effect before the React setResult lands, bouncing the success page.
  const wasEmptyOnMount = useRef(count === 0)
  useEffect(() => {
    if (wasEmptyOnMount.current && count === 0 && !result?.ok) {
      navigate('/merch', { replace: true })
    }
  }, [count, result, navigate])

  // The EB closes orders from the portal (Merch); the database refuses an
  // order while they are closed, so this is only the polite half.
  if (settings.merchOrdersOpen === false) {
    return <OrdersClosed />
  }

  if (result?.ok) {
    return <OrderSuccess result={result} contact={contact} />
  }

  // Sets or clears one field's error and leaves the others as they are.
  const mark = (key, message) =>
    setErrors((prev) => {
      if ((prev[key] || '') === message) return prev
      const next = { ...prev }
      if (message) next[key] = message
      else delete next[key]
      return next
    })

  const updateContact = (key, value) => {
    setContact((c) => ({ ...c, [key]: value }))
    // A field already marked wrong is checked again on every change, so its
    // error goes the moment it is put right.
    if (errors[key]) mark(key, RULES[key]({ ...contact, [key]: value }))
  }

  // Leaving a field checks it there and then, without waiting for Place order.
  // An empty one is left alone: tabbing past a field is not a mistake yet, and
  // Place order catches whatever is still missing.
  const check = (key) => {
    if (contact[key].trim()) mark(key, RULES[key](contact))
  }

  // What the form's own markup cannot say about a field: that it is in error,
  // and which line of text says why.
  const fieldProps = (key) => ({
    onBlur: () => check(key),
    'aria-invalid': errors[key] ? true : undefined,
    'aria-describedby': errors[key] ? `${key}-error` : undefined,
  })

  const pickMember = (opt) => {
    setContact((c) => ({
      ...c,
      isMember: opt,
      // clear the LC field when switching back to "Yes"
      lc: opt === 'Yes' ? '' : c.lc,
    }))
    mark('isMember', '')
    // With "Yes" the committee question is gone, and its error with it.
    if (opt === 'Yes') mark('lc', '')
  }

  const selectedMethod = availablePaymentMethods.find((m) => m.id === paymentMethod)

  const validate = () => {
    const next = {}
    for (const key of Object.keys(RULES)) {
      const message = RULES[key](contact)
      if (message) next[key] = message
    }
    if (!screenshot)
      next.screenshot = `Upload the ${selectedMethod?.label || 'payment'} receipt`
    setErrors(next)
    return next
  }

  // Bring the first invalid field into view; on a long mobile form the
  // error text is often above the fold when the submit button is tapped.
  const focusFirstError = (next) => {
    const first = FIELD_ORDER.find((k) => next[k])
    if (!first) return
    const el = document.getElementById(first)
    if (!el) return
    // "AUSSS member?" is a group of two buttons, not one field: the first
    // button takes the focus.
    const target = el.matches('input, select, textarea') ? el : el.querySelector('button') || el
    el.scrollIntoView({ behavior: scrollBehavior(), block: 'center' })
    if (typeof target.focus === 'function') target.focus({ preventScroll: true })
  }

  const onScreenshotChange = (e) => {
    const file = e.target.files?.[0]
    setScreenshotError('')
    if (!file) {
      setScreenshot(null)
      return
    }
    if (!file.type.startsWith('image/')) {
      setScreenshotError('Please upload an image file')
      e.target.value = ''
      return
    }
    if (file.size > MAX_SCREENSHOT_MB * 1024 * 1024) {
      setScreenshotError(`Image must be under ${MAX_SCREENSHOT_MB} MB`)
      e.target.value = ''
      return
    }
    setScreenshot(file)
    // A receipt is chosen: "Upload the receipt" no longer applies.
    mark('screenshot', '')
  }

  const onSubmit = async (e) => {
    e.preventDefault()
    // The button is disabled while submitting, but an Enter-key implicit
    // submission can still fire, guard against double orders.
    if (submitting) return
    const invalid = validate()
    if (Object.keys(invalid).length > 0) {
      focusFirstError(invalid)
      return
    }
    // Take the last failure off the page, so a second one is read out again.
    setResult(null)
    setSubmitting(true)

    const payload = {
      contact,
      items: cart.items,
      subtotal,
      paymentMethod,
      screenshot,
    }

    const res = await submitOrder(payload)
    setSubmitting(false)
    setResult(res)
    if (res.ok) clearCart()
  }

  return (
    <article className="bg-page">
      <header className="container-prose pb-12 pt-32 sm:pt-40">
        <div className="reveal text-center">
          <span className="eyebrow justify-center">
            <span className="h-px w-8 bg-medical" />
            Checkout
            <span className="h-px w-8 bg-medical" />
          </span>
          <h1 className="heading-serif mt-5 text-4xl text-ink sm:text-5xl">
            Confirm your order
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base font-normal text-soft/75 dark:font-light">
            Tell us how to reach you. We&rsquo;ll confirm details and arrange
            pickup once production wraps.
          </p>
        </div>
      </header>

      <div className="container-prose pb-24">
        {droppedCount > 0 && (
          <p className="mx-auto mb-8 max-w-2xl rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-center text-sm text-warn">
            {droppedCount === 1
              ? 'One item in your cart is no longer available and was removed.'
              : `${droppedCount} items in your cart are no longer available and were removed.`}{' '}
            Please double-check your order below.
          </p>
        )}
        <div className="grid gap-10 lg:grid-cols-12">
          {/* Form */}
          <form
            onSubmit={onSubmit}
            noValidate
            className="relative space-y-10 lg:col-span-7"
          >
            <Honeypot value={contact.website} onChange={(v) => updateContact('website', v)} />
            {/* Contact */}
            <fieldset className="rounded-2xl border border-line/10 bg-sunk p-6 sm:p-8">
              <legend className="px-2 text-xs font-semibold uppercase tracking-[0.18em] text-accent">
                Your contact info
              </legend>

              <div className="mt-2 grid gap-5 sm:grid-cols-2">
                <Field
                  label="Full name *"
                  htmlFor="name"
                  error={errors.name}
                  span={2}
                >
                  <input
                    id="name"
                    type="text"
                    autoComplete="name"
                    required
                    value={contact.name}
                    onChange={(e) => updateContact('name', e.target.value)}
                    {...fieldProps('name')}
                    className={inputClass(errors.name)}
                  />
                </Field>

                <Field label="Email *" htmlFor="email" error={errors.email}>
                  <input
                    id="email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    required
                    value={contact.email}
                    onChange={(e) => updateContact('email', e.target.value)}
                    {...fieldProps('email')}
                    className={inputClass(errors.email)}
                  />
                </Field>

                <Field
                  label="WhatsApp / phone *"
                  htmlFor="phone"
                  error={errors.phone}
                >
                  <input
                    id="phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="01x xxxx xxxx"
                    required
                    value={contact.phone}
                    onChange={(e) => updateContact('phone', e.target.value)}
                    {...fieldProps('phone')}
                    className={inputClass(errors.phone)}
                  />
                </Field>

                <Field
                  label="AUSSS member? *"
                  htmlFor="isMember"
                  error={errors.isMember}
                  span={2}
                  group
                >
                  <div className="flex gap-2">
                    {['Yes', 'No'].map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => pickMember(opt)}
                        aria-pressed={contact.isMember === opt}
                        className={`min-h-[44px] flex-1 rounded-full border px-4 py-2 text-sm font-semibold ${pressCls} ${
                          contact.isMember === opt
                            ? 'border-medical bg-cta text-on-cta'
                            : 'border-line/15 text-soft/80 hover:border-line/30 hover:text-ink'
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </Field>

                {contact.isMember === 'No' && (
                  <Field
                    label="Which local committee are you from? *"
                    htmlFor="lc"
                    error={errors.lc}
                    span={2}
                  >
                    <input
                      id="lc"
                      type="text"
                      maxLength={60}
                      required
                      value={contact.lc}
                      onChange={(e) => updateContact('lc', e.target.value)}
                      {...fieldProps('lc')}
                      placeholder="e.g. Cairo, Alex, Mansoura, Helwan…"
                      className={inputClass(errors.lc)}
                    />
                  </Field>
                )}

                <Field
                  label="Year / status *"
                  htmlFor="year"
                  error={errors.year}
                  span={2}
                >
                  <select
                    id="year"
                    required
                    value={contact.year}
                    onChange={(e) => updateContact('year', e.target.value)}
                    {...fieldProps('year')}
                    className={inputClass(errors.year)}
                  >
                    <option value="" disabled>
                      Select…
                    </option>
                    {YEAR_OPTIONS.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field
                  label="Notes (optional)"
                  htmlFor="notes"
                  error={errors.notes}
                  span={2}
                >
                  <textarea
                    id="notes"
                    rows={3}
                    maxLength={MAX_NOTES_LENGTH}
                    value={contact.notes}
                    onChange={(e) =>
                      updateContact(
                        'notes',
                        e.target.value.slice(0, MAX_NOTES_LENGTH),
                      )
                    }
                    {...fieldProps('notes')}
                    className={inputClass(errors.notes) + ' resize-y'}
                  />
                  <span className="self-end text-2xs text-soft/55">
                    {contact.notes.length} / {MAX_NOTES_LENGTH}
                  </span>
                </Field>
              </div>
            </fieldset>

            {/* Payment */}
            <fieldset className="rounded-2xl border border-line/10 bg-sunk p-6 sm:p-8">
              <legend className="px-2 text-xs font-semibold uppercase tracking-[0.18em] text-accent">
                Payment method
              </legend>

              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {availablePaymentMethods.map((m) => (
                  <PaymentOption
                    key={m.id}
                    selected={paymentMethod === m.id}
                    onClick={() => setPaymentMethod(m.id)}
                    title={m.label}
                    hint={m.hint}
                  />
                ))}
              </div>

              <div className="mt-6">
                <DigitalPaymentPanel
                  method={selectedMethod}
                  total={subtotal}
                  screenshot={screenshot}
                  onChange={onScreenshotChange}
                  // What is wrong with the file just chosen comes before
                  // "Upload the receipt", which it also answers.
                  error={screenshotError || errors.screenshot}
                />
              </div>
            </fieldset>

            {/* The sentence comes whole from src/lib/orders.js: nothing is
                added after it. */}
            {result?.ok === false && (
              <p
                role="alert"
                className="rounded-xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-danger"
              >
                {result.error}
              </p>
            )}

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <Link
                to="/merch"
                className="inline-flex min-h-[44px] items-center gap-1 self-start text-sm font-semibold text-soft/70 transition-colors hover:text-ink sm:self-auto"
              >
                ← Back to merch
              </Link>
              <button
                type="submit"
                disabled={submitting}
                className={`gap-2 px-8 py-3.5 disabled:cursor-wait disabled:opacity-70 disabled:hover:scale-100 ${solidPillCls}`}
              >
                {submitting ? (
                  <>
                    <Spinner />
                    Submitting…
                  </>
                ) : (
                  <>
                    Place order · {formatEGP(subtotal)}
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Order summary */}
          <aside className="lg:col-span-5">
            <div className="sticky top-32 rounded-2xl border border-line/10 bg-card p-6 sm:p-8">
              <h2 className="heading-serif text-xl text-ink">Your order</h2>
              <ul className="mt-5 divide-y divide-line/10">
                {cart.items.map((it) => {
                  const p = productById[it.productId]
                  if (!p) return null
                  return (
                    <li
                      key={`${it.productId}::${it.size}::${it.design}`}
                      className="flex gap-4 py-4"
                    >
                      {p.image ? (
                        <img
                          src={p.image}
                          alt=""
                          className="h-20 w-16 flex-shrink-0 rounded-md object-cover"
                        />
                      ) : (
                        <span className="h-20 w-16 flex-shrink-0 rounded-md bg-sunk" aria-hidden="true" />
                      )}
                      <div className="flex flex-1 flex-col">
                        <span className="text-sm font-semibold text-ink">
                          {p.name}
                        </span>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-2xs uppercase tracking-[0.12em] text-soft/60">
                          {it.size && <span>Size: {it.size}</span>}
                          {it.design && <span>Design: {it.design}</span>}
                          <span>Qty: {it.qty}</span>
                        </div>
                        <span className="mt-2 text-sm font-semibold text-accent">
                          {formatEGP(p.price * it.qty)}
                        </span>
                      </div>
                    </li>
                  )
                })}
              </ul>

              <div className="mt-5 flex items-baseline justify-between border-t border-line/10 pt-5">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-soft/70">
                  Subtotal
                </span>
                <span className="heading-serif text-2xl text-ink">
                  {formatEGP(subtotal)}
                </span>
              </div>

              <p className="mt-3 text-xs leading-relaxed text-soft/55">
                All items are made to order. We collect orders, run production,
                then arrange pickup. What you pay for is what you get.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </article>
  )
}

// ── Bits ─────────────────────────────────────────────────────────────────

// Under a finger a field is at least 44px tall (in px, not rem, since the root
// size shrinks on a 320px phone); under a mouse it keeps the height it had.
function inputClass(error) {
  return `w-full rounded-lg border bg-page px-3.5 py-2.5 text-sm text-ink placeholder:text-soft/40 transition-colors focus:outline-none focus:ring-2 focus:ring-medical/60 [@media(pointer:coarse)]:min-h-[44px] ${
    error
      ? 'border-red-400/50'
      : 'border-line/15 hover:border-line/25'
  }`
}

// The label holds the field's name and nothing else. When it wrapped the whole
// block, the error and the character count were read out as part of the name.
//
// `group` mode is for fields whose control isn't a single labelable element
// (e.g. a row of toggle buttons): renders a role="group" labelled by the text
// instead of a <label htmlFor> that browsers would silently ignore. The group
// carries the id, so the page can still find the field when it is in error.
function Field({ label, htmlFor, error, span = 1, group = false, children }) {
  const errorId = error ? `${htmlFor}-error` : undefined
  const cls = `flex flex-col gap-1.5 ${span === 2 ? 'sm:col-span-2' : ''}`
  const labelCls = 'text-xs font-semibold uppercase tracking-[0.14em] text-soft/70'
  const errorNode = error && (
    <span id={errorId} role="alert" className="text-xs text-danger">
      {error}
    </span>
  )
  if (group) {
    return (
      <div
        id={htmlFor}
        role="group"
        aria-labelledby={`${htmlFor}-label`}
        aria-describedby={errorId}
        className={cls}
      >
        <span id={`${htmlFor}-label`} className={labelCls}>
          {label}
        </span>
        {children}
        {errorNode}
      </div>
    )
  }
  return (
    <div className={cls}>
      <label htmlFor={htmlFor} className={labelCls}>
        {label}
      </label>
      {children}
      {errorNode}
    </div>
  )
}

function PaymentOption({ selected, onClick, title, hint }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-[background-color,border-color,transform] duration-150 ease-out motion-safe:active:scale-[0.985] ${
        selected
          ? 'border-medical bg-medical/10'
          : 'border-line/15 hover:border-line/30'
      }`}
    >
      <span
        className={`mt-0.5 grid h-5 w-5 flex-shrink-0 place-items-center rounded-full border-2 ${
          selected ? 'border-medical' : 'border-line/30'
        }`}
      >
        {selected && <span className="h-2.5 w-2.5 rounded-full bg-medical" />}
      </span>
      <span className="flex flex-col">
        <span className="text-sm font-semibold text-ink">{title}</span>
        <span className="text-xs text-soft/65">{hint}</span>
      </span>
    </button>
  )
}

function DigitalPaymentPanel({ method, total, screenshot, onChange, error }) {
  if (!method) return null
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line/10 bg-page p-5 text-sm leading-relaxed text-soft/80">
        <p>
          Send <strong className="text-ink">{formatEGP(total)}</strong>{' '}
          via <strong className="text-ink">{method.label}</strong> to:
        </p>

        <div className="mt-3">
          {method.type === 'link' && <LinkValue method={method} />}
          {method.type === 'handle' && <CopyableValue value={method.value} />}
          {method.type === 'phone' && <CopyableValue value={method.value} />}
        </div>

        <p className="mt-4 text-xs text-soft/55">
          Once you&rsquo;ve paid, upload the receipt screenshot below.
        </p>
      </div>

      <Field
        label="Payment screenshot *"
        htmlFor="screenshot"
        error={error}
        span={2}
      >
        <div className="flex flex-col gap-2">
          <input
            id="screenshot"
            type="file"
            accept="image/*"
            required
            onChange={onChange}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'screenshot-error' : undefined}
            className="block w-full text-sm text-soft/80 file:mr-4 file:cursor-pointer file:rounded-full file:border-0 file:bg-solid file:px-4 file:py-2 file:text-sm file:font-semibold file:text-on-solid file:transition-colors file:duration-150 hover:file:bg-solid-hover [@media(pointer:coarse)]:file:min-h-[44px]"
          />
          {screenshot && (
            <span className="text-xs text-soft/60">
              Selected:{' '}
              <strong className="text-soft/80">{screenshot.name}</strong> (
              {(screenshot.size / 1024).toFixed(0)} KB)
            </span>
          )}
        </div>
      </Field>
    </div>
  )
}

function LinkValue({ method }) {
  // Strip protocol for display; keep the full URL as the href.
  const display = method.value.replace(/^https?:\/\//, '')
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <a
        href={method.value}
        target="_blank"
        rel="noopener noreferrer"
        className={`gap-2 px-5 py-2.5 ${ctaPillCls}`}
      >
        Pay via {method.label}
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M7 17 17 7M9 7h8v8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </a>
      <span className="break-all font-mono text-xs text-soft/55">
        {display}
      </span>
    </div>
  )
}

function CopyableValue({ value }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (_) {
      // Older browsers, let users copy manually.
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="break-all font-mono text-base text-accent">
        {value}
      </span>
      {/* A small pill with a thumb's 44px to land on: an unseen ::after reaches
          past its edges. In px, not rem, since the root size shrinks on a
          320px phone. */}
      <button
        type="button"
        onClick={copy}
        className={`relative inline-flex items-center gap-1.5 rounded-full border border-line/15 px-3 py-1 text-2xs font-semibold uppercase tracking-[0.14em] text-soft/80 after:absolute after:left-1/2 after:top-1/2 after:h-[44px] after:w-full after:min-w-[44px] after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] hover:border-line/30 hover:text-ink ${pressCls}`}
      >
        {copied ? (
          <>
            <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path d="M5 12l4 4 10-10" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Copied
          </>
        ) : (
          'Copy'
        )}
      </button>
      {/* A button's changed label is not read out by itself. */}
      <span className="sr-only" role="status">
        {copied ? 'Copied' : ''}
      </span>
    </div>
  )
}

// An off-screen field people never see; a bot that fills it is quietly ignored
// by the database.
function Honeypot({ value, onChange }) {
  return (
    <div className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
      <label htmlFor="website">Website</label>
      <input
        id="website"
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

function Spinner() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4 animate-spin"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      aria-hidden="true"
    >
      <path d="M12 3a9 9 0 1 0 9 9" strokeLinecap="round" />
    </svg>
  )
}

function OrderSuccess({ result, contact }) {
  // The form, and the Place order button that had the focus, are gone. The
  // heading takes the focus, so a screen reader says the order went through
  // and the page stands at this card and not where the long form had been
  // scrolled to. A jump, not a glide: this is another screen, not a place
  // further up the same one.
  const headingRef = useRef(null)
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
    headingRef.current?.focus({ preventScroll: true })
  }, [])

  return (
    <article className="bg-page">
      <div className="container-prose pt-32 pb-24 sm:pt-40">
        <div className="mx-auto max-w-xl rounded-2xl border border-medical/30 bg-sunk p-8 text-center sm:p-12">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-medical/15 text-accent">
            <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M5 12l4 4 10-10" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="heading-serif mt-6 text-3xl text-ink focus:outline-none sm:text-4xl"
          >
            Order received
          </h1>
          <p className="mt-4 text-base text-soft/75">
            Thanks{contact.name ? `, ${contact.name.split(' ')[0]}` : ''}!
            We&rsquo;ll be in touch shortly to confirm details.
          </p>
          <div className="mt-7 inline-flex flex-col items-center gap-1 rounded-xl border border-line/10 bg-page px-6 py-4">
            <span className="text-2xs font-semibold uppercase tracking-[0.18em] text-soft/55">
              Order reference
            </span>
            <span className="font-mono text-lg text-accent">
              {result.reference}
            </span>
          </div>
          {result.receiptAttached === false && (
            <p
              role="alert"
              className="mx-auto mt-5 max-w-sm rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-xs leading-relaxed text-warn"
            >
              Your order is in, but the receipt screenshot did not upload. Please{' '}
              <Link to="/contact" className="font-semibold underline">
                send it to us
              </Link>{' '}
              with this reference so we can match your payment.
            </p>
          )}
          <p className="mx-auto mt-4 max-w-sm text-xs leading-relaxed text-soft/55">
            Keep this reference. If you don&rsquo;t hear from us within 48
            hours,{' '}
            <Link to="/contact" className="font-semibold text-accent hover:text-ink">
              reach out
            </Link>{' '}
            and mention it so we can find your order.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link to="/merch" className={`w-full px-6 py-3 sm:w-auto ${solidPillCls}`}>
              Back to merch
            </Link>
            <Link to="/" className={`w-full px-6 py-3 sm:w-auto ${outlinePillCls}`}>
              Home
            </Link>
          </div>
        </div>
      </div>
    </article>
  )
}

function OrdersClosed() {
  return (
    <article className="bg-page">
      <div className="container-prose pt-32 pb-24 sm:pt-40">
        <div className="mx-auto max-w-xl rounded-2xl border border-line/10 bg-sunk p-8 text-center sm:p-12">
          <h1 className="heading-serif text-3xl text-ink sm:text-4xl">
            Orders are closed
          </h1>
          <p className="mt-4 text-base text-soft/75">
            We&rsquo;re between drops right now. Follow our channels to hear
            when orders open again.
          </p>
          <Link to="/merch" className={`mt-7 px-6 py-3 ${solidPillCls}`}>
            Back to merch
          </Link>
        </div>
      </div>
    </article>
  )
}
