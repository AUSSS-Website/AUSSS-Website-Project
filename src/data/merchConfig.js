// Switches, endpoint and payment handles for the merch shop, kept out of the
// UI code so the team can change them without touching a component.

// Opening and closing pre-orders is a switch on the portal's Merch page (the
// site setting `merchOrdersOpen`), and the products are edited there too.
// Orders land in Supabase (`orders`, priced by `merch_products`, the same rows
// the shop shows) and the EB handles them in the portal under Submissions >
// Orders.

// ── Payment methods ─────────────────────────────────────────────────────
// Each entry is a tile on the checkout page. Set `available: false` to hide
// one temporarily (Instapay down for maintenance, say) without deleting it.
//
//   type:
//     'link'    a payable URL (Instapay request link)
//     'handle'  an @handle (Telda)
//     'phone'   a mobile number (Vodafone Cash)
//
// Every method asks the buyer to upload a receipt screenshot before submitting.

const PAYMENT_METHODS = [
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

export const paymentMethodById = Object.fromEntries(
  PAYMENT_METHODS.map((m) => [m.id, m]),
)

export const availablePaymentMethods = PAYMENT_METHODS.filter(
  (m) => m.available,
)
