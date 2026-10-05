import { useSyncExternalStore } from 'react'

// Theme state lives on <html class="dark"> + localStorage.theme.
// Initial value is set by the no-flash bootstrap (public/theme-init.js), so
// the first render already matches the DOM.
//
// Light is the default: the site is dark only for a visitor who picked dark
// with the toggle. The device's own light/dark setting is not followed.

const STORAGE_KEY = 'theme'

// The colour of the browser's own bar on a phone, per theme (the page colour).
const BAR = { light: '#fafcfb', dark: '#021c12' }

function currentTheme() {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

const listeners = new Set()
function subscribe(cb) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function setTheme(next) {
  const isDark = next === 'dark'
  document.documentElement.classList.toggle('dark', isDark)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', isDark ? BAR.dark : BAR.light)
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch (_) {}
  listeners.forEach((cb) => cb())
}

function toggleTheme() {
  setTheme(currentTheme() === 'dark' ? 'light' : 'dark')
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => 'light')
  return { theme, setTheme, toggleTheme }
}
