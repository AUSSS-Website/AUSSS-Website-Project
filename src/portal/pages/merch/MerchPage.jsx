import { useState } from 'react'
import { Link } from 'react-router-dom'
import usePageTitle from '../../../hooks/usePageTitle.js'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { formatEGP } from '../../../lib/cart.js'
import { useProductMutations, useProducts } from '../../merchQueries.js'
import { slugify } from '../../merchForm.js'
import { useSiteSettingsAdmin, useUpsertSiteSetting } from '../../officerQueries.js'
import SortableList from '../../SortableList.jsx'
import OrdersPanel from './OrdersPanel.jsx'
import PaymentMethodsPanel from './PaymentMethodsPanel.jsx'
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

// /portal/merch. The shop: every product in the order visitors see it, with
// its picture, price and whether it is on sale, and the switch that opens and
// closes orders. The EB adds products here and drags them into order; a
// product's text, sizes, designs and pictures are edited on its own page. The
// same rows price the orders, so a price changed here is what the next buyer
// pays. Below the products, the orders placed at the checkout (OrdersPanel.jsx).

export function MerchGate({ children }) {
  const { isEB } = useAuth()
  if (isEB) return children
  return (
    <Panel>
      <p className="text-sm text-soft/70">
        The merch shop is run by the Executive Board. If you think you should
        have access, ask the webmaster to check your assignment for this term.
      </p>
      <Link to="/portal" className="mt-4 inline-block text-sm font-semibold text-accent hover:text-ink">
        &larr; Back to your dashboard
      </Link>
    </Panel>
  )
}

function OrdersOpenPanel() {
  const settings = useSiteSettingsAdmin()
  const save = useUpsertSiteSetting()
  // A missing row means open, as on the site.
  const open = settings.data?.merchOrdersOpen !== false
  return (
    <Panel className="mb-8">
      <div className="flex items-start justify-between gap-6">
        <div>
          <p className="text-sm font-semibold text-ink">Taking orders</p>
          <p className="mt-1 text-xs text-soft/55">
            {open
              ? 'The checkout is open. Turn this off between drops: the shop stays up, and the checkout says orders are closed.'
              : 'Orders are closed: visitors can browse the shop, and the checkout turns every order away.'}
          </p>
        </div>
        <Toggle
          checked={open}
          onChange={(v) => save.mutate({ key: 'merchOrdersOpen', value: v })}
          label="Taking orders"
          disabled={settings.isPending || save.isPending}
        />
      </div>
      {(settings.error || save.error) && (
        <div className="mt-3">
          <ErrorText>{(settings.error || save.error).message}</ErrorText>
        </div>
      )}
    </Panel>
  )
}

function NewProductForm({ taken, onDone }) {
  const { create } = useProductMutations()
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [id, setId] = useState('')
  const finalId = slugify(id || name)
  const clash = finalId && taken.includes(finalId)

  const submit = async (e) => {
    e.preventDefault()
    if (!name.trim() || !finalId || clash) return
    const row = await create.mutateAsync({ id: finalId, name: name.trim(), price: Number(price) || 0 })
    onDone(row)
  }

  return (
    <Panel title="New product" className="mb-8">
      <form onSubmit={submit} className="mt-4 grid gap-5 sm:grid-cols-3">
        <Field label="Name" htmlFor="new-product-name" hint="As it appears on its card, for example AUSSS Mug.">
          <input
            id="new-product-name"
            className={inputCls}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={140}
            required
            autoFocus
          />
        </Field>
        <Field label="Price (EGP)" htmlFor="new-product-price" hint="Whole pounds.">
          <input
            id="new-product-price"
            className={inputCls}
            type="number"
            min={0}
            max={100000}
            step={1}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            required
          />
        </Field>
        <Field label="Id" htmlFor="new-product-id" hint="Short and permanent; carts and orders use it. Made from the name when left blank.">
          <input
            id="new-product-id"
            className={inputCls}
            value={id}
            onChange={(e) => setId(e.target.value)}
            maxLength={40}
            placeholder={slugify(name) || 'ausss-mug'}
          />
        </Field>
        <div className="sm:col-span-3">
          {clash && <ErrorText>There is already a product with the id {finalId}. Choose another.</ErrorText>}
          {create.error && <ErrorText>{create.error.message}</ErrorText>}
          <p className="text-xs text-soft/55">
            A new product starts hidden. Add its picture and description, then put it on sale.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 sm:col-span-3">
          <button
            type="submit"
            className={primaryBtnCls}
            disabled={create.isPending || !name.trim() || !finalId || clash || price === ''}
          >
            {create.isPending ? 'Creating…' : 'Create product'}
          </button>
          <button type="button" className={outlineBtnCls} onClick={() => onDone(null)}>
            Cancel
          </button>
        </div>
      </form>
    </Panel>
  )
}

