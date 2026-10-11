import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase.js'
import { resizeImage } from '../lib/resizeImage.js'
import { paymentMethodsFrom } from '../data/merchConfig.js'
import { useSiteSettingsAdmin } from './officerQueries.js'

// Merch catalogue reads and writes (the EB). Same shape as magazineQueries.js.
// Authorisation lives in the database (row-level security on merch_products
// and the `merch` Storage bucket); the shop page reads the same rows
// (src/lib/merch.js), and so does the orders RPC when it prices a cart.
//
// Pictures: a product's picture and size chart are JPEGs made here in the
// browser, in the public `merch` bucket at '<product id>/<random>.jpg'. A new
// picture is a new file; the old one is removed once the row points at the
// new one.

const BUCKET = 'merch'
const IMAGE_PX = 1400
const IMAGE_QUALITY = 0.85

export const merchKeys = {
  products: () => ['merch', 'products'],
}

function unwrap({ data, error }) {
  if (error) throw error
  return data
}

const PRODUCT_SELECT =
  'id, name, tagline, description, image, price, sizes, size_chart, designs, wide_designs, available, sort_order, updated_at'

async function fetchProducts() {
  return unwrap(await supabase.from('merch_products').select(PRODUCT_SELECT).order('sort_order').order('id')) || []
}

export function useProducts() {
  return useQuery({ queryKey: merchKeys.products(), queryFn: fetchProducts })
}

async function createProduct({ id, name, price }) {
  return unwrap(
    await supabase
      .from('merch_products')
      .insert({
        id,
        name,
        price,
        // A new product waits hidden until its picture and text are in.
        available: false,
        // and goes to the end of the shop
        sort_order: 1000,
      })
      .select(PRODUCT_SELECT)
      .single(),
  )
}

async function updateProduct(id, patch) {
  return unwrap(await supabase.from('merch_products').update(patch).eq('id', id).select(PRODUCT_SELECT).single())
}

// Removes the product's uploaded pictures first, then the row.
async function deleteProduct(product) {
  await removeFolder(product.id)
  unwrap(await supabase.from('merch_products').delete().eq('id', product.id))
  return product.id
}

// New shop order: the array of product ids, first to last. The rows are written
// together, so a drop is saved in one round trip's time however many products
// there are.
async function reorderProducts(ids) {
  const results = await Promise.all(
    ids.map((id, i) => supabase.from('merch_products').update({ sort_order: i }).eq('id', id)),
  )
  results.forEach(unwrap)
  return ids
}

export function useProductMutations() {
  const qc = useQueryClient()
  const key = merchKeys.products()
  const done = () => qc.invalidateQueries({ queryKey: key })
  const create = useMutation({ mutationFn: createProduct, onSuccess: done })
  // The saved row goes into the list as the answer arrives, and the save is
  // over then: a form or a switch that waited for it finds the page already
  // holding what was saved, without waiting for the list to be read again
  // (which still happens, after).
  const update = useMutation({
    mutationFn: ({ id, patch }) => updateProduct(id, patch),
    onSuccess: async (row) => {
      // A read that set off before this save would put the old row back over it.
      await qc.cancelQueries({ queryKey: key })
      qc.setQueryData(key, (prev) => (Array.isArray(prev) ? prev.map((p) => (p.id === row.id ? row : p)) : prev))
      done()
    },
  })
  const remove = useMutation({ mutationFn: deleteProduct, onSuccess: done })
  // The list shows the new order the moment a row is dropped: the cached
  // products are put in that order first, and put back if the save fails.
  // Either way the list is read again afterwards, so the screen ends on what
  // the database holds. Same as the gallery's shelf (galleryQueries.js).
  const reorder = useMutation({
    mutationFn: reorderProducts,
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: key })
      const before = qc.getQueryData(key)
      if (before) {
        const byId = new Map(before.map((p) => [p.id, p]))
        const next = ids.map((id, i) => byId.get(id) && { ...byId.get(id), sort_order: i }).filter(Boolean)
        // Only when the drop names every product: a list that changed under it is left to the re-read.
        if (next.length === before.length) qc.setQueryData(key, next)
      }
      return { before }
    },
    onError: (_err, _ids, context) => {
      if (context?.before) qc.setQueryData(key, context.before)
    },
    onSettled: done,
  })
  return { create, update, remove, reorder }
}

// ---- a control that saves by itself ----------------------------------------

const NOT_ASKED = Symbol('nothing asked for')

