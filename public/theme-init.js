// No-flash theme bootstrap. index.html loads this before React mounts, as a
// file instead of an inline script so the Content-Security-Policy can refuse
// every inline script (vercel.json, script-src without 'unsafe-inline').
// Reads the visitor's explicit choice from localStorage, falls back to the OS
// preference. Keep in step with src/lib/theme.js.
(function () {
  try {
    var saved = localStorage.getItem('theme')
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    var isDark = saved === 'dark' || (!saved && prefersDark)
    document.documentElement.classList.toggle('dark', isDark)
  } catch (_) {}
})()
