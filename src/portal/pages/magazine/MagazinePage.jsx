import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import usePageTitle from '../../../hooks/usePageTitle.js'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { errorText } from '../../../lib/errorText.js'
import { issueErrorText, pageUrl, useIssueMutations, useIssues } from '../../magazineQueries.js'
import {
  ErrorText,
  Field,
  PageHeader,
  PageLoading,
  Panel,
  inputCls,
  outlineBtnCls,
  primaryBtnCls,
} from '../../portalUi.jsx'
import SortableList from '../../SortableList.jsx'

// /portal/magazine. The shelf: every edition in the order visitors see it
// (newest first by convention), with its cover, status and page count. CBSD
// officers and the EB add editions here and drag them into order (the handle
// at the left of each row; the arrow keys work on it too); an edition's pages,
// hero page and text are edited on its own page.

export function MagazineGate({ children }) {
  const { officerOf } = useAuth()
  if (officerOf('cbsd')) return children
  return (
    <Panel>
      <p className="text-sm text-soft/70">
        The magazine is edited by the CBSD officers and the Executive Board. If
        you think you should have access, ask the webmaster to check your
        assignment for this term.
      </p>
      <Link
        to="/portal"
        className="mt-4 inline-block text-sm font-semibold text-accent hover:text-ink"
      >
        &larr; Back to your dashboard
      </Link>
    </Panel>
  )
}

export const STATUS_LABEL = {
  draft: 'Draft',
  published: 'Published',
  missing: 'Missing copy',
}

// On a touch screen a pill is at least 44px tall, the least a finger lands on
// reliably; with a mouse it keeps the portal's compact height. In px, not
// rem, because the root size shrinks on a 320px phone.
export const tapCls = '[@media(pointer:coarse)]:min-h-[44px]'

function NewIssueForm({ onDone }) {
  const { create } = useIssueMutations()
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')

  // An error from the last try was about what the form held then.
  const typed = (setValue) => (e) => {
    if (create.isError) create.reset()
    setValue(e.target.value)
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!title.trim() || create.isPending) return
    let row
    try {
      row = await create.mutateAsync({ title: title.trim(), slug: slug.trim() })
    } catch {
      // The error shows above the buttons.
      return
    }
    onDone(row)
  }

  return (
    <Panel title="New edition" className="mb-8">
      <form onSubmit={submit} className="mt-4 grid gap-5 sm:grid-cols-2">
        <Field label="Title" htmlFor="new-issue-title" hint="As it appears in the header, for example Summer or Volume 8.">
          <input
            id="new-issue-title"
            className={inputCls}
            value={title}
            onChange={typed(setTitle)}
            maxLength={120}
            required
            autoFocus
          />
        </Field>
        <Field label="ID" htmlFor="new-issue-slug" hint="Short and permanent, for example vol-8. Made from the title when left blank.">
          <input
            id="new-issue-slug"
            className={inputCls}
            value={slug}
            onChange={typed(setSlug)}
            maxLength={40}
            placeholder="vol-8"
          />
        </Field>
        {create.error && (
          <div className="sm:col-span-2">
            <ErrorText>{issueErrorText(create.error, 'We couldn’t create the edition.')}</ErrorText>
          </div>
        )}
        <div className="flex flex-wrap gap-3 sm:col-span-2">
          <button type="submit" className={`${primaryBtnCls} ${tapCls}`} disabled={create.isPending || !title.trim()}>
            {create.isPending ? 'Creating…' : 'Create draft'}
          </button>
          <button type="button" className={`${outlineBtnCls} ${tapCls}`} onClick={() => onDone(null)}>
            Cancel
          </button>
        </div>
      </form>
    </Panel>
  )
}

