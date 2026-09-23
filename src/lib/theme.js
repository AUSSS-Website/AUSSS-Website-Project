import { useEffect, useSyncExternalStore } from 'react'

// Theme state lives on <html class="dark"> + localStorage.theme.
// Initial value is set by the no-flash bootstrap in index.html, so the
// first render already matches the DOM.

const STORAGE_KEY = 'theme'

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

  // Keep following the OS preference as long as the user hasn't picked
  // explicitly. Once they click the toggle, localStorage.theme is set and
  // we stop reacting to the OS.
  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e) => {
      try {
        if (localStorage.getItem(STORAGE_KEY)) return
      } catch (_) {}
      document.documentElement.classList.toggle('dark', e.matches)
      listeners.forEach((cb) => cb())
    }
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return { theme, setTheme, toggleTheme }
}
