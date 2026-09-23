import { ORDERS_WEBAPP_URL } from '../data/merchConfig.js'
import { productById } from '../data/merchProducts.js'
import { appsScriptPost } from './appsScriptPost.js'
import { makeReference } from './reference.js'

// Merch order submission (/merch/checkout). The order reference is generated
// here and sent with the payload, so the success screen, the sheet row and the
// notification email all quote the same code (see appsScriptPost.js).

// One readable line per cart item, for a single spreadsheet cell.
function summarizeItems(items) {
  return items
    .map((it) => {
      const p = productById[it.productId]
      if (!p) return null
      const variant = [it.size, it.design].filter(Boolean).join(' / ')
      const label = variant ? `${p.name} (${variant})` : p.name
      return `${it.qty}× ${label} = ${p.price * it.qty} EGP`
    })
    .filter(Boolean)
    .join('\n')
}

// payload: { contact: {name, email, phone, isMember, lc, year, notes},
//            items: [{productId, size, design, qty}], subtotal,
//            paymentMethod, screenshotBase64, screenshotFilename }
// Resolves to { ok: true, reference } on success, { ok: false, error } on a
// failure.
export async function submitOrder(payload) {
  const reference = makeReference('AUSSS')
  try {
    await appsScriptPost(ORDERS_WEBAPP_URL, {
      ...payload,
      reference,
      itemsSummary: summarizeItems(payload.items),
      submittedAt: new Date().toISOString(),
    })
    return { ok: true, reference }
  } catch (err) {
    return { ok: false, error: err.message || 'Network error' }
  }
}

// Read a File as a base64 string (without the data: prefix) for upload to Drive.
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(reader.error || new Error('Read failed'))
    reader.readAsDataURL(file)
  })
}
