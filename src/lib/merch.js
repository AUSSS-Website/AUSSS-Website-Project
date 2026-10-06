// The merch catalogue, live from the database (Phase 6).
//
// The EB edits the products in the portal (src/portal/pages/merch); the table
// public.merch_products is also the price book the orders RPC prices against,
// so what a visitor sees and what they are charged come from the same rows.
// Same loading order as the gallery and the magazine: the catalogue the build
// baked in, else the last one this browser saw, else the copy that ships in
// the code (src/data/merchProducts.js); then the live answer replaces it.
//
// Product shape (what ProductCard, the cart and the checkout read):
//   { id, name, tagline, description, image, price, sizes, sizeChart,
//     designs, wideDesigns, available }
//
// One store for the whole page, so the shop, the cart drawer and the checkout
// all see the same catalogue and the cart can drop lines once it is known.
import { useEffect, useSyncExternalStore } from 'react'
import { restSelect, supabaseRestEnabled } from './supabaseRest.js'
import { readJson } from './localCache.js'
import { shippedProducts } from '../data/merchProducts.js'

const CACHE_KEY = 'ausss-merch-catalogue'
const GLOBAL_KEY = '__AUSSS_MERCH__'

const SELECT =
  'id,name,tagline,description,image,price,sizes,size_chart,designs,wide_designs,available,sort_order'

const strings = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string' && s) : [])

// A database row (or a cached product) to the shape the pages read.
export function normalizeProduct(p) {
  const designs = strings(p.designs)
  return {
    id: String(p.id),
    name: String(p.name || ''),
    tagline: p.tagline || '',
    description: p.description || '',
    image: p.image || '',
    price: Number(p.price) || 0,
    sizes: strings(p.sizes),
    sizeChart: p.sizeChart || p.size_chart || '',
    designs,
    wideDesigns: strings(p.wideDesigns || p.wide_designs).filter((d) => designs.includes(d)),
    available: p.available !== false,
  }
}

function fromList(list) {
  return Array.isArray(list) ? list.filter((p) => p && p.id && p.name).map(normalizeProduct) : []
}

export async function fetchMerchProducts() {
  if (!supabaseRestEnabled) return []
  const rows = await restSelect('merch_products', { select: SELECT, order: 'sort_order.asc,id.asc' })
  return fromList(rows)
}

// Used by entry-server.jsx: the prerender fetched the catalogue once.
export function setBakedMerch(products) {
  globalThis[GLOBAL_KEY] = products
  if (Array.isArray(products) && products.length > 0) setProducts(fromList(products), true)
}

function initialProducts() {
  const baked = typeof globalThis !== 'undefined' ? globalThis[GLOBAL_KEY] : null
  if (Array.isArray(baked) && baked.length > 0) return fromList(baked)
  const cached = fromList(readJson(CACHE_KEY, []))
  return cached.length > 0 ? cached : fromList(shippedProducts)
}

function index(products) {
  return {
    products,
    byId: Object.fromEntries(products.map((p) => [p.id, p])),
    available: products.filter((p) => p.available),
    // True once the database has answered (or there is no database to ask), so
    // the cart may drop lines whose product is gone.
    settled: !supabaseRestEnabled,
  }
}

let state = index(initialProducts())
const listeners = new Set()

function setProducts(products, settled) {
  state = { ...index(products), settled }
  listeners.forEach((cb) => cb())
}

function subscribe(cb) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

// The current catalogue, for code outside React (the cart store).
export function getCatalogue() {
  return state
}
export const subscribeCatalogue = subscribe

// One fetch per page load, shared by every component that asks.
let pending = null
export function loadCatalogue() {
  if (!supabaseRestEnabled) return Promise.resolve(state)
  if (!pending) {
    pending = fetchMerchProducts()
      .then((live) => {
        // An empty answer is a database with no products yet: keep what we had.
        if (live.length > 0) {
          setProducts(live, true)
          try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(live))
          } catch {
            /* cache write is best-effort */
          }
        }
        return state
      })
      .catch((err) => {
        // A failed fetch may be tried again by the next page.
        pending = null
        throw err
      })
  }
  return pending
}

// { products, byId, available, settled }: re-renders when the live catalogue
// arrives.
export function useMerchCatalogue() {
  const s = useSyncExternalStore(subscribe, getCatalogue, getCatalogue)
  useEffect(() => {
    loadCatalogue().catch(() => {
      /* keep whatever we had: baked, cached or the shipped copy */
    })
  }, [])
  return s
}
