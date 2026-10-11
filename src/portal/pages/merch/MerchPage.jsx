import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import usePageTitle from '../../../hooks/usePageTitle.js'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { formatEGP } from '../../../lib/cart.js'
import { errorText } from '../../../lib/errorText.js'
import { useInstantSave, useProductMutations, useProducts } from '../../merchQueries.js'
import { slugify } from '../../merchForm.js'
import { useSiteSettingsAdmin, useUpsertSiteSetting } from '../../officerQueries.js'
import SortableList from '../../SortableList.jsx'
import OrdersPanel from './OrdersPanel.jsx'
import PaymentMethodsPanel from './PaymentMethodsPanel.jsx'
import {
  ErrorText,
  Field,
  PageHeader,
  PageLoading,
  Panel,
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
//
// The two kinds of switch here ("Taking orders", a product on sale) take
// effect the moment they are flipped: they move at once and are never locked
// (useInstantSave in merchQueries.js), and a save that fails puts the switch
// back and says why beside it.

// On a touch screen a button is at least a thumb tall; with a mouse it keeps
// the portal's small pill.
const tapCls = '[@media(pointer:coarse)]:min-h-[44px]'

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
  const [open, setOpen, { error }] = useInstantSave(settings.data?.merchOrdersOpen !== false, (value) =>
    save.mutateAsync({ key: 'merchOrdersOpen', value }),
  )
  // Nothing has been read yet, or the first reading failed. A later reading
  // that fails leaves the switch on what was last read, and working.
  const unread = settings.data === undefined
  const readError = unread ? settings.error : null
  return (
    <Panel className="mb-8">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">Taking orders</p>
          <p className="mt-1 text-xs text-soft/55">
            {open
              ? 'The checkout is open. Turn this off between drops: the shop stays up, and the checkout says orders are closed.'
              : 'Orders are closed: visitors can browse the shop, and the checkout turns every order away.'}
          </p>
        </div>
        {/* Off until the setting has been read: a switch drawn from a guess
            could be flipped the wrong way. */}
        <Toggle checked={open} onChange={setOpen} label="Taking orders" disabled={unread} />
      </div>
      {(readError || error) && (
        <div className="mt-3">
          <ErrorText>
            {readError
              ? errorText(readError, 'We couldn’t read whether orders are open.')
              : errorText(error, 'We couldn’t save that. The switch is back where it was.')}
          </ErrorText>
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
  // What is wrong with the id, said under its field as it is typed. A name
  // with no English letter or number in it (one written in Arabic) makes no
  // id, and the form could then not be sent without a word about why.
  const idProblem = clash
    ? `There is already a product with the id ${finalId}. Choose another.`
    : (id || name).trim() && !finalId
      ? 'Type an id in English letters or numbers. There are none here to make one from.'
      : ''
  // A name of spaces alone gets past the browser's own check of the field, so
  // it is caught here: said under the field once Create was pressed with it,
  // and until a name is typed.
  const [nameAsked, setNameAsked] = useState(false)
  const nameMissing = nameAsked && !name.trim()

  const submit = async (e) => {
    e.preventDefault()
    // The browser has asked for the name and the price by now (both are
    // required). What is left goes to the field it is about.
    if (!name.trim()) {
      setNameAsked(true)
      document.getElementById('new-product-name')?.focus()
      return
    }
    if (idProblem) {
      document.getElementById('new-product-id')?.focus()
      return
    }
    let row
    try {
      row = await create.mutateAsync({ id: finalId, name: name.trim(), price: Number(price) || 0 })
    } catch {
      // create.error says why, above the buttons.
      return
    }
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
            aria-invalid={nameMissing ? true : undefined}
            aria-describedby={nameMissing ? 'new-product-name-problem' : undefined}
          />
          {nameMissing && (
            <p id="new-product-name-problem" className="mt-1 text-xs text-danger">
              Give it a name.
            </p>
          )}
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
        <Field label="ID" htmlFor="new-product-id" hint="Short and permanent; carts and orders use it. Made from the name when left blank.">
          <input
            id="new-product-id"
            className={inputCls}
            value={id}
            onChange={(e) => setId(e.target.value)}
            maxLength={40}
            placeholder={slugify(name) || 'ausss-mug'}
            aria-invalid={idProblem ? true : undefined}
            aria-describedby={idProblem ? 'new-product-id-problem' : undefined}
          />
          {idProblem && (
            <p id="new-product-id-problem" className="mt-1 text-xs text-danger">
              {idProblem}
            </p>
          )}
        </Field>
        <div className="sm:col-span-3">
          {create.error && (
            <ErrorText>
              {create.error.code === '23505'
                ? `There is already a product with the id ${finalId}. Choose another.`
                : errorText(create.error, 'We couldn’t create the product.')}
            </ErrorText>
          )}
          <p className="text-xs text-soft/55">
            A new product starts hidden. Add its picture and description, then put it on sale.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 sm:col-span-3">
          {/* Never off for want of a field: pressed too soon, the browser or
              the line under the id says what is missing. */}
          <button type="submit" className={`${primaryBtnCls} ${tapCls}`} disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create product'}
          </button>
          <button type="button" className={`${outlineBtnCls} ${tapCls}`} onClick={() => onDone(null)}>
            Cancel
          </button>
        </div>
      </form>
    </Panel>
  )
}

function ProductRow({ p, handle }) {
  const { update } = useProductMutations()
  const [onSale, setOnSale, { error }] = useInstantSave(p.available, (available) =>
    update.mutateAsync({ id: p.id, patch: { available } }),
  )
  const to = `/portal/merch/${p.id}`
  return (
    <div className="p-3">
      <div className="flex flex-wrap items-center gap-3 sm:flex-nowrap sm:gap-4">
        {handle}
        {/* The picture opens the same page as the name beside it, so the keyboard
            and a screen reader meet one link, not two, and never one with no name. */}
        <Link
          to={to}
          tabIndex={-1}
          aria-hidden="true"
          className="block aspect-[5/7] w-14 shrink-0 overflow-hidden rounded-lg bg-sunk"
        >
          {p.image ? (
            <img src={p.image} alt="" className="h-full w-full object-contain" loading="lazy" />
          ) : (
            <span className="grid h-full w-full place-items-center text-center text-3xs uppercase tracking-[0.2em] text-soft/40">
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
            {onSale ? 'on sale' : 'hidden'}
            {' · '}
            <span className="text-soft/40">{p.id}</span>
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-3">
          <Toggle checked={onSale} onChange={setOnSale} label={`${p.name} on sale`} />
          <Link to={to} className={`${outlineBtnCls} ${tapCls}`}>
            Edit
          </Link>
        </div>
      </div>
      {/* On a line of its own under the row. Inside the row it squeezed the
          name on a wide screen and moved the switch from where it was pressed. */}
      {error && (
        <div className="mt-3">
          <ErrorText>{errorText(error, 'We couldn’t save that. The switch is back where it was.')}</ErrorText>
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
  // Where the keyboard goes once the new-product form has closed, so that it
  // is not left on a button that is no longer there: on to the line about the
  // product just made ('created'), or back to the button that opened the form
  // ('button').
  const [focusNext, setFocusNext] = useState(null)
  const newButton = useRef(null)
  const createdLink = useRef(null)
  useEffect(() => {
    if (!focusNext) return
    const next = focusNext === 'created' ? createdLink : newButton
    next.current?.focus()
    setFocusNext(null)
  }, [focusNext])

  return (
    <MerchGate>
      <PageHeader
        eyebrow="Executive Board"
        title="Merch"
        subtitle="Products in the order of the shop. Drag a product by its handle to move it; the switch puts it on sale or hides it. Changes are live in the shop the moment they are saved."
        action={
          <div className="flex flex-wrap gap-2">
            <Link to="/merch" target="_blank" rel="noopener noreferrer" className={`${outlineBtnCls} ${tapCls}`}>
              View the shop ↗
            </Link>
            {!adding && (
              <button
                ref={newButton}
                type="button"
                className={`${primaryBtnCls} ${tapCls}`}
                onClick={() => setAdding(true)}
              >
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
            setFocusNext(row ? 'created' : 'button')
          }}
        />
      )}

      {/* In the page from the start and filled in later, so a screen reader
          says the line when the product has been made. */}
      <div role="status">
        {created && (
          <p className="mb-6 rounded-xl border border-medical/40 bg-medical/10 px-4 py-3 text-sm text-accent">
            Product created.{' '}
            <Link
              ref={createdLink}
              to={`/portal/merch/${created.id}`}
              className="font-semibold underline underline-offset-2"
            >
              Add the picture and description of {created.name} &rarr;
            </Link>
          </p>
        )}
      </div>

      {products.isPending ? (
        <PageLoading />
      ) : !products.data ? (
        // Only when the products were never read. A later reading that fails
        // (one follows every save) leaves the list on what it has.
        <Panel>
          <ErrorText>{errorText(products.error, 'We couldn’t load the products.')}</ErrorText>
        </Panel>
      ) : products.data.length === 0 ? (
        <Panel>
          <p className="text-sm text-soft/70">No products yet. Create one to open the shop.</p>
        </Panel>
      ) : (
        <>
          {reorder.error && (
            <div className="mb-3">
              <ErrorText>
                {errorText(reorder.error, 'We couldn’t save the new order. The products are back where they were.')}
              </ErrorText>
            </div>
          )}
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
