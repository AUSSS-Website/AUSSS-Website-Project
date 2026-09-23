import { STORIES_WEBAPP_URL } from '../data/storiesConfig.js'
import { appsScriptPost } from './appsScriptPost.js'
import { makeReference } from './reference.js'

// Exchange-story submission (/exchange/share). The reference is generated
// here and sent with the payload, so the success screen, the sheet row and the
// notification email all quote the same code (see appsScriptPost.js).
//
// Resolves to { ok: true, reference } on success, { ok: false, error } on a
// failure.
export async function submitStory(payload) {
  // payload: { name, email, phone, destination, programme, year, story }
  const reference = makeReference('STORY')
  try {
    await appsScriptPost(STORIES_WEBAPP_URL, {
      ...payload,
      reference,
      submittedAt: new Date().toISOString(),
    })
    return { ok: true, reference }
  } catch (err) {
    return { ok: false, error: err.message || 'Network error' }
  }
}
