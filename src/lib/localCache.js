// Reading a last-known-good JSON blob back out of Web Storage.
//
// Several hooks cache their backend response so the UI can paint the right
// state on the very first frame of a repeat visit instead of flashing an empty
// one. They all need the same three guards: storage can throw outright (private
// mode, blocked site data), the slot can be empty, and the blob can be stale
// garbage from an older shape. Any of those falls back to `fallback`.
//
// The fallback also types the result: pass `[]` and only an array comes back,
// pass `{}` and only an object does.
export function readJson(key, fallback, storage) {
  try {
    // Resolved inside the guard: there is no Web Storage when the page is
    // pre-rendered in Node at build time (scripts/prerender.mjs).
    const raw = (storage || localStorage).getItem(key)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    const ok = Array.isArray(fallback)
      ? Array.isArray(parsed)
      : parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    return ok ? parsed : fallback
  } catch {
    return fallback
  }
}
