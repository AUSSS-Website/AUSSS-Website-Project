import { restRpc } from './supabaseRest.js'

// The recruitment waitlist on /join. rpc/submit_signup validates, ignores a
// repeat of the same email within a day and caps the rate; the row lands in
// `signups` for the EB (portal, Submissions > Waitlist).
//
// Resolves to { ok: true } on success, { ok: false, error } on a failure.
export async function submitSignup({ name = '', email, website = '' }) {
  const payload = {
    kind: 'waitlist',
    name: String(name).trim(),
    email: String(email).trim(),
    phone: '',
    website, // honeypot, always blank for a person
  }
  if (!payload.email) return { ok: false, error: 'Email is required' }

  try {
    await restRpc('submit_signup', payload)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message || 'Network error' }
  }
}
