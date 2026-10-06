import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import usePageTitle from '../../../hooks/usePageTitle.js'
import {
  removeProductImage,
  uploadProductImage,
  useProductMutations,
  useProducts,
} from '../../merchQueries.js'
import {
  Centered,
  ErrorText,
  Field,
  PageHeader,
  Panel,
  Spinner,
  Toggle,
  inputCls,
  outlineBtnCls,
  primaryBtnCls,
} from '../../portalUi.jsx'
import { ConfirmButton } from '../gallery/galleryUi.jsx'
import { MerchGate } from './MerchPage.jsx'
import { splitList } from '../../merchForm.js'

// /portal/merch/:id. One product: its card text, price, sizes and designs, its
// picture and size chart, whether it is on sale, and removing it.

function formFrom(p) {
  return {
    name: p.name,
    tagline: p.tagline || '',
    description: p.description || '',
    price: String(p.price),
    sizes: (p.sizes || []).join(', '),
    designs: (p.designs || []).join(', '),
    wideDesigns: p.wide_designs || [],
  }
}

function patchFrom(form) {
  const designs = splitList(form.designs)
  return {
    name: form.name.trim(),
    tagline: form.tagline.trim(),
    description: form.description.trim(),
    price: Math.max(0, Math.round(Number(form.price) || 0)),
    sizes: splitList(form.sizes),
    designs,
    wide_designs: form.wideDesigns.filter((d) => designs.includes(d)),
  }
}