function ProductRow({ p, handle }) {
  const { update } = useProductMutations()
  const to = `/portal/merch/${p.id}`
  return (
    <div className="flex flex-wrap items-center gap-3 p-3 sm:flex-nowrap sm:gap-4">
      {handle}
      <Link to={to} className="block aspect-[5/7] w-14 shrink-0 overflow-hidden rounded-lg bg-sunk">
        {p.image ? (
          <img src={p.image} alt="" className="h-full w-full object-contain" loading="lazy" />
        ) : (
          <span className="grid h-full w-full place-items-center text-center text-[9px] uppercase tracking-[0.2em] text-soft/40">
            No picture
          </span>
        )}
      </Link>
      {/* At least 8rem for the name, so on a phone the switch and Edit move
          to a line of their own instead of squeezing it to nothing. */}
      <div className="min-w-[8rem] flex-1">
        <Link to={to} className="heading-serif block truncate text-lg text-ink hover:text-accent">
          {p.name}
        </Link>
        <p className="mt-0.5 truncate text-xs text-soft/55">
          {formatEGP(p.price)}
          {' · '}
          {p.available ? 'on sale' : 'hidden'}
          {' · '}
          <span className="text-soft/40">{p.id}</span>
        </p>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-3">
        <Toggle
          checked={p.available}
          onChange={(v) => update.mutate({ id: p.id, patch: { available: v } })}
          label={`${p.name} on sale`}
          disabled={update.isPending}
        />
        <Link to={to} className={outlineBtnCls}>
          Edit
        </Link>
      </div>
      {update.error && (
        <div className="w-full">
          <ErrorText>{update.error.message}</ErrorText>
        </div>
      )}
    </div>
  )
}

export default function MerchPage() {
  usePageTitle('Merch editor')
  const products = useProducts()
  const { reorder } = useProductMutations()
  const [adding, setAdding] = useState(false)
  const [created, setCreated] = useState(null)

  return (
    <MerchGate>
      <PageHeader
        eyebrow="Executive Board"
        title="Merch"
        subtitle="Products in the order of the shop. Drag a product by its handle to move it; the switch puts it on sale or hides it. Changes are live in the shop the moment they are saved."
        action={
          <div className="flex flex-wrap gap-2">
            <Link to="/merch" target="_blank" rel="noopener noreferrer" className={outlineBtnCls}>
              View the shop ↗
            </Link>
            {!adding && (
              <button type="button" className={primaryBtnCls} onClick={() => setAdding(true)}>
                New product
              </button>
            )}
          </div>
        }
      />

      <OrdersOpenPanel />

      {adding && (
        <NewProductForm
          taken={(products.data || []).map((p) => p.id)}
          onDone={(row) => {
            setAdding(false)
            if (row) setCreated(row)
          }}
        />
      )}

      {created && (
        <p className="mb-6 rounded-xl border border-medical/40 bg-medical/10 px-4 py-3 text-sm text-accent">
          Product created.{' '}
          <Link to={`/portal/merch/${created.id}`} className="font-semibold underline-offset-2 hover:underline">
            Add the picture and description of {created.name} &rarr;
          </Link>
        </p>
      )}

      {products.isPending ? (
        <Centered>
          <Spinner />
        </Centered>
      ) : products.error ? (
        <Panel>
          <ErrorText>Couldn’t load the products: {products.error.message}</ErrorText>
        </Panel>
      ) : products.data.length === 0 ? (
        <Panel>
          <p className="text-sm text-soft/70">No products yet. Create one to open the shop.</p>
        </Panel>
      ) : (
        <>
          {reorder.error && <ErrorText>{reorder.error.message}</ErrorText>}
          <SortableList
            items={products.data}
            getId={(p) => p.id}
            getLabel={(p) => p.name}
            onReorder={(ids) => reorder.mutate(ids)}
            className="grid gap-3"
            itemClassName="min-w-0 rounded-2xl border border-line/10 bg-card"
            renderItem={(p, handle) => <ProductRow p={p} handle={handle} />}
          />
        </>
      )}

      <PaymentMethodsPanel />

      <OrdersPanel />
    </MerchGate>
  )
}
