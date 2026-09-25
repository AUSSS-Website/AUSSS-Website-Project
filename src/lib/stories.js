import { restRpc } from './supabaseRest.js'
import { makeReference } from './reference.js'

// Exchange-story submission (/exchange/share). The reference is generated
// here and sent with the payload, so the success screen and the row the
// exchange officers see in the portal quote the same code.
//
// Resolves to { ok: true, reference } on success, { ok: false, error } on a
// failure. A refusal from the database (missing field, flood cap) carries the
// message to show.
export async function submitStory(payload) {
  // payload: { name, email, phone, destination, programme, year, story, website }
  const reference = makeReference('STORY')
  try {
    const res = await restRpc('submit_story', {
      ref: reference,
      name: payload.name,
      email: payload.email,
      phone: payload.phone,
      story: payload.story,
      destination: payload.destination || '',
      programme: payload.programme || '',
      year: payload.year || '',
      website: payload.website || '',
    })
    return { ok: true, reference: res?.ref || reference }
  } catch (err) {
    return { ok: false, error: err.message || 'Network error' }
  }
}
