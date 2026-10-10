import { useEffect, useRef } from 'react'
import Button from '../components/ui/Button.jsx'
import { ErrorText, Spinner, outlineBtnCls, primaryBtnCls } from '../portal/portalUi.jsx'

// The few pieces the exam's screens share. They are the portal's own
// (src/portal/portalUi.jsx: the card, the two buttons, the error line), sized
// for a thumb: everything a taker taps is at least 44px tall, in px and not
// rem, because the root size shrinks on a 320px phone.

// A focus ring that shows on both themes, for whoever sits the exam with a
// keyboard.
export const focusCls =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-page'

// The portal's blue and outline buttons at a thumb's size.
export const tapPrimaryCls = `${primaryBtnCls} ${focusCls} min-h-[44px]`
export const tapOutlineCls = `${outlineBtnCls} ${focusCls} min-h-[44px] !px-5 !text-sm`

// A quiet text button ("Sign out", "Edit my details", "Clear answer").
export const tapLinkCls = `inline-flex min-h-[44px] items-center justify-center rounded-lg px-2 text-sm font-semibold text-accent underline-offset-4 hover:underline disabled:opacity-40 ${focusCls}`

// Whether the taker is moving about with a keyboard: true from a press of Tab
// until the next touch or click.
let tabbing = false
if (typeof window !== 'undefined') {
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Tab') tabbing = true
    },
    true,
  )
  window.addEventListener(
    'pointerdown',
    () => {
      tabbing = false
    },
    true,
  )
}

// Moves the focus to a heading or a question that has taken the place of what
// the taker was on, so a keyboard carries on from it and a screen reader
// reads it out. Its ring (focusTargetCls) shows only to someone who is using
// the keyboard. The browser's own rule would also draw it whenever nothing
// has been touched since the page loaded: a box round the heading after
// every refresh and after the trip to Google.
export function moveFocus(element) {
  if (!element) return
  element.toggleAttribute('data-ring', tabbing)
  element.focus({ preventScroll: true })
}

// For an element moveFocus is used on.
export const focusTargetCls = 'outline-none data-[ring]:focus-visible:ring-2 data-[ring]:focus-visible:ring-accent/60'

// Whether a screen of the exam has been on show since the page loaded. The
// first one leaves the focus where the browser put it; each one after it is a
// change the taker has to be told of.
let screenShown = false

// Says a screen is on show and answers whether one was before it. The paper
// calls it too (SittingScreen), so the card that follows it counts as a change.
export function noteScreen() {
  const before = screenShown
  screenShown = true
  return before
}

// The card every screen but the paper sits in. It is the portal's AuthCard
// without the full-height stage around it, which ExamLayout provides (the
// card sits under the layout's own bar).
//
// When one card takes another's place, the button that had the focus has gone
// with the old card. The new card's heading takes the focus, so a keyboard
// starts from it and a screen reader reads it out, as the paper's pages do.
export function ExamCard({ eyebrow = 'Exchange exam', title, subtitle, children }) {
  const heading = useRef(null)
  // Whether this card is a change (null until it is known), and the title it
  // last showed. Kept in refs so that an effect run twice for one mount
  // (React's StrictMode) decides once.
  const isChange = useRef(null)
  const shown = useRef(title)
  useEffect(() => {
    if (isChange.current === null) isChange.current = noteScreen()
    else if (shown.current !== title) isChange.current = true
    shown.current = title
    if (isChange.current) moveFocus(heading.current)
  }, [title])
  return (
    <div className="w-full max-w-sm rounded-3xl border border-line/10 bg-sunk p-6 sm:p-8">
      <div className="text-center">
        {eyebrow && (
          <span className="eyebrow justify-center">
            <span className="h-px w-8 bg-medical" />
            {eyebrow}
            <span className="h-px w-8 bg-medical" />
          </span>
        )}
        {title && (
          <h1 ref={heading} tabIndex={-1} className={`heading-serif mt-4 rounded-lg text-2xl text-ink ${focusTargetCls}`}>
            {title}
          </h1>
        )}
        {/* The database's sentences and an email address may hold one long word. */}
        {subtitle && <p className="mt-2 text-sm text-soft/70 [overflow-wrap:anywhere]">{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}

// The portal's spinner. It stands still for a taker who asked for less
// motion, so it always comes with a line of words: a still ring alone would
// not say that anything is on its way.
export function Waiting({ children = 'One moment…' }) {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <Spinner className="h-8 w-8 motion-reduce:animate-none" />
      <p className="text-sm text-soft/80">{children}</p>
    </div>
  )
}

// A line of the database's or the page's own bad news, with room above it
// only when there is one.
export function Problem({ id, children }) {
  if (!children) return null
  return (
    <div className="mt-4">
      <ErrorText id={id}>{children}</ErrorText>
    </div>
  )
}

// Google's "G" in its four standard colours, as the sign-in branding
// guidelines require (developers.google.com/identity/branding-guidelines).
// The same mark as on the portal's sign-in page; it is drawn again here
// because that page brings the portal's AuthProvider with it.
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="h-[18px] w-[18px] shrink-0" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  )
}

// The portal's Google button: the light one in both themes (white fill,
// #747775 outline, #1F1F1F label), which is what the guidelines allow.
export function GoogleButton({ busy, onClick }) {
  return (
    <Button
      type="button"
      variant="primary"
      className="mt-6 min-h-[44px] w-full border border-[#747775] !bg-white !font-medium !text-[#1F1F1F] hover:!bg-silver-light motion-reduce:transition-none motion-reduce:hover:scale-100"
      onClick={onClick}
      disabled={busy}
    >
      <GoogleMark />
      {busy ? 'Redirecting…' : 'Continue with Google'}
    </Button>
  )
}

// A small flag, outlined or filled.
export function FlagIcon({ filled = false, className = 'h-4 w-4' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`${className} shrink-0`}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
    </svg>
  )
}
