import { useMemo } from 'react'
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

async function reorderProducts(ids) {
  for (let i = 0; i < ids.length; i++) {
    unwrap(await supabase.from('merch_products').update({ sort_order: i }).eq('id', ids[i]))
  }
  return ids
}

export function useProductMutations() {
  const qc = useQueryClient()
  const done = () => qc.invalidateQueries({ queryKey: merchKeys.products() })
  const create = useMutation({ mutationFn: createProduct, onSuccess: done })
  const update = useMutation({ mutationFn: ({ id, patch }) => updateProduct(id, patch), onSuccess: done })
  const remove = useMutation({ mutationFn: deleteProduct, onSuccess: done })
  const reorder = useMutation({ mutationFn: reorderProducts, onSuccess: done })
  return { create, update, remove, reorder }
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
  const blob = await resizeImage(file, IMAGE_PX, IMAGE_QUALITY)
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
