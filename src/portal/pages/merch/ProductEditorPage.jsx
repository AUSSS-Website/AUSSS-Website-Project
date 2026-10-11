import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import useLeaveWarning from '../../../hooks/useLeaveWarning.js'
import usePageTitle from '../../../hooks/usePageTitle.js'
import { errorText } from '../../../lib/errorText.js'
import {
  removeProductImage,
  uploadProductImage,
  useInstantSave,
  useProductMutations,
  useProducts,
} from '../../merchQueries.js'
import {
  CheckField,
  ConfirmButton,
  ErrorText,
  Field,
  PageHeader,
  PageLoading,
  Panel,
  SaveStatus,
  Toggle,
  UndoLine,
  inputCls,
  outlineBtnCls,
  panelTitleCls,
  primaryBtnCls,
} from '../../portalUi.jsx'
import { MerchGate } from './MerchPage.jsx'
import { splitList } from '../../merchForm.js'

// /portal/merch/:id. One product: its card text, price, sizes and designs, its
// picture and size chart, whether it is on sale, and removing it.

// On a touch screen a button is at least a thumb tall; with a mouse it keeps
// the portal's small pill.
const tapCls = '[@media(pointer:coarse)]:min-h-[44px]'

// A held Enter presses a button again and again. On "Undo changes" and "Put
// them back" that would undo, put back, undo: only a fresh press counts.
const freshPressOnly = (e) => {
  if (e.key === 'Enter' && e.repeat) e.preventDefault()
}

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

