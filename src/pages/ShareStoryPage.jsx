import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import useReveal from '../hooks/useReveal.js'
import usePageTitle from '../hooks/usePageTitle.js'
import useLeaveWarning from '../hooks/useLeaveWarning.js'
import { submitStory } from '../lib/stories.js'
import { STORIES_OPEN } from '../data/storiesConfig.js'
import { pressCls, scrollBehavior } from '../lib/motion.js'

const PROGRAMME_OPTIONS = [
  'SCOPE: Professional (clinical) exchange',
  'SCORE: Research exchange',
  'Other / not sure',
]

const MAX_STORY_LENGTH = 2500

// One rule for each field that can be wrong. Each answers with the words to
// show under the field, or with nothing when the field is fine. The same rules
// run when a field is left, while a flagged field is being put right, and for
// the whole form on Send.
const RULES = {
  name: (f) => (f.name.trim() ? '' : 'Required'),
  email: (f) =>
    f.email.trim() && /^\S+@\S+\.\S+$/.test(f.email) ? '' : 'Enter a valid email',
  phone: (f) =>
    f.phone.trim() && f.phone.replace(/\D/g, '').length >= 8
      ? ''
      : 'Enter a valid phone / WhatsApp number',
  story: (f) => {
    if (f.story.length > MAX_STORY_LENGTH) return `Keep it under ${MAX_STORY_LENGTH} characters`
    return f.story.trim().length >= 30
      ? ''
      : 'Tell us a little more, at least a couple of sentences'
  },
}
// The order the fields come in on the page, to find the first one in error.
const FIELD_ORDER = ['name', 'email', 'phone', 'story']

// The two pills of this page: the green one and the outlined one. Colours ease
// and the pill sinks a little when pressed (pressCls); the small growth under
// the pointer is left out for a reader who asked for less motion. The least
// height is in px: the padding is in rem, and the root size shrinks on a 320px
// phone, which left a pill a little under the 44px a thumb needs.
const pillCls = 'inline-flex min-h-[44px] items-center justify-center rounded-full text-sm font-semibold'
const solidPillCls = `${pillCls} bg-solid text-on-solid hover:bg-solid-hover ${pressCls} motion-safe:hover:scale-[1.02]`
const outlinePillCls = `${pillCls} border border-line/25 text-ink hover:bg-veil/10 ${pressCls}`

