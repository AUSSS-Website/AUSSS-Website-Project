import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import useReveal from '../hooks/useReveal.js'
import usePageTitle from '../hooks/usePageTitle.js'
import {
  useCart,
  cartSubtotal,
  cartCount,
  clearCart,
  formatEGP,
  takeDroppedLines,
} from '../lib/cart.js'
import { productById } from '../data/merchProducts.js'
import { submitOrder, fileToBase64 } from '../lib/orders.js'
import {
  ORDERS_OPEN,
  availablePaymentMethods,
  paymentMethodById,
} from '../data/merchConfig.js'

const YEAR_OPTIONS = [
  '1st year',
  '2nd year',
  '3rd year',
  '4th year',
  '5th year',
  '6th year',
  'Intern',
  'Resident / Graduate',
  'Other / External',
]

const MAX_SCREENSHOT_MB = 5
const MAX_NOTES_LENGTH = 280

export default function CheckoutPage() {
  useReveal()
  usePageTitle('Checkout')
  const navigate = useNavigate()
  const cart = useCart()
  const count = cartCount(cart)
  const subtotal = cartSubtotal(cart)
  // Lines the cart store dropped because their product left the catalogue,
  // surfaced once so the user isn't surprised by a smaller order.
  const [droppedCount] = useState(() => takeDroppedLines().length)

  const [contact, setContact] = useState({
    name: '',
    email: '',
    phone: '',
    isMember: '',
    lc: '', // populated only when isMember === 'No'
    year: '',
    notes: '',
  })
  const [paymentMethod, setPaymentMethod] = useState(
    availablePaymentMethods[0]?.id || '',
  )
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

  if (!ORDERS_OPEN) {
    return <OrdersClosed />
  }

  if (result?.ok) {
    return <OrderSuccess result={result} contact={contact} />
  }

  const updateContact = (key, value) =>
    setContact((c) => ({ ...c, [key]: value }))

  const selectedMethod = paymentMethodById[paymentMethod]

  const validate = () => {
    const next = {}
    if (!contact.name.trim()) next.name = 'Required'
    if (!contact.email.trim() || !/^\S+@\S+\.\S+$/.test(contact.email))
      next.email = 'Enter a valid email'
    // Numbers in local Egyptian format must be a full mobile (01x + 8 digits);
    // anything else (international WhatsApp) just needs a plausible length.
    const phoneDigits = contact.phone.replace(/\D/g, '')
    const phoneOk = phoneDigits.startsWith('0')
      ? /^01[0125][0-9]{8}$/.test(phoneDigits)
      : phoneDigits.length >= 10
    if (!contact.phone.trim() || !phoneOk)
      next.phone = 'Enter a valid phone / WhatsApp number (e.g. 01x xxxx xxxx)'
    if (!contact.isMember) next.isMember = 'Pick one'
    if (contact.isMember === 'No' && !contact.lc.trim())
      next.lc = 'Tell us which local committee'
    if (!contact.year) next.year = 'Pick one'
    if (contact.notes.length > MAX_NOTES_LENGTH)
      next.notes = `Keep it under ${MAX_NOTES_LENGTH} characters`
    if (!screenshot)
      next.screenshot = `Upload the ${selectedMethod?.label || 'payment'} receipt`
    setErrors(next)
    return next
  }

  // Bring the first invalid field into view; on a long mobile form the
  // error text is often above the fold when the submit button is tapped.
  const FIELD_ORDER = ['name', 'email', 'phone', 'isMember', 'lc', 'year', 'notes', 'screenshot']
  const focusFirstError = (next) => {
    const first = FIELD_ORDER.find((k) => next[k])
    if (!first) return
    const el = document.getElementById(first)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    if (typeof el.focus === 'function') el.focus({ preventScroll: true })
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
    setSubmitting(true)

    let screenshotBase64
    try {
      if (screenshot) {
        screenshotBase64 = await fileToBase64(screenshot)
      }
    } catch (err) {
      setSubmitting(false)
      setResult({ ok: false, error: 'Could not read screenshot. Try again.' })
      return
    }

    const payload = {
      contact,
      items: cart.items,
      subtotal,
      paymentMethod,
      screenshotBase64,
      screenshotFilename: screenshot?.name,
    }

    const res = await submitOrder(payload)
    setSubmitting(false)
    setResult(res)
    if (res.ok) clearCart()
  }

  return (
    <article className="bg-forest-950">
      <header className="container-prose pb-12 pt-32 sm:pt-40">
        <div className="reveal text-center">
          <span className="eyebrow justify-center">
            <span className="h-px w-8 bg-medical" />
            Checkout
            <span className="h-px w-8 bg-medical" />
          </span>
          <h1 className="heading-serif mt-5 text-4xl text-white sm:text-5xl">
            Confirm your pre-order
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base font-light text-silver/75">
            Tell us how to reach you. We&rsquo;ll confirm details and arrange
            pickup once production wraps.
          </p>
        </div>
      </header>

      <div className="container-prose pb-24">
        {droppedCount > 0 && (
          <p className="mx-auto mb-8 max-w-2xl rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-center text-sm text-amber-200">
            {droppedCount === 1
              ? 'One item from a previous visit is no longer available and was removed from your cart.'
              : `${droppedCount} items from a previous visit are no longer available and were removed from your cart.`}{' '}
            Please double-check your order below.
          </p>
        )}
        <div className="grid gap-10 lg:grid-cols-12">
          {/* Form */}
          <form
            onSubmit={onSubmit}
            noValidate
            className="space-y-10 lg:col-span-7"
          >
            {/* Contact */}
            <fieldset className="rounded-2xl border border-white/10 bg-forest-900 p-6 sm:p-8">
              <legend className="px-2 text-xs font-semibold uppercase tracking-[0.18em] text-medical-light">
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
                    value={contact.name}
                    onChange={(e) => updateContact('name', e.target.value)}
                    className={inputClass(errors.name)}
                  />
                </Field>

                <Field label="Email *" htmlFor="email" error={errors.email}>
                  <input
                    id="email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    value={contact.email}
                    onChange={(e) => updateContact('email', e.target.value)}
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
                    value={contact.phone}
                    onChange={(e) => updateContact('phone', e.target.value)}
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
                        onClick={() =>
                          setContact((c) => ({
                            ...c,
                            isMember: opt,
                            // clear the LC field when switching back to "Yes"
                            lc: opt === 'Yes' ? '' : c.lc,
                          }))
                        }
                        aria-pressed={contact.isMember === opt}
                        className={`flex-1 rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${
                          contact.isMember === opt
                            ? 'border-medical bg-medical text-forest-950'
                            : 'border-white/15 text-silver/80 hover:border-white/30 hover:text-white'
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
                      value={contact.lc}
                      onChange={(e) => updateContact('lc', e.target.value)}
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
                    value={contact.year}
                    onChange={(e) => updateContact('year', e.target.value)}
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
                    className={inputClass(errors.notes) + ' resize-y'}
                  />
                  <span className="self-end text-[11px] text-silver/55">
                    {contact.notes.length} / {MAX_NOTES_LENGTH}
                  </span>
                </Field>
              </div>
            </fieldset>

            {/* Payment */}
            <fieldset className="rounded-2xl border border-white/10 bg-forest-900 p-6 sm:p-8">
              <legend className="px-2 text-xs font-semibold uppercase tracking-[0.18em] text-medical-light">
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
                  error={errors.screenshot || screenshotError}
                />
              </div>
            </fieldset>

            {result?.ok === false && (
              <p className="rounded-xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">
                {result.error}. Please try again or contact us if it keeps
                failing.
              </p>
            )}

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <Link
                to="/merch"
                className="inline-flex items-center gap-1 text-sm font-semibold text-silver/70 transition-colors hover:text-white"
              >
                ← Back to merch
              </Link>
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-8 py-3.5 text-sm font-semibold text-forest transition-transform hover:scale-[1.02] disabled:cursor-wait disabled:opacity-70"
              >
                {submitting ? (
                  <>
                    <Spinner />
                    Submitting…
                  </>
                ) : (
                  <>
                    Place pre-order · {formatEGP(subtotal)}
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Order summary */}
          <aside className="lg:col-span-5">
            <div className="sticky top-32 rounded-2xl border border-white/10 bg-forest-800 p-6 sm:p-8">
              <h2 className="heading-serif text-xl text-white">Your order</h2>
              <ul className="mt-5 divide-y divide-white/10">
                {cart.items.map((it) => {
                  const p = productById[it.productId]
                  if (!p) return null
                  return (
                    <li
                      key={`${it.productId}::${it.size}::${it.design}`}
                      className="flex gap-4 py-4"
                    >
                      <img
                        src={p.image}
                        alt=""
                        className="h-20 w-16 flex-shrink-0 rounded-md object-cover"
                      />
                      <div className="flex flex-1 flex-col">
                        <span className="text-sm font-semibold text-white">
                          {p.name}
                        </span>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] uppercase tracking-[0.12em] text-silver/60">
                          {it.size && <span>Size: {it.size}</span>}
                          {it.design && <span>Design: {it.design}</span>}
                          <span>Qty: {it.qty}</span>
                        </div>
                        <span className="mt-2 text-sm font-semibold text-medical-light">
                          {formatEGP(p.price * it.qty)}
                        </span>
                      </div>
                    </li>
                  )
                })}
              </ul>

              <div className="mt-5 flex items-baseline justify-between border-t border-white/10 pt-5">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-silver/70">
                  Subtotal
                </span>
                <span className="heading-serif text-2xl text-white">
                  {formatEGP(subtotal)}
                </span>
              </div>

              <p className="mt-3 text-xs leading-relaxed text-silver/55">
                All items are pre-orders. We collect orders, run production,
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

function inputClass(error) {
  return `w-full rounded-lg border bg-forest-950 px-3.5 py-2.5 text-sm text-white placeholder:text-silver/40 transition-colors focus:outline-none focus:ring-2 focus:ring-medical/60 ${
    error
      ? 'border-red-400/50'
      : 'border-white/15 hover:border-white/25'
  }`
}

// `group` mode is for fields whose control isn't a single labelable element
// (e.g. a row of toggle buttons): renders a role="group" labelled by the text
// instead of a <label htmlFor> that browsers would silently ignore.
function Field({ label, htmlFor, error, span = 1, group = false, children }) {
  const errorId = error ? `${htmlFor}-error` : undefined
  const cls = `flex flex-col gap-1.5 ${span === 2 ? 'sm:col-span-2' : ''}`
  const labelText = (
    <span className="text-xs font-semibold uppercase tracking-[0.14em] text-silver/70">
      {label}
    </span>
  )
  const errorNode = error && (
    <span id={errorId} role="alert" className="text-xs text-red-300">
      {error}
    </span>
  )
  if (group) {
    return (
      <div
        role="group"
        aria-labelledby={`${htmlFor}-label`}
        aria-describedby={errorId}
        className={cls}
      >
        <span id={`${htmlFor}-label`}>{labelText}</span>
        {children}
        {errorNode}
      </div>
    )
  }
  return (
    <label htmlFor={htmlFor} className={cls}>
      {labelText}
      {children}
      {errorNode}
    </label>
  )
}

function PaymentOption({ selected, onClick, title, hint }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-colors ${
        selected
          ? 'border-medical bg-medical/10'
          : 'border-white/15 hover:border-white/30'
      }`}
    >
      <span
        className={`mt-0.5 grid h-5 w-5 flex-shrink-0 place-items-center rounded-full border-2 ${
          selected ? 'border-medical' : 'border-white/30'
        }`}
      >
        {selected && <span className="h-2.5 w-2.5 rounded-full bg-medical" />}
      </span>
      <span className="flex flex-col">
        <span className="text-sm font-semibold text-white">{title}</span>
        <span className="text-xs text-silver/65">{hint}</span>
      </span>
    </button>
  )
}

