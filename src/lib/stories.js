import { restRpc } from './supabaseRest.js'
import { makeReference } from './reference.js'
import { errorText } from './errorText.js'

// Exchange-story submission (/exchange/share). The reference is generated
// here and sent with the payload, so the success screen and the row the
// exchange officers see in the portal quote the same code.
//
// Resolves to { ok: true, reference } on success, { ok: false, error } on a
// failure. `error` is one whole sentence to show as it is: the database's own
// when it refused the story (a missing field, the flood cap), a plain one when
// the request never got an answer, and otherwise the words below.

// For a failure that is nobody's sentence: a fault on the server, or an answer
// in the API's own words. Trying again can help here, which it cannot after a
// refusal, so the advice lives in this sentence and not on the page.
const NOT_SENT = 'We couldn’t send your story. Please try again, or email us if it keeps failing.'

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
    return { ok: false, error: errorText(err, NOT_SENT) }
  }
}