// One edition on the shelf. `handle` is the grip it is dragged by
// (SortableList). On a phone the title and the line under it wrap and Edit
// sits below them, so a long title is not cut down to a few letters.
function IssueRow({ m, handle }) {
  const cover = pageUrl(m, m.hero_page)
  const to = `/portal/magazine/${m.slug}`
  return (
    <div className="flex items-center gap-3 p-3 sm:gap-4">
      {handle}
      {/* The title beside it goes to the same page and has the words, so the
          cover is left out of the keyboard's way and out of a screen reader's. */}
      <Link
        to={to}
        tabIndex={-1}
        aria-hidden="true"
        className="block aspect-[1300/1839] w-14 shrink-0 overflow-hidden rounded-lg bg-page sm:w-16"
      >
        {cover ? (
          <img src={cover} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <span className="grid h-full w-full place-items-center text-center text-3xs uppercase tracking-[0.2em] text-soft/40">
            No pages
          </span>
        )}
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <div className="min-w-0 sm:flex-1">
          <Link to={to} className="heading-serif line-clamp-2 text-lg text-ink hover:text-accent sm:line-clamp-1">
            {m.title}
          </Link>
          <p className="mt-0.5 text-xs text-soft/55 sm:truncate">
            {STATUS_LABEL[m.status] || m.status}
            {' · '}
            {m.page_count ? `${m.page_count} pages` : m.canva_url ? 'Canva embed' : 'no pages yet'}
            {' · '}
            <span className="text-soft/40">{m.slug}</span>
          </p>
        </div>
        {/* The pill is small to the eye; its ::after gives a finger 44px, in
            px because the root size shrinks on a 320px phone. */}
        <Link
          to={to}
          aria-label={`Edit ${m.title}`}
          className={`${outlineBtnCls} relative shrink-0 self-start after:absolute after:inset-x-0 after:-inset-y-[9px] after:content-[''] sm:self-auto`}
        >
          Edit
        </Link>
      </div>
    </div>
  )
}

export default function MagazinePage() {
  usePageTitle('Magazine editor')
  const issues = useIssues()
  const { reorder } = useIssueMutations()
  const [adding, setAdding] = useState(false)
  const [created, setCreated] = useState(null)

  // When the form closes, what the keyboard was on goes with it. It is put on
  // what took the form's place: the way to the new edition's pages, or the
  // button that opens the form again.
  const addButton = useRef(null)
  const nextStep = useRef(null)
  const closedWith = useRef(null) // 'created' or 'cancelled', until the focus has moved
  useEffect(() => {
    if (adding || !closedWith.current) return
    const target = closedWith.current === 'created' ? nextStep.current : addButton.current
    closedWith.current = null
    target?.focus()
  }, [adding, created])

  return (
    <MagazineGate>
      <PageHeader
        eyebrow="CBSD"
        title="Magazine"
        subtitle="Editions in the order of the switcher on the site, newest first. /magazine opens on the first published one. Drag an edition by its handle to move it."
        action={
          <div className="flex flex-wrap gap-2">
            <Link to="/magazine" target="_blank" rel="noopener noreferrer" className={`${outlineBtnCls} ${tapCls}`}>
              View on the site ↗
            </Link>
            {!adding && (
              <button type="button" ref={addButton} className={`${primaryBtnCls} ${tapCls}`} onClick={() => setAdding(true)}>
                New edition
              </button>
            )}
          </div>
        }
      />

      {adding && (
        <NewIssueForm
          onDone={(row) => {
            closedWith.current = row ? 'created' : 'cancelled'
            setAdding(false)
            if (row) setCreated(row)
          }}
        />
      )}

      {/* Always in the page, so a screen reader says the line when it comes. */}
      <div role="status">
        {created && (
          <p className="mb-6 rounded-xl border border-medical/40 bg-medical/10 px-4 py-3 text-sm text-accent">
            Draft created.{' '}
            <Link
              ref={nextStep}
              to={`/portal/magazine/${created.slug}`}
              className="font-semibold underline-offset-2 hover:underline"
            >
              Upload the pages of {created.title} &rarr;
            </Link>
          </p>
        )}
      </div>

      {/* The shelf stays up for as long as there is one to show: a later
          reading that fails must not take it away. */}
      {issues.data ? (
        issues.data.length === 0 ? (
          <Panel>
            <p className="text-sm text-soft/70">No editions yet. Create one, then upload its PDF.</p>
          </Panel>
        ) : (
          <>
            {reorder.error && (
              <div className="mb-3">
                <ErrorText>
                  {errorText(reorder.error, 'We couldn’t save the new order. The shelf shows the order that is saved.')}
                </ErrorText>
              </div>
            )}
            <SortableList
              items={issues.data}
              getId={(m) => m.id}
              getLabel={(m) => m.title}
              onReorder={(ids) => reorder.mutate(ids)}
              className="grid gap-3"
              itemClassName="min-w-0 rounded-2xl border border-line/10 bg-card"
              renderItem={(m, handle) => <IssueRow m={m} handle={handle} />}
            />
          </>
        )
      ) : issues.isPending ? (
        <PageLoading />
      ) : (
        <Panel>
          <ErrorText>{errorText(issues.error, 'We couldn’t load the editions.')}</ErrorText>
          <button
            type="button"
            className={`${outlineBtnCls} ${tapCls} mt-4`}
            onClick={() => issues.refetch()}
            disabled={issues.isFetching}
          >
            {issues.isFetching ? 'Trying…' : 'Try again'}
          </button>
        </Panel>
      )}
    </MagazineGate>
  )
}
