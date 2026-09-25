import { useState } from 'react'
import { Link } from 'react-router-dom'
import useReveal from '../hooks/useReveal.js'
import usePageTitle from '../hooks/usePageTitle.js'
import { submitStory } from '../lib/stories.js'
import { STORIES_OPEN } from '../data/storiesConfig.js'

const PROGRAMME_OPTIONS = [
  'SCOPE: Professional (clinical) exchange',
  'SCORE: Research exchange',
  'Other / not sure',
]

const MAX_STORY_LENGTH = 2500

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

  if (!STORIES_OPEN) {
    return <StoriesClosed />
  }

  if (result?.ok) {
    return <StorySuccess result={result} name={form.name} />
  }

  const update = (key, value) => setForm((f) => ({ ...f, [key]: value }))

  const validate = () => {
    const next = {}
    if (!form.name.trim()) next.name = 'Required'
    if (!form.email.trim() || !/^\S+@\S+\.\S+$/.test(form.email))
      next.email = 'Enter a valid email'
    if (!form.phone.trim() || form.phone.replace(/\D/g, '').length < 8)
      next.phone = 'Enter a valid phone / WhatsApp number'
    if (!form.story.trim() || form.story.trim().length < 30)
      next.story = 'Tell us a little more, at least a couple of sentences'
    if (form.story.length > MAX_STORY_LENGTH)
      next.story = `Keep it under ${MAX_STORY_LENGTH} characters`
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const onSubmit = async (e) => {
    e.preventDefault()
    if (!validate()) return
    setSubmitting(true)
    const res = await submitStory(form)
    setSubmitting(false)
    setResult(res)
  }

  return (
    <article className="bg-forest-950">
      <header className="container-prose pb-12 pt-32 sm:pt-40">
        <div className="reveal text-center">
          <span className="eyebrow justify-center">
            <span className="h-px w-8 bg-medical" />
            Exchange stories
            <span className="h-px w-8 bg-medical" />
          </span>
          <h1 className="heading-serif mt-5 text-4xl text-white sm:text-5xl">
            Share your exchange story
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base font-light text-silver/75">
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
          <fieldset className="rounded-2xl border border-white/10 bg-forest-900 p-6 sm:p-8">
            <legend className="px-2 text-xs font-semibold uppercase tracking-[0.18em] text-medical-light">
              About you
            </legend>

            <div className="mt-2 grid gap-5 sm:grid-cols-2">
              <Field label="Full name *" htmlFor="name" error={errors.name} span={2}>
                <input
                  id="name"
                  type="text"
                  autoComplete="name"
                  value={form.name}
                  onChange={(e) => update('name', e.target.value)}
                  className={inputClass(errors.name)}
                />
              </Field>

              <Field label="Email *" htmlFor="email" error={errors.email}>
                <input
                  id="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={form.email}
                  onChange={(e) => update('email', e.target.value)}
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
                  value={form.phone}
                  onChange={(e) => update('phone', e.target.value)}
                  className={inputClass(errors.phone)}
                />
              </Field>
            </div>
          </fieldset>

          {/* The exchange */}
          <fieldset className="rounded-2xl border border-white/10 bg-forest-900 p-6 sm:p-8">
            <legend className="px-2 text-xs font-semibold uppercase tracking-[0.18em] text-medical-light">
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
                  value={form.story}
                  onChange={(e) =>
                    update('story', e.target.value.slice(0, MAX_STORY_LENGTH))
                  }
                  className={inputClass(errors.story) + ' resize-y'}
                />
                <span className="self-end text-[11px] text-silver/55">
                  {form.story.length} / {MAX_STORY_LENGTH}
                </span>
              </Field>
            </div>
          </fieldset>

          {result?.ok === false && (
            <p className="rounded-xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">
              {result.error}. Please try again or email us if it keeps failing.
            </p>
          )}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Link
              to="/exchange"
              className="inline-flex items-center gap-1 text-sm font-semibold text-silver/70 transition-colors hover:text-white"
            >
              ← Back to exchange
            </Link>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-8 py-3.5 text-sm font-semibold text-forest transition-transform hover:scale-[1.02] disabled:cursor-wait disabled:opacity-70"
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

function inputClass(error) {
  return `w-full rounded-lg border bg-forest-950 px-3.5 py-2.5 text-sm text-white placeholder:text-silver/40 transition-colors focus:outline-none focus:ring-2 focus:ring-medical/60 ${
    error ? 'border-red-400/50' : 'border-white/15 hover:border-white/25'
  }`
}

function Field({ label, htmlFor, error, span = 1, children }) {
  return (
    <label
      htmlFor={htmlFor}
      className={`flex flex-col gap-1.5 ${span === 2 ? 'sm:col-span-2' : ''}`}
    >
      <span className="text-xs font-semibold uppercase tracking-[0.14em] text-silver/70">
        {label}
      </span>
      {children}
      {error && (
        <span id={`${htmlFor}-error`} role="alert" className="text-xs text-red-300">
          {error}
        </span>
      )}
    </label>
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
            Thank you for sharing
          </h1>
          <p className="mt-4 text-base text-silver/75">
            Thanks{name ? `, ${name.split(' ')[0]}` : ''}! We&rsquo;ve received
            your story and we&rsquo;ll reach out before featuring anything.
          </p>
          <div className="mt-7 inline-flex flex-col items-center gap-1 rounded-xl border border-white/10 bg-forest-950 px-6 py-4">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-silver/55">
              Reference
            </span>
            <span className="font-mono text-lg text-medical-light">
              {result.reference}
            </span>
          </div>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link
              to="/exchange"
              className="w-full rounded-full bg-white px-6 py-3 text-sm font-semibold text-forest transition-transform hover:scale-[1.02] sm:w-auto"
            >
              Back to exchange
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

function StoriesClosed() {
  return (
    <article className="bg-forest-950">
      <div className="container-prose pt-32 pb-24 sm:pt-40">
        <div className="mx-auto max-w-xl rounded-2xl border border-white/10 bg-forest-900 p-8 text-center sm:p-12">
          <h1 className="heading-serif text-3xl text-white sm:text-4xl">
            Story submissions are paused
          </h1>
          <p className="mt-4 text-base text-silver/75">
            We&rsquo;re not collecting new exchange stories right now. Follow
            our channels to hear when submissions open again.
          </p>
          <Link
            to="/exchange"
            className="mt-7 inline-flex rounded-full bg-white px-6 py-3 text-sm font-semibold text-forest transition-transform hover:scale-[1.02]"
          >
            Back to exchange
          </Link>
        </div>
      </div>
    </article>
  )
}