function DigitalPaymentPanel({ method, total, screenshot, onChange, error }) {
  if (!method) return null
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-white/10 bg-forest-950 p-5 text-sm leading-relaxed text-silver/80">
        <p>
          Send <strong className="text-white">{formatEGP(total)}</strong>{' '}
          via <strong className="text-white">{method.label}</strong> to:
        </p>

        <div className="mt-3">
          {method.type === 'link' && <LinkValue method={method} />}
          {method.type === 'handle' && <CopyableValue value={method.value} />}
          {method.type === 'phone' && <CopyableValue value={method.value} />}
        </div>

        <p className="mt-4 text-xs text-silver/55">
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
            onChange={onChange}
            className="block w-full text-sm text-silver/80 file:mr-4 file:rounded-full file:border-0 file:bg-white file:px-4 file:py-2 file:text-sm file:font-semibold file:text-forest hover:file:bg-silver-light"
          />
          {screenshot && (
            <span className="text-xs text-silver/60">
              Selected:{' '}
              <strong className="text-silver/80">{screenshot.name}</strong> (
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
        className="inline-flex items-center justify-center gap-2 rounded-full bg-medical px-5 py-2.5 text-sm font-semibold text-forest-950 transition-transform hover:scale-[1.02]"
      >
        Pay via {method.label}
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M7 17 17 7M9 7h8v8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </a>
      <span className="break-all font-mono text-xs text-silver/55">
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
      <span className="break-all font-mono text-base text-medical-light">
        {value}
      </span>
      <button
        type="button"
        onClick={copy}
        className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-silver/80 transition-colors hover:border-white/30 hover:text-white"
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
  return (
    <article className="bg-forest-950">
      <div className="container-prose pt-32 pb-24 sm:pt-40">
        <div className="mx-auto max-w-xl rounded-2xl border border-medical/30 bg-forest-900 p-8 text-center sm:p-12">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-medical/15 text-medical-light">
            <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12l4 4 10-10" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h1 className="heading-serif mt-6 text-3xl text-white sm:text-4xl">
            Pre-order received
          </h1>
          <p className="mt-4 text-base text-silver/75">
            Thanks{contact.name ? `, ${contact.name.split(' ')[0]}` : ''}!
            We&rsquo;ll be in touch shortly to confirm details.
          </p>
          <div className="mt-7 inline-flex flex-col items-center gap-1 rounded-xl border border-white/10 bg-forest-950 px-6 py-4">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-silver/55">
              Order reference
            </span>
            <span className="font-mono text-lg text-medical-light">
              {result.reference}
            </span>
          </div>
          <p className="mx-auto mt-4 max-w-sm text-xs leading-relaxed text-silver/55">
            Keep this reference. If you don&rsquo;t hear from us within 48
            hours,{' '}
            <Link to="/contact" className="font-semibold text-medical-light hover:text-white">
              reach out
            </Link>{' '}
            and mention it so we can find your order.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link
              to="/merch"
              className="w-full rounded-full bg-white px-6 py-3 text-sm font-semibold text-forest transition-transform hover:scale-[1.02] sm:w-auto"
            >
              Back to merch
            </Link>
            <Link
              to="/"
              className="w-full rounded-full border border-white/25 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10 sm:w-auto"
            >
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
    <article className="bg-forest-950">
      <div className="container-prose pt-32 pb-24 sm:pt-40">
        <div className="mx-auto max-w-xl rounded-2xl border border-white/10 bg-forest-900 p-8 text-center sm:p-12">
          <h1 className="heading-serif text-3xl text-white sm:text-4xl">
            Pre-orders are closed
          </h1>
          <p className="mt-4 text-base text-silver/75">
            We&rsquo;re between drops right now. Follow our channels to hear
            when the next pre-order window opens.
          </p>
          <Link
            to="/merch"
            className="mt-7 inline-flex rounded-full bg-white px-6 py-3 text-sm font-semibold text-forest transition-transform hover:scale-[1.02]"
          >
            Back to merch
          </Link>
        </div>
      </div>
    </article>
  )
}
