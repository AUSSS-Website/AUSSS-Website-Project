import { useState } from 'react'
import { Link } from 'react-router-dom'
import usePageTitle from '../../../hooks/usePageTitle.js'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { pageUrl, useIssueMutations, useIssues } from '../../magazineQueries.js'
import {
  Centered,
  ErrorText,
  Field,
  PageHeader,
  Panel,
  Spinner,
  inputCls,
  outlineBtnCls,
  primaryBtnCls,
} from '../../portalUi.jsx'

// /portal/magazine. The shelf: every edition in the order visitors see it
// (newest first by convention), with its cover, status and page count. CBSD
// officers and the EB add editions here and reorder them; an edition's pages,
// hero page and text are edited on its own page.

export function MagazineGate({ children }) {
  const { officerOf } = useAuth()
  if (officerOf('cbsd')) return children
  return (
    <Panel>
      <p className="text-sm text-silver/70">
        The magazine is edited by the CBSD officers and the Executive Board. If
        you think you should have access, ask the webmaster to check your
        assignment for this term.
      </p>
      <Link
        to="/portal"
        className="mt-4 inline-block text-sm font-semibold text-medical-light hover:text-white"
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

function NewIssueForm({ onDone }) {
  const { create } = useIssueMutations()
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    if (!title.trim()) return
    const row = await create.mutateAsync({ title: title.trim(), slug: slug.trim() })
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
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            required
            autoFocus
          />
        </Field>
        <Field label="Id" htmlFor="new-issue-slug" hint="Short and permanent, for example vol-8. Made from the title when left blank.">
          <input
            id="new-issue-slug"
            className={inputCls}
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            maxLength={40}
            placeholder="vol-8"
          />
        </Field>
        {create.error && (
          <div className="sm:col-span-2">
            <ErrorText>{create.error.message}</ErrorText>
          </div>
        )}
        <div className="flex flex-wrap gap-3 sm:col-span-2">
          <button type="submit" className={primaryBtnCls} disabled={create.isPending || !title.trim()}>
            {create.isPending ? 'Creating…' : 'Create draft'}
          </button>
          <button type="button" className={outlineBtnCls} onClick={() => onDone(null)}>
            Cancel
          </button>
        </div>
      </form>
    </Panel>
  )
}

function IssueRow({ m, index, total, onMove, moving }) {
  const cover = pageUrl(m, m.hero_page)
  return (
    <li className="flex flex-wrap items-center gap-4 rounded-2xl border border-white/10 bg-forest-800 p-3 sm:flex-nowrap">
      <Link to={`/portal/magazine/${m.slug}`} className="block aspect-[1300/1839] w-16 shrink-0 overflow-hidden rounded-lg bg-forest-950">
        {cover ? (
          <img src={cover} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <span className="grid h-full w-full place-items-center text-center text-[9px] uppercase tracking-[0.2em] text-silver/40">
            No pages
          </span>
        )}
      </Link>
      <div className="min-w-0 flex-1">
        <Link to={`/portal/magazine/${m.slug}`} className="heading-serif block truncate text-lg text-white hover:text-medical-light">
          {m.title}
        </Link>
        <p className="mt-0.5 truncate text-xs text-silver/55">
          {STATUS_LABEL[m.status] || m.status}
          {' · '}
          {m.page_count ? `${m.page_count} pages` : m.canva_url ? 'Canva embed' : 'no pages yet'}
          {' · '}
          <span className="text-silver/40">{m.slug}</span>
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          className={outlineBtnCls}
          onClick={() => onMove(index, index - 1)}
          disabled={moving || index === 0}
          aria-label={`Move ${m.title} up`}
        >
          ↑
        </button>
        <button
          type="button"
          className={outlineBtnCls}
          onClick={() => onMove(index, index + 1)}
          disabled={moving || index === total - 1}
          aria-label={`Move ${m.title} down`}
        >
          ↓
        </button>
        <Link to={`/portal/magazine/${m.slug}`} className={outlineBtnCls}>
          Edit
        </Link>
      </div>
    </li>
  )
}

export default function MagazinePage() {
  usePageTitle('Magazine editor')
  const issues = useIssues()
  const { reorder } = useIssueMutations()
  const [adding, setAdding] = useState(false)
  const [created, setCreated] = useState(null)

  const move = (from, to) => {
    const ids = (issues.data || []).map((m) => m.id)
    if (to < 0 || to >= ids.length) return
    const [id] = ids.splice(from, 1)
    ids.splice(to, 0, id)
    reorder.mutate(ids)
  }

  return (
    <MagazineGate>
      <PageHeader
        eyebrow="CBSD"
        title="Magazine"
        subtitle="Editions in the order of the switcher on the site, newest first. /magazine opens on the first published one."
        action={
          <div className="flex flex-wrap gap-2">
            <Link to="/magazine" target="_blank" rel="noopener noreferrer" className={outlineBtnCls}>
              View on the site ↗
            </Link>
            {!adding && (
              <button type="button" className={primaryBtnCls} onClick={() => setAdding(true)}>
                New edition
              </button>
            )}
          </div>
        }
      />

      {adding && (
        <NewIssueForm
          onDone={(row) => {
            setAdding(false)
            if (row) setCreated(row)
          }}
        />
      )}

      {created && (
        <p className="mb-6 rounded-xl border border-medical/40 bg-medical/10 px-4 py-3 text-sm text-medical-light">
          Draft created.{' '}
          <Link to={`/portal/magazine/${created.slug}`} className="font-semibold underline-offset-2 hover:underline">
            Upload the pages of {created.title} &rarr;
          </Link>
        </p>
      )}

      {issues.isPending ? (
        <Centered>
          <Spinner />
        </Centered>
      ) : issues.error ? (
        <Panel>
          <ErrorText>Couldn’t load the editions: {issues.error.message}</ErrorText>
        </Panel>
      ) : issues.data.length === 0 ? (
        <Panel>
          <p className="text-sm text-silver/70">No editions yet. Create one, then upload its PDF.</p>
        </Panel>
      ) : (
        <>
          {reorder.error && <ErrorText>{reorder.error.message}</ErrorText>}
          <ul className="grid gap-3">
            {issues.data.map((m, i) => (
              <IssueRow key={m.id} m={m} index={i} total={issues.data.length} onMove={move} moving={reorder.isPending} />
            ))}
          </ul>
        </>
      )}
    </MagazineGate>
  )
}
