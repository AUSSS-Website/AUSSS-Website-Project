import { ORDERS_WEBAPP_URL } from '../data/merchConfig.js'
import { productById } from '../data/merchProducts.js'
import { makeReference } from './reference.js'

// ── Order submission ─────────────────────────────────────────────────────
//
// Two paths:
//   • Live (Phase 4): POSTs JSON to the deployed Apps Script web app.
//   • Stub (Phase 3 / no URL yet): logs the payload to the console and
//     returns a fake order reference so the UX can be reviewed in dev
//     without a backend.
//
// Returns: { ok: true, reference }  on success
//          { ok: false, error }    on failure

const REFERENCE_PREFIX = 'AUSSS'

// Serializes a cart line into something the Apps Script + spreadsheet can
// store as a single readable cell.
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

export async function submitOrder(payload) {
  // payload shape:
  //   { contact: {name, email, phone, isMember, lc, year, notes},
  //     items: [{productId, size, design, qty}],
  //     subtotal,
  //     paymentMethod: 'instapay' | 'telda' | 'vodafone',
  //     screenshotBase64: string,
  //     screenshotFilename: string,
  //   }
  // `lc` is only sent when isMember === 'No'.

  // The reference is generated client-side and shipped *to* the script.
  // Why: Apps Script's POST → 302 → googleusercontent.com redirect doesn't
  // forward CORS headers on the second hop, so the browser can't read the
  // response body even though the script ran successfully. By generating
  // the reference here and sending it in the payload, the sheet/email/UI
  // all show the same number, and the fetch can be fire-and-forget.
  const reference = makeReference(REFERENCE_PREFIX)

  const enriched = {
    ...payload,
    reference,
    itemsSummary: summarizeItems(payload.items),
    submittedAt: new Date().toISOString(),
  }

  if (!ORDERS_WEBAPP_URL) {
    // Stub path, used in dev when ORDERS_WEBAPP_URL is empty.
    // eslint-disable-next-line no-console
    console.info('[orders] stub submit', enriched)
    await new Promise((r) => setTimeout(r, 700)) // mimic network latency
    return { ok: true, reference, stub: true }
  }

  try {
    // mode: 'no-cors' = fire-and-forget. The script DID run (we see emails
    // arriving), the browser just can't read the JSON response across the
    // redirect. The opaque response is fine, we already know the reference.
    await fetch(ORDERS_WEBAPP_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(enriched),
    })
    return { ok: true, reference }
  } catch (err) {
    // Only thrown on true network-level failures (DNS, offline, etc.).
    return { ok: false, error: err.message || 'Network error' }
  }
}

// Read a File as a base64 string (sans data: prefix) for upload to Drive.
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
