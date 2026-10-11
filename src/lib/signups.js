import { restRpc } from './supabaseRest.js'
import { errorText } from './errorText.js'

// The recruitment waitlist on /join. rpc/submit_signup validates, ignores a
// repeat of the same email within a day and caps the rate; the row lands in
// `signups` for the EB (portal, Submissions > Waitlist).
//
// Resolves to { ok: true } on success, { ok: false, error } on a failure.
// `error` is a whole sentence, to be shown as it is.
export async function submitSignup({ name = '', email, website = '' }) {
  const payload = {
    kind: 'waitlist',
    name: String(name).trim(),
    email: String(email).trim(),
    phone: '',
    website, // honeypot, always blank for a person
  }
  if (!payload.email) return { ok: false, error: 'Please enter your email.' }

  try {
    await restRpc('submit_signup', payload)
    return { ok: true }
  } catch (err) {
    // The function's own refusals ("Please enter a valid email address.",
    // "Too many sign-ups right now, please retry shortly.") are shown as
    // written, and a request that got no answer says so.
    return {
      ok: false,
      error: errorText(err, 'We couldn’t add you to the list. Please try again in a moment.'),
    }
  }
}