// For a switch or a picker that takes effect the moment it is set: a product
// on sale, taking orders, an order's status. The control shows what was asked
// for at once and is never locked. A change made while a write is on its way
// is sent after it, so the last value asked for is the one kept; if a write
// fails, the control goes back to what the database holds and `error` is why.
//
//   const [on, setOn, { error }] = useInstantSave(p.available, (v) =>
//     update.mutateAsync({ id: p.id, patch: { available: v } }),
//   )
//   <Toggle checked={on} onChange={setOn} label="On sale" />
//
// `kept` is the value the page's data holds, and `send(value)` stores one and
// resolves when it is stored. Values are compared with ===, so they are
// booleans or strings. The setter resolves to true once everything asked for
// is saved, and to false if a write failed.
export function useInstantSave(kept, send) {
  // What was last asked for, until the page's data holds it as well.
  const [asked, setAsked] = useState(NOT_ASKED)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  // What the writes read at the moment they run.
  const latest = useRef(null)
  latest.current = { kept, send }
  const want = useRef(NOT_ASKED)
  const busy = useRef(false)
  const writes = useRef(null) // the writes on their way, as one promise
  const landedOn = useRef(kept) // what the page's data held as the last write landed

  const write = async () => {
    try {
      let sent
      do {
        sent = want.current
        await latest.current.send(sent)
      } while (want.current !== sent)
      return true
    } catch (err) {
      setError(err)
      setAsked(NOT_ASKED)
      return false
    } finally {
      busy.current = false
      landedOn.current = latest.current.kept
      setSaving(false)
    }
  }

  const set = (next) => {
    want.current = next
    setAsked(next)
    setError(null)
    if (!busy.current) {
      busy.current = true
      setSaving(true)
      writes.current = write()
    }
    return writes.current
  }

  // A row handed down by a parent arrives a moment after this hook hears that
  // its write has landed. Until it does, the value asked for stays on show, or
  // the control would flick back to the old one for a frame. The wait is over
  // when the data holds that value, and also when it moves to any other:
  // someone else has changed it since.
  const caughtUp = asked !== NOT_ASKED && !saving && (kept === asked || kept !== landedOn.current)
  useEffect(() => {
    if (caughtUp) setAsked(NOT_ASKED)
  }, [caughtUp])

  return [asked === NOT_ASKED || caughtUp ? kept : asked, set, { saving, error }]
}

// The checkout's payment methods (the site setting, else the shipped copy),
// for showing a method's name where an order recorded its id.
export function usePaymentMethods() {
  const setting = useSiteSettingsAdmin().data?.merchPaymentMethods
  return useMemo(() => paymentMethodsFrom(setting), [setting])
}

// ---- pictures --------------------------------------------------------------

async function removeFolder(productId) {
  for (;;) {
    const { data, error } = await supabase.storage.from(BUCKET).list(productId, { limit: 100 })
    if (error) throw error
    if (!data || data.length === 0) return
    const rm = await supabase.storage.from(BUCKET).remove(data.map((o) => `${productId}/${o.name}`))
    if (rm.error) throw rm.error
    if (data.length < 100) return
  }
}

const PUBLIC_PREFIX = `/storage/v1/object/public/${BUCKET}/`

// The object path of a picture in the bucket, or null for one that ships with
// the site (/assets/…) or lives anywhere else.
export function objectPath(url) {
  const i = typeof url === 'string' ? url.indexOf(PUBLIC_PREFIX) : -1
  return i === -1 ? null : decodeURIComponent(url.slice(i + PUBLIC_PREFIX.length))
}

function randomName() {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

// Shrinks the file, uploads it under the product's folder and answers with its
// public address.
export async function uploadProductImage(productId, file) {
  let blob
  try {
    blob = await resizeImage(file, IMAGE_PX, IMAGE_QUALITY)
  } catch {
    // Marked as a refusal so that errorText shows this sentence as written.
    throw Object.assign(new Error('That file could not be read as a picture. Choose a JPEG, PNG or WebP.'), {
      rejected: true,
    })
  }
  const path = `${productId}/${randomName()}.jpg`
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: 'image/jpeg',
    upsert: false,
    cacheControl: '31536000',
  })
  if (error) throw error
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}

// Best effort: a picture the row no longer points at. A failure leaves a
// stray file, never a broken product.
export async function removeProductImage(url) {
  const path = objectPath(url)
  if (path) await supabase.storage.from(BUCKET).remove([path])
}
