import { useSyncExternalStore } from 'react'
import { getCatalogue, subscribeCatalogue } from './merch.js'

// ── Cart store ───────────────────────────────────────────────────────────
// Lines are keyed by productId + size + design so the same shirt in two
// sizes shows up as two separate lines (same as any normal storefront).
//
// Persisted to localStorage so a tab reload preserves the cart while
// users wander between /merch and /merch/checkout.

const STORAGE_KEY = 'ausss-cart-v1'

// Per-line quantity ceiling. Group orders go through DMs anyway; this just
// stops typos/abuse from inflating the cart unbounded.
const MAX_QTY = 20

const sellable = (productId) => Boolean(getCatalogue().byId[productId]?.available)

function readInitial() {
  if (typeof window === 'undefined') return { items: [], dropped: 0 }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { items: [], dropped: 0 }
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.items)) return { items: [], dropped: 0 }
    return { items: parsed.items.filter((it) => it && typeof it.productId === 'string'), dropped: 0 }
  } catch (_) {
    return { items: [], dropped: 0 }
  }
}

let state = readInitial()
const listeners = new Set()

function persist() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ items: state.items }))
  } catch (_) {}
}
function emit() {
  persist()
  listeners.forEach((cb) => cb())
}

function subscribe(cb) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

// Once the catalogue is known for sure (the database answered), lines whose
// product was removed or hidden by the EB are dropped, so a stale cart never
// blocks checkout. `dropped` counts them for the notice on the checkout page.
function prune() {
  if (!getCatalogue().settled) return
  const keep = state.items.filter((it) => sellable(it.productId))
  if (keep.length === state.items.length) return
  state = { items: keep, dropped: state.dropped + (state.items.length - keep.length) }
  emit()
}
if (typeof window !== 'undefined') {
  prune()
  subscribeCatalogue(prune)
}

const lineKey = (productId, size, design) =>
  `${productId}::${size || ''}::${design || ''}`

export function addToCart({ productId, size = '', design = '', qty = 1 }) {
  if (!sellable(productId)) return
  const key = lineKey(productId, size, design)
  const existing = state.items.find(
    (it) => lineKey(it.productId, it.size, it.design) === key,
  )
  if (existing) {
    state = {
      ...state,
      items: state.items.map((it) =>
        it === existing ? { ...it, qty: Math.min(MAX_QTY, it.qty + qty) } : it,
      ),
    }
  } else {
    state = {
      ...state,
      items: [
        ...state.items,
        { productId, size, design, qty: Math.min(MAX_QTY, qty) },
      ],
    }
  }
  emit()
}

export function updateQty({ productId, size = '', design = '', qty }) {
  const key = lineKey(productId, size, design)
  state = {
    ...state,
    items: state.items
      .map((it) =>
        lineKey(it.productId, it.size, it.design) === key
          ? { ...it, qty: Math.max(0, Math.min(MAX_QTY, qty)) }
          : it,
      )
      .filter((it) => it.qty > 0),
  }
  emit()
}

export function removeFromCart({ productId, size = '', design = '' }) {
  const key = lineKey(productId, size, design)
  state = {
    ...state,
    items: state.items.filter(
      (it) => lineKey(it.productId, it.size, it.design) !== key,
    ),
  }
  emit()
}

export function clearCart() {
  state = { items: [], dropped: 0 }
  emit()
}

// ── Selectors ────────────────────────────────────────────────────────────

function getState() {
  return state
}

export function useCart() {
  return useSyncExternalStore(subscribe, getState, getState)
}

export function cartCount(s = state) {
  return s.items.reduce((n, it) => n + it.qty, 0)
}

export function cartSubtotal(s = state) {
  return s.items.reduce((sum, it) => {
    const p = getCatalogue().byId[it.productId]
    return sum + (p?.price || 0) * it.qty
  }, 0)
}

// How many lines were dropped because their product left the catalogue.
export function cartDropped(s = state) {
  return s.dropped
}

export function useCartCount() {
  const s = useCart()
  return cartCount(s)
}

// Tiny formatter, EGP first, no decimals (the catalogue is round numbers).
export function formatEGP(n) {
  return `${Number(n || 0).toLocaleString('en-EG')} EGP`
}

// ── Drawer open/close, shared state so any button can toggle it ─────────
let drawerOpen = false
const drawerListeners = new Set()
function drawerSubscribe(cb) {
  drawerListeners.add(cb)
  return () => drawerListeners.delete(cb)
}
function drawerGet() {
  return drawerOpen
}
export function openCartDrawer() {
  if (drawerOpen) return
  drawerOpen = true
  drawerListeners.forEach((cb) => cb())
}
export function closeCartDrawer() {
  if (!drawerOpen) return
  drawerOpen = false
  drawerListeners.forEach((cb) => cb())
}
export function useCartDrawerOpen() {
  return useSyncExternalStore(drawerSubscribe, drawerGet, () => false)
}
