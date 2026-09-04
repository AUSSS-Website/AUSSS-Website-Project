// Google Analytics 4 (GA4) integration, DORMANT by default.
//
// Paste a GA4 Measurement ID like 'G-XXXXXXXXXX' here to enable analytics.
// While this is empty the feature is fully dormant: no script tag is injected,
// no cookies are set, and no network calls are made.
export const GA_MEASUREMENT_ID = ''

// True only when a Measurement ID is configured above.
export const analyticsEnabled = Boolean(GA_MEASUREMENT_ID)

// Guard so the gtag.js script is injected at most once.
let initialized = false

// Inject gtag.js and configure GA4. No-op when disabled, already initialized,
// or running without a DOM (SSR/build).
export function initAnalytics() {
  if (!analyticsEnabled || initialized) return
  if (typeof document === 'undefined' || typeof window === 'undefined') return

  initialized = true

  window.dataLayer = window.dataLayer || []
  window.gtag = function () {
    window.dataLayer.push(arguments)
  }

  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`
  document.head.appendChild(script)

  window.gtag('js', new Date())
  // We send pageviews manually on route change (SPA), so disable the automatic one.
  window.gtag('config', GA_MEASUREMENT_ID, { send_page_view: false })
}

// Send a manual SPA pageview. No-op when disabled or gtag isn't available yet.
export function trackPageview(path) {
  if (!analyticsEnabled) return
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return

  window.gtag('event', 'page_view', {
    page_path: path,
    page_location: window.location.href,
    page_title: document.title,
  })
}