export default function ShareStoryPage() {
  usePageTitle('Share your story')
  useReveal()

  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    destination: '',
    programme: '',
    year: '',
    story: '',
    website: '', // honeypot: hidden, stays blank for people
  })
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState(null) // { ok, reference, error }

  // A story takes a while to write: ask before a reload or a closed tab throws
  // it away. Once it has been sent there is nothing left to lose.
  useLeaveWarning(STORIES_OPEN && form.story.trim() !== '' && !result?.ok)

  if (!STORIES_OPEN) {
    return <StoriesClosed />
  }

  if (result?.ok) {
    return <StorySuccess result={result} name={form.name} />
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

  const update = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }))
    // A field already marked wrong is checked again on every change, so its
    // error goes the moment it is put right.
    if (errors[key]) mark(key, RULES[key]({ ...form, [key]: value }))
  }

  // Leaving a field checks it there and then, without waiting for Send. An
  // empty one is left alone: tabbing past a field is not a mistake yet, and
  // Send catches whatever is still missing.
  const check = (key) => {
    if (form[key].trim()) mark(key, RULES[key](form))
  }

  // What the form's own markup cannot say about a field: that it is in error,
  // and which line of text says why.
  const fieldProps = (key) => ({
    onBlur: () => check(key),
    'aria-invalid': errors[key] ? true : undefined,
    'aria-describedby': errors[key] ? `${key}-error` : undefined,
  })

  const validate = () => {
    const next = {}
    for (const key of FIELD_ORDER) {
      const message = RULES[key](form)
      if (message) next[key] = message
    }
    setErrors(next)
    return next
  }

  // Bring the first field in error into view and put the caret in it; on a
  // phone it is often off the top of the screen when Send is tapped.
  const focusFirstError = (next) => {
    const first = FIELD_ORDER.find((k) => next[k])
    const el = first ? document.getElementById(first) : null
    if (!el) return
    el.scrollIntoView({ behavior: scrollBehavior(), block: 'center' })
    el.focus({ preventScroll: true })
  }

  const onSubmit = async (e) => {
    e.preventDefault()
    // The button is disabled while sending, but Enter in a field can still
    // submit the form a second time.
    if (submitting) return
    const invalid = validate()
    if (Object.keys(invalid).length > 0) {
      focusFirstError(invalid)
      return
    }
    // Take the last failure off the page, so a second one is read out again.
    setResult(null)
    setSubmitting(true)
    const res = await submitStory(form)
    setSubmitting(false)
    setResult(res)
  }

  return (
    <article className="bg-page">
      <header className="container-prose pb-12 pt-32 sm:pt-40">
        <div className="reveal text-center">
          <span className="eyebrow justify-center">
            <span className="h-px w-8 bg-medical" />
            Exchange stories
            <span className="h-px w-8 bg-medical" />
          </span>
          <h1 className="heading-serif mt-5 text-4xl text-ink sm:text-5xl">
            Share your exchange story
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base font-normal text-soft/75 dark:font-light">
            Been on a SCOPE or SCORE exchange with AUSSS? Tell us what it was
            like. With your permission, we may feature it on the exchange pages
            for the next round of students.
          </p>
        </div>
      </header>

      <div className="container-prose pb-24">
        <form
          onSubmit={onSubmit}
          noValidate
          className="relative mx-auto max-w-2xl space-y-10"
        >
          <Honeypot value={form.website} onChange={(v) => update('website', v)} />
          {/* Who you are */}
          <fieldset className="rounded-2xl border border-line/10 bg-sunk p-6 sm:p-8">
            <legend className="px-2 text-xs font-semibold uppercase tracking-[0.18em] text-accent">
              About you
            </legend>

            <div className="mt-2 grid gap-5 sm:grid-cols-2">
              <Field label="Full name *" htmlFor="name" error={errors.name} span={2}>
                <input
                  id="name"
                  type="text"
                  autoComplete="name"
                  required
                  value={form.name}
                  onChange={(e) => update('name', e.target.value)}
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
                  value={form.email}
                  onChange={(e) => update('email', e.target.value)}
                  {...fieldProps('email')}
                  className={inputClass(errors.email)}
                />
              </Field>

              <Field label="WhatsApp / phone *" htmlFor="phone" error={errors.phone}>
                <input
                  id="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="01x xxxx xxxx"
                  required
                  value={form.phone}
                  onChange={(e) => update('phone', e.target.value)}
                  {...fieldProps('phone')}
                  className={inputClass(errors.phone)}
                />
              </Field>
            </div>
          </fieldset>

          {/* The exchange */}
          <fieldset className="rounded-2xl border border-line/10 bg-sunk p-6 sm:p-8">
            <legend className="px-2 text-xs font-semibold uppercase tracking-[0.18em] text-accent">
              Your exchange
            </legend>

            <div className="mt-2 grid gap-5 sm:grid-cols-2">
              <Field
                label="Where did you go? (optional)"
                htmlFor="destination"
              >
                <input
                  id="destination"
                  type="text"
                  maxLength={80}
                  placeholder="e.g. Oman, Spain, Brazil…"
                  value={form.destination}
                  onChange={(e) => update('destination', e.target.value)}
                  className={inputClass()}
                />
              </Field>

              <Field label="Year (optional)" htmlFor="year">
                <input
                  id="year"
                  type="text"
                  maxLength={20}
                  placeholder="e.g. 2025"
                  value={form.year}
                  onChange={(e) => update('year', e.target.value)}
                  className={inputClass()}
                />
              </Field>

              <Field label="Programme (optional)" htmlFor="programme" span={2}>
                <select
                  id="programme"
                  value={form.programme}
                  onChange={(e) => update('programme', e.target.value)}
                  className={inputClass()}
                >
                  <option value="">Select…</option>
                  {PROGRAMME_OPTIONS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Your story *" htmlFor="story" error={errors.story} span={2}>
                <textarea
                  id="story"
                  rows={8}
                  maxLength={MAX_STORY_LENGTH}
                  placeholder="What did you do, what did you learn, what surprised you? The little moments are the best ones."
                  required
                  value={form.story}
                  onChange={(e) =>
                    update('story', e.target.value.slice(0, MAX_STORY_LENGTH))
                  }
                  {...fieldProps('story')}
                  className={inputClass(errors.story) + ' resize-y'}
                />
                <span className="self-end text-2xs text-soft/55">
                  {form.story.length} / {MAX_STORY_LENGTH}
                </span>
              </Field>
            </div>
          </fieldset>

          {/* The sentence comes whole from src/lib/stories.js: nothing is
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
              to="/exchange"
              className="inline-flex min-h-[44px] items-center gap-1 self-start text-sm font-semibold text-soft/70 transition-colors hover:text-ink sm:self-auto"
            >
              ← Back to exchange
            </Link>
            <button
              type="submit"
              disabled={submitting}
              className={`gap-2 px-8 py-3.5 disabled:cursor-wait disabled:opacity-70 disabled:hover:scale-100 ${solidPillCls}`}
            >
              {submitting ? (
                <>
                  <Spinner />
                  Sending…
                </>
              ) : (
                'Send my story'
              )}
            </button>
          </div>
        </form>
      </div>
    </article>
  )
}

// ── Bits ─────────────────────────────────────────────────────────────────

// Under a finger a field is at least 44px tall (in px, not rem, since the root
// size shrinks on a 320px phone); under a mouse it keeps the height it had.
function inputClass(error) {
  return `w-full rounded-lg border bg-page px-3.5 py-2.5 text-sm text-ink placeholder:text-soft/40 transition-colors focus:outline-none focus:ring-2 focus:ring-medical/60 [@media(pointer:coarse)]:min-h-[44px] ${
    error ? 'border-red-400/50' : 'border-line/15 hover:border-line/25'
  }`
}

// The label holds the field's name and nothing else. When it wrapped the whole
// block, the error and the character count were read out as part of the name.
function Field({ label, htmlFor, error, span = 1, children }) {
  return (
    <div className={`flex flex-col gap-1.5 ${span === 2 ? 'sm:col-span-2' : ''}`}>
      <label
        htmlFor={htmlFor}
        className="text-xs font-semibold uppercase tracking-[0.14em] text-soft/70"
      >
        {label}
      </label>
      {children}
      {error && (
        <span id={`${htmlFor}-error`} role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
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

function StorySuccess({ result, name }) {
  // The form, and the Send button that had the focus, are gone. The heading
  // takes the focus, so a screen reader says the story went through and the
  // page stands at this card and not where the long form had been scrolled to.
  // A jump, not a glide: this is another screen, not a place further up the
  // same one.
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
            Thank you for sharing
          </h1>
          <p className="mt-4 text-base text-soft/75">
            Thanks{name ? `, ${name.split(' ')[0]}` : ''}! We&rsquo;ve received
            your story and we&rsquo;ll reach out before featuring anything.
          </p>
          <div className="mt-7 inline-flex flex-col items-center gap-1 rounded-xl border border-line/10 bg-page px-6 py-4">
            <span className="text-2xs font-semibold uppercase tracking-[0.18em] text-soft/55">
              Reference
            </span>
            <span className="font-mono text-lg text-accent">
              {result.reference}
            </span>
          </div>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link to="/exchange" className={`w-full px-6 py-3 sm:w-auto ${solidPillCls}`}>
              Back to exchange
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

function StoriesClosed() {
  return (
    <article className="bg-page">
      <div className="container-prose pt-32 pb-24 sm:pt-40">
        <div className="mx-auto max-w-xl rounded-2xl border border-line/10 bg-sunk p-8 text-center sm:p-12">
          <h1 className="heading-serif text-3xl text-ink sm:text-4xl">
            Story submissions are paused
          </h1>
          <p className="mt-4 text-base text-soft/75">
            We&rsquo;re not collecting new exchange stories right now. Follow
            our channels to hear when submissions open again.
          </p>
          <Link to="/exchange" className={`mt-7 px-6 py-3 ${solidPillCls}`}>
            Back to exchange
          </Link>
        </div>
      </div>
    </article>
  )
}
