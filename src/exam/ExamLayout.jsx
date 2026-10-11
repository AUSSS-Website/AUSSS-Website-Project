import ThemeToggle from '../components/ThemeToggle.jsx'
import { focusCls } from './examUi.jsx'

// The exam's own plain frame: the AUSSS mark, the exam's title once it is
// known, and the theme switch. No menu and no link into the site or the
// portal, so nothing on the page leads a taker away from their paper.
//
//   title  the exam's title, '' until the database has said it
//   bar    the sitting's clock and save state; it stays at the top of the
//          screen while the questions scroll under it
//   wide   the paper's column in place of a centred card
export default function ExamLayout({ title = '', bar = null, wide = false, children }) {
  const logoCls = 'h-10 w-auto'
  return (
    // dvh where the browser knows it: a phone's 100vh is taller than what
    // shows while its address bar is out.
    //
    // touch-manipulation: two quick taps (on an option, on "Next") are two
    // taps and never the phone's double-tap zoom, which would move the paper
    // under the thumb, and the browser does not hold a tap back to see
    // whether a second is coming. Scrolling and pinching to zoom stay.
    <div className="flex min-h-screen min-h-dvh touch-manipulation flex-col bg-page text-soft">
      <header className="flex items-center gap-3 px-4 py-2 sm:px-6">
        <span role="img" aria-label="AUSSS" className="shrink-0">
          <img src="/assets/brand/ausss-icon-black.png" alt="" decoding="async" className={`${logoCls} dark:hidden`} />
          <img src="/assets/brand/ausss-icon-white.png" alt="" decoding="async" className={`${logoCls} hidden dark:block`} />
        </span>
        <p className="min-w-0 flex-1 text-sm font-semibold leading-snug text-ink [overflow-wrap:anywhere]">{title}</p>
        <ThemeToggle className={`!h-[44px] !w-[44px] shrink-0 ${focusCls}`} />
      </header>
      {bar}
      <main
        className={
          wide
            ? 'mx-auto w-full max-w-3xl flex-1 px-4 pb-16 pt-6 sm:px-6'
            : 'flex flex-1 items-center justify-center px-4 py-8'
        }
      >
        {children}
      </main>
    </div>
  )
}
