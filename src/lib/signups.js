import { SIGNUPS_WEBAPP_URL } from '../data/signupsConfig.js'
import { appsScriptPost } from './appsScriptPost.js'

// The recruitment waitlist on /join. The backend (apps-script/signups.gs)
// files each row under `kind`; the site only ever sends 'waitlist' now.
//
// Resolves to { ok: true } on success, { ok: false, error } on a failure.
export async function submitSignup({ name = '', email }) {
  const payload = {
    kind: 'waitlist',
    name: String(name).trim(),
    email: String(email).trim(),
    phone: '',
    submittedAt: new Date().toISOString(),
  }
  if (!payload.email) return { ok: false, error: 'Email is required' }

  try {
    await appsScriptPost(SIGNUPS_WEBAPP_URL, payload)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message || 'Network error' }
  }
}
