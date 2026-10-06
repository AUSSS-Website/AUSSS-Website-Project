// Payment methods for the merch checkout.
//
// The EB edits them on the portal's Merch page; they are kept in the site
// setting `merchPaymentMethods` (public.site_settings), read by every visitor.
// The list below is the copy the checkout shows until that setting exists or
// when it cannot be read. Opening and closing orders is the setting
// `merchOrdersOpen`, on the same page. Orders land in Supabase (`orders`,
// priced by `merch_products`) and the EB handles them on the Merch page and
// under Submissions > Orders. An order records the method's id, so an id never
// changes once orders may name it.
//
// Each method is a tile on the checkout page:
//   id         short and permanent ('instapay')
//   type       'link'    a payable https address (an Instapay request link)
//              'handle'  an @handle (Telda)
//              'phone'   a mobile number (Vodafone Cash)
//   label      its name on the tile
//   hint       a short line under the name
//   value      the address, handle or number
//   available  false hides the tile without deleting the method
//
// Every method asks the buyer to upload a receipt screenshot before submitting.

export const PAYMENT_TYPES = [
  ['link', 'Payment link'],
  ['handle', 'Handle'],
  ['phone', 'Phone number'],
]

export const shippedPaymentMethods = [
  {
    id: 'instapay',
    type: 'link',
    label: 'Instapay',
    hint: 'Send + upload receipt',
    value: 'https://ipn.eg/S/markalexan/instapay/4R3lzH',
    available: true,
  },
  {
    id: 'telda',
    type: 'handle',
    label: 'Telda',
    hint: 'Send + upload receipt',
    value: '@sarsorz',
    available: true,
  },
  {
    id: 'vodafone',
    type: 'phone',
    label: 'Vodafone Cash',
    hint: 'Send + upload receipt',
    value: '01003522721',
    available: true,
  },
]

const MAX_METHODS = 12
const clip = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '')

// What is wrong with one method's value for its type, or '' when it is fine.
// A link is only ever an https address, because the checkout makes it a link.
export function paymentValueProblem(type, value) {
  const v = typeof value === 'string' ? value.trim() : ''
  if (!v) return 'Fill this in.'
  if (type === 'link') return /^https:\/\/[^\s<>"']+$/i.test(v) ? '' : 'Use a full address that starts with https://.'
  if (type === 'handle') return /^@?[A-Za-z0-9._-]{2,60}$/.test(v) ? '' : 'Use a handle such as @name.'
  if (type === 'phone') return /^\+?[\d\s-]{7,20}$/.test(v) ? '' : 'Use a phone number such as 01012345678.'
  return 'Choose a type.'
}

// Any value (what the setting holds) to a clean list: unknown keys dropped,
// broken entries left out, ids unique. Never throws.
export function normalizePaymentMethods(value) {
  if (!Array.isArray(value)) return null
  const seen = new Set()
  const out = []
  for (const m of value.slice(0, MAX_METHODS)) {
    if (!m || typeof m !== 'object') continue
    const id = clip(m.id, 40)
    const type = PAYMENT_TYPES.some(([t]) => t === m.type) ? m.type : ''
    const label = clip(m.label, 60)
    let val = clip(m.value, 300)
    if (type === 'handle' && val && !val.startsWith('@')) val = `@${val}`
    if (!/^[a-z0-9-]{1,40}$/.test(id) || seen.has(id) || !type || !label || paymentValueProblem(type, val)) continue
    seen.add(id)
    out.push({ id, type, label, hint: clip(m.hint, 80), value: val, available: m.available !== false })
  }
  return out
}

// The methods the checkout uses: the setting when it holds a usable list,
// else the shipped copy.
export function paymentMethodsFrom(setting) {
  const list = normalizePaymentMethods(setting)
  return list && list.length > 0 ? list : shippedPaymentMethods
}

// A method's name for an order that recorded its id (a removed method shows
// its id).
export function paymentMethodLabel(methods, id) {
  return methods.find((m) => m.id === id)?.label || id
}
