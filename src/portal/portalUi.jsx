import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { pressCls } from '../lib/motion.js'
import { MEMBERSHIP_LABELS } from './constants.js'

// Shared dark-chrome primitives for the portal, matching the public site's
// look so the two never drift apart.

// Full-height centred stage, for when the whole screen is one message: the
// sign-in check, a sign-in error card. A page inside the portal layout that
// is loading uses PageLoading below.
export function Centered({ children }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-4 text-center">
      {children}
    </div>
  )
}

export function Spinner({ className = 'h-8 w-8' }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`${className} inline-block animate-spin rounded-full border-2 border-line/15 border-t-accent`}
    />
  )
}

// A page's own loading state, inside the portal layout. The header and the
// navigation are already on screen, so the spinner sits a little way under
// them, where the content is about to appear, and not half a screen down.
export function PageLoading() {
  return (
    <div className="flex justify-center py-16">
      <Spinner />
    </div>
  )
}

// The sign-in surface: dark page, one narrow rounded card.
export function AuthCard({ eyebrow, title, subtitle, children }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-4">
      <div className="w-full max-w-sm rounded-3xl border border-line/10 bg-sunk p-8">
        <div className="text-center">
          {eyebrow && (
            <span className="eyebrow justify-center">
              <span className="h-px w-8 bg-medical" />
              {eyebrow}
              <span className="h-px w-8 bg-medical" />
            </span>
          )}
          {title && <h1 className="heading-serif mt-4 text-2xl text-ink">{title}</h1>}
          {subtitle && <p className="mt-2 text-sm text-soft/70">{subtitle}</p>}
        </div>
        {children}
      </div>
    </div>
  )
}

// The small blue capitals a panel is titled with. Exported for a heading that
// opens a section without being a field's label (Field below is for those), so
// it reads as the same kind of title wherever it stands:
//
//   <p className={panelTitleCls}>Wide designs</p>
export const panelTitleCls = 'text-xs font-semibold uppercase tracking-[0.2em] text-accent'

// Content panel used on the dashboard and profile pages.
export function Panel({ title, children, className = '' }) {
  return (
    <section className={`min-w-0 rounded-2xl border border-line/10 bg-card p-5 ${className}`}>
      {title && <p className={panelTitleCls}>{title}</p>}
      {children}
    </section>
  )
}

// Page header: eyebrow, serif title, one-line intro, optional action on the
// right.
export function PageHeader({ eyebrow, title, subtitle, action }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 pb-8">
      <div>
        {eyebrow && (
          <span className="eyebrow">
            <span className="h-px w-8 bg-medical" />
            {eyebrow}
          </span>
        )}
        <h1 className="heading-serif mt-3 text-3xl text-ink sm:text-4xl">{title}</h1>
        {subtitle && <p className="mt-2 text-sm text-soft/65">{subtitle}</p>}
      </div>
      {action}
    </header>
  )
}

// Compact form input. The ring shows which field the keyboard is in; the
// border alone was too faint a change to find.
export const inputCls =
  'w-full rounded-xl border border-line/15 bg-sunk px-4 py-2.5 text-sm text-ink placeholder:text-soft/40 focus:border-medical focus:outline-none focus-visible:ring-2 focus-visible:ring-medical/60'

// Taller input for the sign-in card.
export const authInputCls =
  'w-full rounded-xl border border-line/15 bg-page px-4 py-3 text-ink placeholder:text-soft/40 focus-visible:border-medical focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-medical/60'

// Blue primary pill and hairline outline pill. Both centre their content
// both ways, on a <button> or on a link or label styled as one, even when a
// flex row stretches them taller; the gap stands in for the space before an
// icon, which a flex box drops. Both sink a little when pressed (pressCls).
const btnCentreCls = 'inline-flex items-center justify-center gap-1.5 text-center'
export const primaryBtnCls =
  `${btnCentreCls} rounded-full bg-cta px-6 py-2.5 text-sm font-semibold text-on-cta ${pressCls} hover:bg-cta-hover disabled:opacity-40`