function DetailsForm({ product: given, onDirty }) {
  const { update } = useProductMutations()
  // The form reads the product for itself, so the render that follows its own
  // save already holds the saved row. Handed down from the page, the row
  // arrives a moment later and the form would look unsaved for a frame.
  const product = useProducts().data?.find((p) => p.id === given.id) ?? given
  const [form, setForm] = useState(() => formFrom(product))
  const [saved, setSaved] = useState(false)
  // What "Undo changes" last threw away, for the line that offers it back.
  const [undone, setUndone] = useState(null)
  // Every edit: the form is no longer the saved one, there is nothing left to
  // put back, and an error from the last save was about what the form held then.
  const edited = () => {
    setSaved(false)
    setUndone(null)
    if (update.isError) update.reset()
  }
  const set = (key) => (e) => {
    const { value } = e.target
    edited()
    setForm((f) => ({ ...f, [key]: value }))
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
  useLeaveWarning(dirty)
  // The page's way back asks first while there is typing here to lose.
  useEffect(() => {
    onDirty(dirty)
  }, [dirty, onDirty])

  const designs = splitList(form.designs)
  const toggleWide = (d) => {
    edited()
    setForm((f) => ({
      ...f,
      wideDesigns: f.wideDesigns.includes(d) ? f.wideDesigns.filter((x) => x !== d) : [...f.wideDesigns, d],
    }))
  }

  // "Undo changes" and "Put them back" each go when pressed, and the other
  // comes in its place. When the keyboard was on the one that went, it moves
  // to the one that came: left alone it would be on nothing, and the next Tab
  // would start from the top of the page.
  const undoButton = useRef(null)
  const undoLine = useRef(null)
  const focusNext = useRef(null) // 'offer' or 'undo', until the focus has moved
  useEffect(() => {
    const next = focusNext.current
    focusNext.current = null
    if (next === 'offer') undoLine.current?.querySelector('button')?.focus()
    if (next === 'undo') undoButton.current?.focus()
  }, [undone])

  const undoChanges = (e) => {
    if (document.activeElement === e.currentTarget) focusNext.current = 'offer'
    if (update.isError) update.reset()
    setUndone(form)
    setForm(formFrom(product))
  }
  const putBack = (e) => {
    if (document.activeElement === e.currentTarget) focusNext.current = 'undo'
    setSaved(false)
    setForm(undone)
    setUndone(null)
  }

  // A name of spaces alone gets past the browser's own check of the field, so
  // it is caught here: said under the field once Save was pressed with it, and
  // until a name is typed.
  const [nameAsked, setNameAsked] = useState(false)
  const nameMissing = nameAsked && !form.name.trim()

  const submit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) {
      setNameAsked(true)
      document.getElementById('p-name')?.focus()
      return
    }
    const sent = form
    let row
    try {
      row = await update.mutateAsync({ id: product.id, patch: patchFrom(sent) })
    } catch {
      // update.error says why, under the buttons.
      return
    }
    // The form takes the row as it was stored (trimmed, the lists tidied), so
    // a space typed after a name does not leave it looking unsaved. Anything
    // typed while the save was on its way is kept, and still to be saved.
    setForm((f) => (f === sent ? formFrom(row) : f))
    setSaved(true)
  }

  return (
    <Panel title="On its card">
      <form onSubmit={submit} className="mt-4 grid gap-5 sm:grid-cols-2">
        <Field label="Name" htmlFor="p-name">
          <input
            id="p-name"
            className={inputCls}
            value={form.name}
            onChange={set('name')}
            maxLength={140}
            required
            aria-invalid={nameMissing ? true : undefined}
            aria-describedby={nameMissing ? 'p-name-problem' : undefined}
          />
          {nameMissing && (
            <p id="p-name-problem" className="mt-1 text-xs text-danger">
              Give it a name.
            </p>
          )}
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
            <p className={panelTitleCls}>Wide designs</p>
            <p className="mt-1 text-xs text-soft/50">Designs with a long name take a whole row in the picker.</p>
            {/* Tick boxes, as these wait for Save like the rest of the form. */}
            <div className="flex flex-wrap gap-x-6">
              {designs.map((d) => (
                <CheckField key={d} checked={form.wideDesigns.includes(d)} onChange={() => toggleWide(d)} label={d} />
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          {/* Off only while there is nothing to save. With the name emptied it
              stays on, and pressing it goes to the name, which says why. */}
          <button type="submit" className={`${primaryBtnCls} ${tapCls}`} disabled={update.isPending || !dirty}>
            {update.isPending ? 'Saving…' : 'Save'}
          </button>
          {dirty && (
            <button
              type="button"
              ref={undoButton}
              className={`${outlineBtnCls} ${tapCls}`}
              disabled={update.isPending}
              onClick={undoChanges}
              onKeyDown={freshPressOnly}
            >
              Undo changes
            </button>
          )}
          <SaveStatus dirty={dirty && !update.isPending} saved={saved} savedText="Saved. The shop shows it now." />
        </div>
        {/* Always in the page, and empty until changes are undone, so a screen
            reader says the line when it comes. The wrapper is no box of its
            own: it is there to find the line's button by. */}
        <div ref={undoLine} className="contents" onKeyDown={freshPressOnly}>
          <UndoLine className="py-1 sm:col-span-2" undoLabel="Put them back" onUndo={putBack}>
            {undone ? 'Changes undone.' : null}
          </UndoLine>
        </div>
        {update.error && (
          <div className="sm:col-span-2">
            <ErrorText>{errorText(update.error, 'We couldn’t save the product.')}</ErrorText>
          </div>
        )}
      </form>
    </Panel>
  )
}

// One picture of the product (its photo, or its size chart): shows it, and
// replaces or removes it. Replacing is one act, the choice of a new file.
// Removing deletes the stored file, so it asks first.
function PictureSlot({ product, column, label, hint, removable }) {
  const { update } = useProductMutations()
  const inputRef = useRef(null)
  const chooseRef = useRef(null)
  const actionsRef = useRef(null)
  // What is being done to the picture: '', 'upload' or 'remove'.
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  // What was last done, for a screen reader: the picture changing says it to the eye.
  const [said, setSaid] = useState('')
  const current = product[column]
  // Leaving part-way would cut the upload off, or leave a file no product points at.
  useLeaveWarning(busy)

  // Remove goes with the picture. When the keyboard was on it, it moves to
  // the button that is left, once that button can take it again.
  const focusChoose = useRef(false)
  useEffect(() => {
    if (busy || !focusChoose.current) return
    focusChoose.current = false
    chooseRef.current?.focus()
  }, [busy])

  const replace = async (file) => {
    if (!file) return
    setBusy('upload')
    setError('')
    setSaid('')
    try {
      const url = await uploadProductImage(product.id, file)
      try {
        await update.mutateAsync({ id: product.id, patch: { [column]: url } })
      } catch (err) {
        await removeProductImage(url).catch(() => {})
        throw err
      }
      await removeProductImage(current).catch(() => {})
      setSaid(`${label} uploaded.`)
    } catch (err) {
      setError(errorText(err, 'The picture could not be uploaded.'))
    } finally {
      setBusy('')
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const clear = async () => {
    const hadFocus = Boolean(actionsRef.current?.contains(document.activeElement))
    setBusy('remove')
    setError('')
    setSaid('')
    try {
      await update.mutateAsync({ id: product.id, patch: { [column]: '' } })
      await removeProductImage(current).catch(() => {})
      setSaid(`${label} removed.`)
      focusChoose.current = hadFocus
    } catch (err) {
      setError(errorText(err, 'The picture could not be removed.'))
    } finally {
      setBusy('')
    }
  }

  return (
    <div role="group" aria-labelledby={`pic-${column}-title`} className="flex gap-4">
      <div className="aspect-[5/7] w-28 shrink-0 overflow-hidden rounded-xl bg-sunk">
        {current ? (
          <img src={current} alt="" className="h-full w-full object-contain" />
        ) : (
          <span className="grid h-full w-full place-items-center text-center text-3xs uppercase tracking-[0.2em] text-soft/40">
            None
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p id={`pic-${column}-title`} className="text-sm font-semibold text-ink">
          {label}
        </p>
        <p className="mt-1 text-xs text-soft/55">{hint}</p>
        <div ref={actionsRef} className="mt-3 flex flex-wrap items-center gap-2">
          {/* The file box itself stays out of sight, out of the tab order and
              out of a screen reader's way; the button below opens it, so the
              keyboard lands on something that shows where it is and says what
              it does. */}
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => replace(e.target.files?.[0])}
            disabled={Boolean(busy)}
          />
          <button
            ref={chooseRef}
            type="button"
            className={`${outlineBtnCls} ${tapCls}`}
            disabled={Boolean(busy)}
            onClick={() => inputRef.current?.click()}
          >
            {busy === 'upload' ? 'Uploading…' : current ? 'Replace' : 'Upload'}
          </button>
          {removable && current && (
            <ConfirmButton
              className={`${outlineBtnCls} ${tapCls}`}
              label="Remove"
              busyLabel="Removing…"
              busy={busy === 'remove'}
              disabled={Boolean(busy)}
              onConfirm={clear}
            />
          )}
        </div>
        <p role="status" className="sr-only">
          {said}
        </p>
        {error && (
          <div className="mt-2">
            <ErrorText>{error}</ErrorText>
          </div>
        )}
      </div>
    </div>
  )
}

// One line of small capitals to the eye; its ::after gives a finger 44px of
// height, in px because the root size shrinks on a 320px phone.
const backCls =
  "relative uppercase tracking-[0.22em] transition-colors hover:text-ink after:absolute after:-inset-x-2 after:top-1/2 after:h-[44px] after:-translate-y-1/2 after:content-['']"

// The way back to the list. With unsaved typing in the form it asks first, on
// itself, as every other discard in the portal does: the router changes the
// screen without the browser's own question, which is only put for a closed
// tab or a reload (useLeaveWarning).
function BackToProducts({ ask }) {
  const navigate = useNavigate()
  if (!ask) {
    return (
      <Link to="/portal/merch" className={backCls}>
        &larr; All products
      </Link>
    )
  }
  return (
    // The red "Discard changes" is read as a sentence, not in the eyebrow's
    // spaced capitals.
    <span className="normal-case tracking-normal">
      <ConfirmButton
        variant="text"
        confirmLabel="Discard changes"
        onConfirm={() => navigate('/portal/merch')}
        className={backCls}
      >
        &larr; All products
      </ConfirmButton>
    </span>
  )
}

function ProductEditor({ product }) {
  const navigate = useNavigate()
  const { update, remove } = useProductMutations()
  // Whether the details form holds typing that is not saved (it says so itself).
  const [unsaved, setUnsaved] = useState(false)
  const [onSale, setOnSale, sale] = useInstantSave(product.available, (available) =>
    update.mutateAsync({ id: product.id, patch: { available } }),
  )
  const deleteProduct = async () => {
    try {
      await remove.mutateAsync(product)
    } catch {
      // remove.error says why, under the button.
      return
    }
    navigate('/portal/merch', { replace: true })
  }
  return (
    <>
      <PageHeader
        eyebrow={
          // As tall as the red pill the way back turns into, so the heading
          // under it does not move when it asks.
          <span className="flex min-h-5 items-center">
            <BackToProducts ask={unsaved} />
          </span>
        }
        title={product.name}
        subtitle={`${onSale ? 'On sale' : 'Hidden'} · ${product.id}`}
        action={
          <Link to="/merch" target="_blank" rel="noopener noreferrer" className={`${outlineBtnCls} ${tapCls}`}>
            View the shop ↗
          </Link>
        }
      />

      <Panel className="mb-8">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">On sale</p>
            <p className="mt-1 text-xs text-soft/55">
              {onSale
                ? 'Shown in the shop and can be ordered.'
                : 'Hidden from the shop. Carts that hold it drop it, and an order for it is not taken.'}
            </p>
          </div>
          <Toggle checked={onSale} onChange={setOnSale} label="On sale" />
        </div>
        {sale.error && (
          <div className="mt-3">
            <ErrorText>{errorText(sale.error, 'We couldn’t save that. The switch is back where it was.')}</ErrorText>
          </div>
        )}
      </Panel>

      <DetailsForm product={product} onDirty={setUnsaved} />

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
            className={`${outlineBtnCls} ${tapCls}`}
            keepWidth
            label="Remove this product"
            confirmLabel="Remove product and pictures"
            busyLabel="Removing…"
            busy={remove.isPending}
            onConfirm={deleteProduct}
          />
        </div>
        {remove.error && (
          <div className="mt-3">
            <ErrorText>{errorText(remove.error, 'We couldn’t remove the product.')}</ErrorText>
          </div>
        )}
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
        <PageLoading />
      ) : !products.data ? (
        // Only when the products were never read. A later reading that fails
        // (one follows every save) leaves the page on what it has: the error
        // in its place would take the form away with whatever was typed in it.
        <Panel>
          <ErrorText>{errorText(products.error, 'We couldn’t load the product.')}</ErrorText>
        </Panel>
      ) : !product ? (
        <Panel>
          <p className="text-sm text-soft/70">No product with the id {id}.</p>
          <Link to="/portal/merch" className="mt-4 inline-block text-sm font-semibold text-accent hover:text-ink">
            &larr; All products
          </Link>
        </Panel>
      ) : (
        // Keyed by the product, so nothing typed for one is ever shown under another.
        <ProductEditor key={product.id} product={product} />
      )}
    </MerchGate>
  )
}
