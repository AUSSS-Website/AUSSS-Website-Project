import { SIGNUPS_WEBAPP_URL } from '../data/signupsConfig.js'

// Lightweight sign-up capture for the recruitment waitlist and the newsletter.
// Same fire-and-forget shape as src/lib/stories.js: Apps Script's POST → 302
// redirect strips CORS headers, so we can't read the reply, but we don't need
// to. `kind` distinguishes 'waitlist' from 'newsletter' in one sheet/endpoint.
//
// Returns { ok: true } on success, { ok: false, error } on a network failure.
export async function submitSignup({ kind, name = '', email, phone = '' }) {
  const payload = {
    kind,
    name: String(name).trim(),
    email: String(email).trim(),
    phone: String(phone).trim(),
    submittedAt: new Date().toISOString(),
  }

  if (!payload.email) return { ok: false, error: 'Email is required' }

  if (!SIGNUPS_WEBAPP_URL) {
    // Stub path for dev / before the backend is deployed.
    // eslint-disable-next-line no-console
    console.info('[signups] stub submit', payload)
    await new Promise((r) => setTimeout(r, 600))
    return { ok: true, stub: true }
  }

  try {
    await fetch(SIGNUPS_WEBAPP_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message || 'Network error' }
  }
}
