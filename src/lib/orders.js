import { restRpc, restUpload } from './supabaseRest.js'
import { makeReference } from './reference.js'
import { resizeImage } from './resizeImage.js'

// Merch order submission (/merch/checkout), in three steps:
//   1. rpc/submit_order   the database prices the cart from its own price book
//                         and stores the order; it answers with the id and the
//                         receipt path it will accept
//   2. upload             the payment screenshot, shrunk to a JPEG here, goes
//                         to the private `receipts` bucket at that path (the
//                         bucket policy allows exactly one file per fresh order)
//   3. rpc/order_receipt_attached   records that the file is there
//
// The reference is generated here so the success screen and the row the EB
// sees in the portal quote the same code.
//
// Resolves to { ok: true, reference, receiptAttached } on success (an order
// without its receipt is still an order: the buyer is told to send it on),
// { ok: false, error } on a failure.

const RECEIPT_MAX_PX = 1600

// payload: { contact: {name, email, phone, isMember, lc, year, notes, website},
//            items: [{productId, size, design, qty}], subtotal, paymentMethod,
//            screenshot: File | null }
export async function submitOrder(payload) {
  const reference = makeReference('AUSSS')
  const c = payload.contact || {}
  let order
  try {
    order = await restRpc('submit_order', {
      ref: reference,
      name: c.name,
      email: c.email,
      phone: c.phone,
      items: (payload.items || []).map((it) => ({
        productId: it.productId,
        size: it.size || '',
        design: it.design || '',
        qty: it.qty,
      })),
      is_member: c.isMember === 'Yes' ? true : c.isMember === 'No' ? false : null,
      lc: c.lc || '',
      year: c.year || '',
      notes: c.notes || '',
      payment_method: payload.paymentMethod || '',
      subtotal: Math.round(Number(payload.subtotal) || 0),
      website: c.website || '',
    })
  } catch (err) {
    return { ok: false, error: err.message || 'Network error' }
  }

  const ref = order?.ref || reference
  let receiptAttached = false
  if (order?.duplicate) {
    receiptAttached = true // the first submission handled it
  } else if (payload.screenshot && order?.id && order?.receipt_path) {
    try {
      const blob = await resizeImage(payload.screenshot, RECEIPT_MAX_PX)
      await restUpload('receipts', order.receipt_path, blob, 'image/jpeg')
      const attached = await restRpc('order_receipt_attached', { id: order.id, ref })
      receiptAttached = Boolean(attached?.ok)
    } catch {
      // The order is in; the success screen asks the buyer to send the receipt.
      receiptAttached = false
    }
  }
  return { ok: true, reference: ref, receiptAttached }
}