function DetailsForm({ product }) {
  const { update } = useProductMutations()
  const [form, setForm] = useState(() => formFrom(product))
  const [saved, setSaved] = useState(false)
  const set = (key) => (e) => {
    setSaved(false)
    setForm((f) => ({ ...f, [key]: e.target.value }))
  }

  // Follow the row when it changes elsewhere (another editor saved), unless
  // there are unsaved edits here.
  const base = JSON.stringify(formFrom(product))
  const current = JSON.stringify(form)
  const dirty = current !== base
  const lastBase = useRef(base)
  useEffect(() => {
    if (base !== lastBase.current && current === lastBase.current) setForm(formFrom(product))
    lastBase.current = base
  }, [base, current, product])

  const designs = splitList(form.designs)
  const toggleWide = (d) => {
    setSaved(false)
    setForm((f) => ({
      ...f,
      wideDesigns: f.wideDesigns.includes(d) ? f.wideDesigns.filter((x) => x !== d) : [...f.wideDesigns, d],
    }))
  }

  const submit = async (e) => {
    e.preventDefault()
    await update.mutateAsync({ id: product.id, patch: patchFrom(form) })
    setSaved(true)
  }

  return (
    <Panel title="On its card">
      <form onSubmit={submit} className="mt-4 grid gap-5 sm:grid-cols-2">
        <Field label="Name" htmlFor="p-name">
          <input id="p-name" className={inputCls} value={form.name} onChange={set('name')} maxLength={140} required />
        </Field>
        <Field label="Price (EGP)" htmlFor="p-price" hint="What the next buyer pays. Orders already placed keep their price.">
          <input
            id="p-price"
            className={inputCls}
            type="number"
            min={0}
            max={100000}
            step={1}
            value={form.price}
            onChange={set('price')}
            required
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Tagline" htmlFor="p-tagline" hint="One short line under the name. Optional.">
            <input id="p-tagline" className={inputCls} value={form.tagline} onChange={set('tagline')} maxLength={200} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Description" htmlFor="p-description" hint="A paragraph: what it is made of, what is printed or embroidered where.">
            <textarea
              id="p-description"
              className={`${inputCls} min-h-[7rem]`}
              value={form.description}
              onChange={set('description')}
              maxLength={2000}
            />
          </Field>
        </div>
        <Field
          label="Sizes"
          htmlFor="p-sizes"
          hint="In order, separated by commas: S, M, L, XL. One size alone is chosen for the buyer; leave blank when there are no sizes."
        >
          <input id="p-sizes" className={inputCls} value={form.sizes} onChange={set('sizes')} maxLength={400} />
        </Field>
        <Field
          label="Designs"
          htmlFor="p-designs"
          hint="Variants the buyer picks from, separated by commas: SCOPH, SCORA, Exchange. Leave blank when there is one design."
        >
          <input id="p-designs" className={inputCls} value={form.designs} onChange={set('designs')} maxLength={1200} />
        </Field>
        {designs.length > 0 && (
          <div className="sm:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Wide designs</p>
            <p className="mb-3 mt-1 text-xs text-soft/50">
              Designs with a long name take a whole row in the picker.
            </p>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {designs.map((d) => (
                <label key={d} className="inline-flex items-center gap-2 text-sm text-ink">
                  <input type="checkbox" checked={form.wideDesigns.includes(d)} onChange={() => toggleWide(d)} />
                  {d}
                </label>
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <button type="submit" className={primaryBtnCls} disabled={update.isPending || !dirty || !form.name.trim()}>
            {update.isPending ? 'Saving…' : 'Save'}
          </button>
          {dirty && (
            <button type="button" className={outlineBtnCls} onClick={() => setForm(formFrom(product))}>
              Undo changes
            </button>
          )}
          {saved && !dirty && <span className="text-xs text-ok">Saved. The shop shows it now.</span>}
        </div>
        {update.error && (
          <div className="sm:col-span-2">
            <ErrorText>{update.error.message}</ErrorText>
          </div>
        )}
      </form>
    </Panel>
  )
}

// One picture of the product (its photo, or its size chart): shows it, and
// replaces or removes it.
function PictureSlot({ product, column, label, hint, removable }) {
  const { update } = useProductMutations()
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const current = product[column]

  const replace = async (file) => {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const url = await uploadProductImage(product.id, file)
      try {
        await update.mutateAsync({ id: product.id, patch: { [column]: url } })
      } catch (err) {
        await removeProductImage(url).catch(() => {})
        throw err
      }
      await removeProductImage(current).catch(() => {})
    } catch (err) {
      setError(err.message || 'The picture could not be uploaded.')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const clear = async () => {
    setBusy(true)
    setError('')
    try {
      await update.mutateAsync({ id: product.id, patch: { [column]: '' } })
      await removeProductImage(current).catch(() => {})
    } catch (err) {
      setError(err.message || 'The picture could not be removed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex gap-4">
      <div className="aspect-[5/7] w-28 shrink-0 overflow-hidden rounded-xl bg-sunk">
        {current ? (
          <img src={current} alt="" className="h-full w-full object-contain" />
        ) : (
          <span className="grid h-full w-full place-items-center text-center text-[10px] uppercase tracking-[0.2em] text-soft/40">
            None
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">{label}</p>
        <p className="mt-1 text-xs text-soft/55">{hint}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            id={`pic-${column}`}
            onChange={(e) => replace(e.target.files?.[0])}
            disabled={busy}
          />
          <label htmlFor={`pic-${column}`} className={`${outlineBtnCls} cursor-pointer ${busy ? 'pointer-events-none opacity-40' : ''}`}>
            {busy ? 'Working…' : current ? 'Replace' : 'Upload'}
          </label>
          {removable && current && (
            <button type="button" className={outlineBtnCls} onClick={clear} disabled={busy}>
              Remove
            </button>
          )}
        </div>
        {error && (
          <div className="mt-2">
            <ErrorText>{error}</ErrorText>
          </div>
        )}
      </div>
    </div>
  )
}

function ProductEditor({ product }) {
  const navigate = useNavigate()
  const { update, remove } = useProductMutations()
  const deleteProduct = async () => {
    await remove.mutateAsync(product)
    navigate('/portal/merch', { replace: true })
  }
  return (
    <>
      <PageHeader
        eyebrow={
          <Link to="/portal/merch" className="hover:text-ink">
            &larr; All products
          </Link>
        }
        title={product.name}
        subtitle={`${product.available ? 'On sale' : 'Hidden'} · ${product.id}`}
        action={
          <Link to="/merch" target="_blank" rel="noopener noreferrer" className={outlineBtnCls}>
            View the shop ↗
          </Link>
        }
      />

      <Panel className="mb-8">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="text-sm font-semibold text-ink">On sale</p>
            <p className="mt-1 text-xs text-soft/55">
              {product.available
                ? 'Shown in the shop and can be ordered.'
                : 'Hidden from the shop. Carts that hold it drop it, and an order for it is not taken.'}
            </p>
          </div>
          <Toggle
            checked={product.available}
            onChange={(v) => update.mutate({ id: product.id, patch: { available: v } })}
            label="On sale"
            disabled={update.isPending}
          />
        </div>
        {update.error && (
          <div className="mt-3">
            <ErrorText>{update.error.message}</ErrorText>
          </div>
        )}
      </Panel>

      <DetailsForm product={product} />

      <Panel title="Pictures" className="mt-8">
        <div className="mt-4 grid gap-6 sm:grid-cols-2">
          <PictureSlot
            product={product}
            column="image"
            label="Product picture"
            hint="Shown on its card, in the cart and at checkout. A tall picture (5 by 7) fills the card best."
          />
          <PictureSlot
            product={product}
            column="size_chart"
            label="Size chart"
            hint="Opened from the card's size picker. Optional."
            removable
          />
        </div>
      </Panel>

      <Panel title="Remove product" className="mt-8">
        <p className="mt-3 text-xs text-soft/55">
          Removes the product and its uploaded pictures. Orders already placed keep their lines. Prefer hiding it. This
          cannot be undone.
        </p>
        <div className="mt-4">
          <ConfirmButton
            label="Remove this product"
            confirmLabel="Remove product and pictures"
            onConfirm={deleteProduct}
            disabled={remove.isPending}
          />
        </div>
        {remove.error && <ErrorText>{remove.error.message}</ErrorText>}
      </Panel>
    </>
  )
}

export default function ProductEditorPage() {
  const { id } = useParams()
  const products = useProducts()
  const product = (products.data || []).find((p) => p.id === id)
  usePageTitle(product ? `Edit ${product.name}` : 'Edit product')

  return (
    <MerchGate>
      {products.isPending ? (
        <Centered>
          <Spinner />
        </Centered>
      ) : products.error ? (
        <Panel>
          <ErrorText>Couldn’t load the product: {products.error.message}</ErrorText>
        </Panel>
      ) : !product ? (
        <Panel>
          <p className="text-sm text-soft/70">No product with the id {id}.</p>
          <Link to="/portal/merch" className="mt-4 inline-block text-sm font-semibold text-accent hover:text-ink">
            &larr; All products
          </Link>
        </Panel>
      ) : (
        <ProductEditor product={product} />
      )}
    </MerchGate>
  )
}