export const outlineBtnCls =
  `${btnCentreCls} rounded-full border border-line/20 px-4 py-1.5 text-xs font-semibold text-ink ${pressCls} hover:bg-veil/10 disabled:opacity-40`

// A labelled form field. The label is plain text in the ink colour, as typed:
// the small blue capitals are a panel's title (Panel above), and a field that
// looked like one read as the start of a new section.
export function Field({ label, hint, htmlFor, children }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
        {label}
      </label>
      {hint && <p className="mb-3 mt-1 text-xs text-soft/50">{hint}</p>}
      {!hint && <div className="mt-3" />}
      {children}
    </div>
  )
}

// Membership badge. Colours are per status; labels come from the contract.
const BADGE = {
  unverified: 'border-line/15 text-soft/70',
  candidate: 'border-medical/60 text-accent',
  active: 'border-emerald-400/50 text-ok',
  alumni: 'border-amber-400/50 text-warn',
}

export function StatusBadge({ status }) {
  const label = MEMBERSHIP_LABELS[status] || status || 'Unknown'
  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${
        BADGE[status] || BADGE.unverified
      }`}
    >
      {label}
    </span>
  )
}

export function Toggle({ checked, onChange, label, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
        checked ? 'bg-medical' : 'bg-veil/15'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

// A tick box with its label, for a choice inside a form that waits for Save.
// A switch (Toggle above) is for a setting that takes effect the moment it is
// flipped. A choice that only counts once the form is saved is a tick box, so
// the two kinds never look alike.
//
//   <CheckField checked={digest} onChange={setDigest} label="Email me a daily digest" hint="At most one email a day." />
//
// `onChange` is handed the new value, true or false, as Toggle's is. The label
// and the hint are both part of what a finger can land on, and the row is at
// least 44px tall, in px and not rem, because the root size shrinks on a 320px
// phone. `id` names the input, for a page that points at it. The box is drawn
// here from the theme's colours; where the system forces its own colours, the
// browser's own tick box takes its place.
const checkBoxCls =
  'peer h-5 w-5 cursor-pointer appearance-none rounded-md border border-line/40 bg-sunk transition-[background-color,border-color,transform] duration-150 ease-out checked:border-cta checked:bg-cta group-hover/check:border-line/60 checked:group-hover/check:border-cta-hover checked:group-hover/check:bg-cta-hover motion-safe:group-active/check:scale-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed forced-colors:appearance-auto'

export function CheckField({ checked, onChange, label, hint, disabled = false, id, className = '' }) {
  const auto = useId()
  const inputId = id || auto
  const labelId = `${inputId}-label`
  const hintId = `${inputId}-hint`
  return (
    <label
      className={`grid min-h-[44px] grid-cols-[auto_minmax(0,1fr)] content-center items-start gap-x-3 gap-y-0.5 py-3 ${
        disabled ? 'cursor-not-allowed opacity-50' : 'group/check cursor-pointer'
      } ${className}`}
    >
      <span className="relative flex h-5 w-5 shrink-0">
        <input
          id={inputId}
          type="checkbox"
          checked={Boolean(checked)}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          // The name is the label alone; the hint is read after it, as a description.
          aria-labelledby={labelId}
          aria-describedby={hint ? hintId : undefined}
          className={checkBoxCls}
        />
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 m-auto h-3.5 w-3.5 text-on-cta opacity-0 transition-opacity duration-150 peer-checked:opacity-100 forced-colors:hidden"
        >
          <path d="M3.5 8.5l3 3 6-6.5" />
        </svg>
      </span>
      <span id={labelId} className="text-sm font-medium text-ink">
        {label}
      </span>
      {hint && (
        <span id={hintId} className="col-start-2 text-xs text-soft/55">
          {hint}
        </span>
      )}
    </label>
  )
}

// Inline error line.
export function ErrorText({ id, children }) {
  if (!children) return null
  return (
    <p id={id} role="alert" className="text-sm text-danger">
      {children}
    </p>
  )
}

// Where a form stands, in one line beside its Save button: "Unsaved changes"
// while there is something to save, otherwise what the last save said,
// otherwise nothing. A "Saved." left up after the next keystroke hid the fact
// that there was something new to save; here the two cannot show together.
//
//   <SaveStatus dirty={dirty} saved={saved} />
//   <SaveStatus dirty={dirty} saved={msg} />
//
// `saved` is true for "Saved." (`savedText` gives other words for it, such as
// "Published."), or it is the sentence to show, for a page that keeps its
// message in state. `unsavedText` replaces "Unsaved changes".
//
// The line is a polite status, so a screen reader says it when it changes.
// For that it has to be in the page before it has anything to say: with
// nothing to say it is still rendered, out of sight and taking up no room.
export function SaveStatus({ dirty = false, saved = false, savedText = 'Saved.', unsavedText = 'Unsaved changes', className = '' }) {
  const text = dirty ? unsavedText : saved === true ? savedText : saved || ''
  return (
    <p
      role="status"
      className={text ? `flex min-w-0 items-center gap-1.5 text-xs ${dirty ? 'text-soft/70' : 'text-ok'} ${className}` : 'sr-only'}
    >
      {dirty && <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />}
      {text}
    </p>
  )
}

// A quiet line that says what has just happened and offers to take it back: a
// row that left the list it was in, an album sent to the archive, a line
// removed from a form. It stands in for asking first, so nothing is confirmed
// and a slip costs one click.
//
//   <UndoLine onUndo={() => move(row.id, was)}>Moved to Contacted.</UndoLine>
//
// `undoLabel` replaces "Undo". While `busy` the button is off and shows
// `busyLabel` ("Undoing…"). Without `onUndo` it is the sentence alone.
//
// Like SaveStatus it is a polite status: keep it in the page and give it no
// children while there is nothing to undo, and a screen reader says the line
// when it comes. The button has a thumb's 44px to land on although the line
// stays one line of small text: its ::after carries the extra, centred on the
// word.
const undoBtnCls = `relative inline-flex shrink-0 items-center rounded font-semibold text-accent ${pressCls} hover:text-ink disabled:opacity-40 after:absolute after:left-1/2 after:top-1/2 after:h-[44px] after:w-[calc(100%+1rem)] after:min-w-[44px] after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent`

export function UndoLine({ children, onUndo, undoLabel = 'Undo', busyLabel = 'Undoing…', busy = false, className = '' }) {
  const said = children != null && children !== false && children !== ''
  return (
    <p
      role="status"
      className={said ? `flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-soft/70 ${className}` : 'sr-only'}
    >
      {said && <span className="min-w-0">{children}</span>}
      {said && onUndo && (
        <button type="button" onClick={onUndo} disabled={busy} className={undoBtnCls}>
          {busy ? busyLabel : undoLabel}
        </button>
      )}
    </p>
  )
}

export function BackLink({ to = '/', children = 'Back to AUSSS home' }) {
  return (
    <Link
      to={to}
      className="mt-6 inline-block w-full text-center text-xs font-semibold text-soft/60 transition-colors hover:text-ink"
    >
      &larr; {children}
    </Link>
  )
}

// Every remove, delete, withdraw and clear in the portal goes through this
// button. The first click turns it red and asks again on the button itself
// ("Click again to delete"); the second click does it. Clicking or tabbing
// away, Escape, or leaving it alone for a few seconds turns it back, so a red
// button never sits waiting for a stray click. No window.confirm (it blocks
// the page).
//
//   <ConfirmButton label="Delete" onConfirm={…} />                an outline pill
//   <ConfirmButton variant="text" label="Remove" onConfirm={…} />  a small text link
//
// `confirmLabel` replaces the "Click again to …" wording, `busyLabel` shows
// while `busy`, and `children` (with `ariaLabel`) replaces the idle label, for
// an icon such as ×. `className` styles the idle button; the armed one is red
// whatever it is.
//
// The two clicks have to be two decisions. A second click that comes within
// half a second of the first is the other half of a double-click: it is
// ignored and the button stays red, waiting. Holding Enter down counts once.
//
// A pill with the default look is as wide as its longest wording from the
// start, so nothing beside it moves when it turns red (its labels share one
// grid cell). With a `className` of your own, pass `keepWidth` to get the same
// where there is room for the longer wording, or `keepWidth={false}` to switch
// it off. A text link and an icon have no width to keep: they grow into the
// red pill.
//
// The red state is also said aloud ("Click again to delete"), through a
// polite live region beside the button.
const DISARM_MS = 5000
const CONFIRM_AFTER_MS = 500

const confirmIdle = {
  button: outlineBtnCls,
  text: 'text-xs font-semibold text-soft/60 transition-colors hover:text-ink disabled:opacity-40',
}
// red-600, not red-500: white text on it is 4.8 to 1, and on red-500 only 3.8,
// under the 4.5 that text of this size needs.
const confirmArmed = {
  button: '!border-red-600 !bg-red-600 !text-white hover:!bg-red-700',
  text: `${btnCentreCls} rounded-full bg-red-600 px-2.5 py-0.5 text-xs font-semibold text-white ${pressCls} hover:bg-red-700 disabled:opacity-40`,
}

export function ConfirmButton({
  label,
  confirmLabel,
  busyLabel,
  onConfirm,
  busy = false,
  disabled = false,
  variant = 'button',
  className,
  keepWidth,
  ariaLabel,
  title,
  children,
}) {
  const [armed, setArmed] = useState(false)
  // When the first click landed, on the clock that only runs forwards.
  const armedAt = useRef(0)
  useEffect(() => {
    if (!armed) return undefined
    const timer = setTimeout(() => setArmed(false), DISARM_MS)
    return () => clearTimeout(timer)
  }, [armed])

  const idleCls = className ?? confirmIdle[variant]
  // The text link turns into a small red pill; any other button keeps its
  // shape and turns red.
  const armedCls = variant === 'text' ? confirmArmed.text : `${idleCls} ${confirmArmed.button}`
  const askAgain = confirmLabel || `Click again to ${String(label || 'confirm').toLowerCase()}`
  const showBusy = busy && Boolean(busyLabel)
  const text = showBusy ? busyLabel : armed ? askAgain : children ?? label

  // Every wording the button can show, the one in use marked. Laid over each
  // other in one grid cell they make the button as wide as the longest.
  const steady = variant === 'button' && children == null && (keepWidth ?? className == null)
  const wordings = [
    ['idle', label, !armed && !showBusy],
    ['armed', askAgain, armed && !showBusy],
    ['busy', busyLabel, showBusy],
  ].filter(([, wording]) => wording)

  return (
    <>
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => {
          if (!armed) {
            armedAt.current = performance.now()
            setArmed(true)
            return
          }
          if (performance.now() - armedAt.current < CONFIRM_AFTER_MS) return
          setArmed(false)
          onConfirm()
        }}
        onBlur={() => setArmed(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setArmed(false)
          // A held key repeats Enter's click; only a fresh press arms or confirms.
          if (e.key === 'Enter' && e.repeat) e.preventDefault()
        }}
        aria-label={armed ? askAgain : ariaLabel}
        title={armed ? askAgain : title}
        className={armed ? armedCls : idleCls}
      >
        {steady ? (
          <span className="grid items-center justify-items-center text-center">
            {wordings.map(([state, wording, shown]) => (
              <span
                key={state}
                aria-hidden={shown ? undefined : true}
                className={`col-start-1 row-start-1 ${shown ? '' : 'invisible'}`}
              >
                {wording}
              </span>
            ))}
          </span>
        ) : (
          text
        )}
      </button>
      <span className="sr-only" aria-live="polite">
        {armed ? askAgain : ''}
      </span>
    </>
  )
}

