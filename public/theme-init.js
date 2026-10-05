// No-flash theme bootstrap. index.html loads this before React mounts, as a
// file instead of an inline script so the Content-Security-Policy can refuse
// every inline script (vercel.json, script-src without 'unsafe-inline').
//
// The site opens in the light theme. It is dark only for a visitor who chose
// dark with the toggle (kept in localStorage.theme); the device's own
// light/dark setting is not followed (the webmaster's decision, 2026-10-06).
// The browser's bar colour follows the theme. Keep in step with
// src/lib/theme.js.
(function () {
  try {
    var isDark = localStorage.getItem('theme') === 'dark'
    document.documentElement.classList.toggle('dark', isDark)
    var bar = document.querySelector('meta[name="theme-color"]')
    if (bar) bar.setAttribute('content', isDark ? '#021c12' : '#fafcfb')
  } catch (_) {}
})()
