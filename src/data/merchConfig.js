// Switches, endpoint and payment handles for the merch shop, kept out of the
// UI code so the team can change them without touching a component.

// When false the checkout shows a "pre-orders are closed" message instead of
// the form. Useful between drops.
export const ORDERS_OPEN = true

// The Apps Script web app deployed from apps-script/orders.gs. It emails each
// order to aussswebsite@gmail.com; change TEAM_EMAIL there and redeploy to
// reroute them.
export const ORDERS_WEBAPP_URL =
  'https://script.google.com/macros/s/AKfycbygftItgPl5_dOdQFlOllM8XzATj3SEgBoy4bVc1OIflJWmeBImzbWc5WkTDwEqmVJE/exec'

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
