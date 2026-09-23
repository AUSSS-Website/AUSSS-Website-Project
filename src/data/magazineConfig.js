// Magazine engagement (view and like counters), backed by the Apps Script web
// app deployed from apps-script/magazine.gs. The magazine page records a view
// per visit and can show a live "reads" count with a Like button.
export const MAGAZINE_WEBAPP_URL =
  'https://script.google.com/macros/s/AKfycbymoTD2Y6N6Z9XmmQKz2MZ_O41pcRCfczE8l6GQmrJCt3XXbT1IBJCT19QeSEd7iIN0/exec'

export const magazineEngagementEnabled = Boolean(MAGAZINE_WEBAPP_URL)

// Whether to SHOW the live reads/likes counter + Like button on the page.
// Views are still recorded in the background when this is false, only the
// on-page counter UI is hidden. Flip to true to surface it again.
export const magazineCountersVisible = false
