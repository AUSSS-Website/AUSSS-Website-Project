// Runtime config for the merch order flow.
//
// Why this lives here: lets the AUSSS team flip the shop on/off, paste in
// the Apps Script web app URL, and update payment handles without touching
// any UI code. Phase 4 of the rollout fills in ORDERS_WEBAPP_URL.

// Master switch. When false the checkout shows a "pre-orders are closed"
// message instead of the form, and /merch's "Order" CTAs degrade to a
// "follow our channels" hint. Useful between drops.
export const ORDERS_OPEN = true

// The Apps Script web app deployed from apps-script/orders.gs (Phase 4).
// Empty string = use the stub submit handler that just console-logs the
// payload, so we can still review the UX end-to-end in dev.
export const ORDERS_WEBAPP_URL =
  'https://script.google.com/macros/s/AKfycbygftItgPl5_dOdQFlOllM8XzATj3SEgBoy4bVc1OIflJWmeBImzbWc5WkTDwEqmVJE/exec'

// Order notifications are sent from inside apps-script/orders.gs, currently to
// aussswebsite@gmail.com. To reroute them, edit TEAM_EMAIL there and redeploy
// the script, nothing on this side needs to change.

// ── Payment methods ─────────────────────────────────────────────────────
// Each entry becomes a tile on the checkout page. Set `available: false`
// to temporarily hide one (e.g. Instapay down for maintenance) without
// deleting the config.
//
//   type:
//     'link'    – payable URL (Instapay request link)
//     'handle'  – an @handle (Telda etc.)
//     'phone'   – a mobile number (Vodafone Cash etc.)
//
// All methods require the buyer to upload a payment-receipt screenshot
// before submitting.

export const PAYMENT_METHODS = [
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
