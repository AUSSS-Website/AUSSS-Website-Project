import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import usePageTitle from '../../../hooks/usePageTitle.js'
import {
  pageUrl,
  storagePagesBase,
  uploadPageImages,
  uploadPdfPages,
  useIssueInsights,
  useIssueMutations,
  useIssues,
} from '../../magazineQueries.js'
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
import { ConfirmButton } from '../gallery/galleryUi.jsx'
import { MagazineGate, STATUS_LABEL } from './MagazinePage.jsx'

// /portal/magazine/:slug. One edition: its text and links, its status, the
// PDF upload that makes the page images, and the hero page picker.

const EMPTY = {
  title: '',
  slug: '',
  switcher_label: '',
  date_label: '',
  blurb: '',
  download_url: '',
  canva_url: '',
}

function formFrom(m) {
  const out = {}
  for (const k of Object.keys(EMPTY)) out[k] = m[k] || ''
  return out
}

function DetailsForm({ issue }) {
  const navigate = useNavigate()
  const { update } = useIssueMutations()
  const [form, setForm] = useState(() => formFrom(issue))
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    setForm(formFrom(issue))
  }, [issue])

  const dirty = Object.keys(EMPTY).some((k) => form[k] !== (issue[k] || ''))
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    const row = await update.mutateAsync({ id: issue.id, patch: form })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    if (row.slug !== issue.slug) navigate(`/portal/magazine/${row.slug}`, { replace: true })
  }

  const setStatus = (status) => update.mutate({ id: issue.id, patch: { status } })

  return (
    <Panel title="Edition" className="mb-6">
      <form onSubmit={submit} className="mt-4 grid gap-5 sm:grid-cols-2">
        <Field label="Title" htmlFor="issue-title" hint="The page header.">
          <input id="issue-title" className={inputCls} value={form.title} onChange={set('title')} maxLength={120} required />
        </Field>
        <Field label="Switcher label" htmlFor="issue-switcher" hint="The pill in the edition switcher, when the title alone is unclear. Optional.">
          <input id="issue-switcher" className={inputCls} value={form.switcher_label} onChange={set('switcher_label')} maxLength={60} placeholder="Summer, Vol. 7" />
        </Field>
        <Field label="Line under the title" htmlFor="issue-date" hint="For example Volume 8 · A CBSD production. Optional.">
          <input id="issue-date" className={inputCls} value={form.date_label} onChange={set('date_label')} maxLength={80} />
        </Field>
        <Field label="Id" htmlFor="issue-slug" hint="Permanent id, also the key of the reads and likes counters. Change it only for a brand-new edition.">
          <input id="issue-slug" className={inputCls} value={form.slug} onChange={set('slug')} maxLength={40} pattern="[A-Za-z0-9 \-]+" required />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Description" htmlFor="issue-blurb" hint="A sentence or two under the switcher, also the text of the link preview.">
            <textarea id="issue-blurb" className={`${inputCls} min-h-[4.5rem]`} value={form.blurb} onChange={set('blurb')} maxLength={600} />
          </Field>
        </div>
        <Field label="Download link" htmlFor="issue-download" hint="The full-quality PDF, for example a Drive share link. Optional.">
          <input id="issue-download" className={inputCls} type="url" value={form.download_url} onChange={set('download_url')} placeholder="https://" />
        </Field>
        <Field label="Canva link" htmlFor="issue-canva" hint="Shown as Open on Canva, and used as the reader when there are no pages. Optional.">
          <input id="issue-canva" className={inputCls} type="url" value={form.canva_url} onChange={set('canva_url')} placeholder="https://" />
        </Field>
        {update.error && (
          <div className="sm:col-span-2">
            <ErrorText>{update.error.message}</ErrorText>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <button type="submit" className={primaryBtnCls} disabled={!dirty || update.isPending}>
            {update.isPending ? 'Saving…' : saved ? 'Saved' : 'Save'}
          </button>
          <span className="text-xs text-silver/55">Status:</span>
          {Object.entries(STATUS_LABEL).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setStatus(key)}
              disabled={update.isPending || issue.status === key}
              aria-pressed={issue.status === key}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                issue.status === key
                  ? 'border-medical/40 bg-medical/15 text-medical-light'
                  : 'border-white/15 text-silver/70 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {issue.status === 'published' && !issue.page_count && !issue.canva_url && (
          <p className="text-xs text-amber-200 sm:col-span-2">
            Published, but not on the site yet: it needs pages or a Canva link first.
          </p>
        )}
      </form>
    </Panel>
  )
}

function PagesPanel({ issue }) {
  const { update } = useIssueMutations()
  const [progress, setProgress] = useState(null) // { done, total }
  const [error, setError] = useState(null)
  const pdfRef = useRef(null)
  const imgRef = useRef(null)
  const busy = progress != null

  const run = async (job) => {
    setError(null)
    setProgress({ done: 0, total: 0 })
    try {
      const count = await job((done, total) => setProgress({ done, total }))
      await update.mutateAsync({
        id: issue.id,
        patch: { pages_base: storagePagesBase(issue.id), page_count: count },
      })
    } catch (e) {
      setError(e?.message || 'Upload failed')
    } finally {
      setProgress(null)
    }
  }

  const onPdf = (file) => file && run((p) => uploadPdfPages(issue, file, p))
  const onImages = (files) => files.length && run((p) => uploadPageImages(issue, files, p))

  return (
    <Panel title="Pages" className="mb-6">
      <p className="mt-3 text-xs text-silver/55">
        Upload the edition&rsquo;s PDF: every page is turned into an image in your browser and uploaded, which replaces
        the current pages. Large PDFs take a minute or two; keep this tab open.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" className={primaryBtnCls} onClick={() => pdfRef.current?.click()} disabled={busy}>
          {issue.page_count ? 'Replace pages from a PDF' : 'Upload the PDF'}
        </button>
        <button type="button" className={outlineBtnCls} onClick={() => imgRef.current?.click()} disabled={busy}>
          Or pick page images
        </button>
        <input
          ref={pdfRef}
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            onPdf(f)
          }}
        />
        <input
          ref={imgRef}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          onChange={(e) => {
            const files = Array.from(e.target.files || [])
            e.target.value = ''
            onImages(files)
          }}
        />
        {progress && (
          <span className="text-sm text-silver/70" aria-live="polite">
            {progress.total ? `Page ${progress.done} of ${progress.total}…` : 'Reading the file…'}
          </span>
        )}
      </div>
      {error && <ErrorText>{error}</ErrorText>}
      {issue.page_count > 0 && (
        <p className="mt-4 text-xs text-silver/55">
          {issue.page_count} pages
          {issue.pages_base.startsWith('/assets/') && ' (built into the site before the portal; uploading a PDF moves them online)'}
          . Click a page to make it the cover shown in the header, the switcher and link previews.
        </p>
      )}
      {issue.page_count > 0 && (
        <ul className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-8">
          {Array.from({ length: issue.page_count }, (_, i) => i + 1).map((n) => {
            const hero = n === issue.hero_page
            return (
              <li key={n}>
                <button
                  type="button"
                  onClick={() => !hero && update.mutate({ id: issue.id, patch: { hero_page: n } })}
                  disabled={update.isPending}
                  aria-pressed={hero}
                  aria-label={`Page ${n}${hero ? ', the cover' : ', make it the cover'}`}
                  className={`relative block w-full overflow-hidden rounded-lg border bg-forest-950 transition-colors ${
                    hero ? 'border-medical' : 'border-white/10 hover:border-white/40'
                  }`}
                >
                  <img src={pageUrl(issue, n)} alt="" loading="lazy" className="aspect-[1300/1839] w-full object-cover" />
                  <span className="absolute bottom-1 left-1 rounded-full bg-forest-950/80 px-1.5 text-[10px] font-semibold text-white">
                    {n}
                  </span>
                  {hero && (
                    <span className="absolute right-1 top-1 rounded-full bg-medical px-1.5 text-[10px] font-bold uppercase tracking-[0.15em] text-forest-950">
                      Cover
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

// Reads, likes, downloads and how far readers get. `reach[n]` is how many
// reading sessions reached page n or further, drawn as one bar per page.
function ReadersPanel({ issue }) {
  const q = useIssueInsights(issue.slug)
  const d = q.data
  const tracked = d?.tracked || 0
  const maxReach = d?.reach?.[0]?.readers || 0
  const pct = (n) => (tracked ? Math.round((100 * n) / tracked) : 0)
  return (
    <Panel title="Readers" className="mb-6">
      {q.isPending ? (
        <p className="mt-3 text-sm text-silver/60">Loading…</p>
      ) : q.error ? (
        <ErrorText>{q.error.message}</ErrorText>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              ['Reads', d.views],
              ['Likes', d.likes],
              ['Downloads', d.downloads],
              ['Read to the end', tracked ? `${pct(d.finished)}%` : '–'],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-white/10 bg-forest-950 p-3">
                <dt className="text-[10px] font-semibold uppercase tracking-[0.2em] text-silver/50">{label}</dt>
                <dd className="heading-serif mt-1 text-2xl text-white">{value}</dd>
              </div>
            ))}
          </dl>
          {tracked > 0 ? (
            <>
              <p className="mt-4 text-xs text-silver/55">
                Since 2026-09-24 the site records how far each reader gets. {tracked} tracked{' '}
                {tracked === 1 ? 'session' : 'sessions'}; the median reader stops at page{' '}
                {Math.round(d.median_page || 0)} of {issue.page_count}. Each bar is the share of readers who reached
                that page.
              </p>
              <ol className="mt-3 flex h-24 items-end gap-px" aria-label="Readers reaching each page">
                {d.reach.map((r) => (
                  <li
                    key={r.page}
                    className="group relative flex-1 rounded-t bg-medical/70 transition-colors hover:bg-medical"
                    style={{ height: `${maxReach ? Math.max(4, (100 * r.readers) / maxReach) : 4}%` }}
                    title={`Page ${r.page}: ${r.readers} ${r.readers === 1 ? 'reader' : 'readers'} (${pct(r.readers)}%)`}
                  >
                    <span className="sr-only">
                      Page {r.page}: {r.readers} readers
                    </span>
                  </li>
                ))}
              </ol>
              <div className="mt-1 flex justify-between text-[10px] text-silver/40">
                <span>Page 1</span>
                <span>Page {issue.page_count}</span>
              </div>
            </>
          ) : (
            <p className="mt-4 text-xs text-silver/55">
              Reading depth is recorded from 2026-09-24 on; the reads before that come from the old counter. No
              tracked reading session yet.
            </p>
          )}
        </>
      )}
    </Panel>
  )
}

function IssueEditor({ issue }) {
  const navigate = useNavigate()
  const { remove } = useIssueMutations()
  const deleteIssue = async () => {
    await remove.mutateAsync(issue)
    navigate('/portal/magazine', { replace: true })
  }
  return (
    <>
      <PageHeader
        eyebrow={
          <Link to="/portal/magazine" className="hover:text-white">
            &larr; All editions
          </Link>
        }
        title={issue.title}
        subtitle={`${STATUS_LABEL[issue.status] || issue.status} · ${issue.slug}`}
        action={
          <Link to="/magazine" target="_blank" rel="noopener noreferrer" className={outlineBtnCls}>
            View on the site ↗
          </Link>
        }
      />
      <DetailsForm issue={issue} />
      {issue.status !== 'missing' && <ReadersPanel issue={issue} />}
      <PagesPanel issue={issue} />
      <Panel title="Delete edition" className="mt-8">
        <p className="mt-3 text-xs text-silver/55">
          Removes the edition and any pages uploaded from the portal. Prefer marking it as a draft. This cannot be undone.
        </p>
        <div className="mt-4">
          <ConfirmButton
            label="Delete this edition"
            confirmLabel="Delete edition and pages"
            onConfirm={deleteIssue}
            disabled={remove.isPending}
          />
        </div>
        {remove.error && <ErrorText>{remove.error.message}</ErrorText>}
      </Panel>
    </>
  )
}

export default function IssueEditorPage() {
  const { slug } = useParams()
  const issues = useIssues()
  const issue = (issues.data || []).find((m) => m.slug === slug)
  usePageTitle(issue ? `Edit ${issue.title}` : 'Edit edition')

  return (
    <MagazineGate>
      {issues.isPending ? (
        <Centered>
          <Spinner />
        </Centered>
      ) : issues.error ? (
        <Panel>
          <ErrorText>Couldn’t load the edition: {issues.error.message}</ErrorText>
        </Panel>
      ) : !issue ? (
        <Panel>
          <p className="text-sm text-silver/70">No edition with the id {slug}.</p>
          <Link to="/portal/magazine" className="mt-4 inline-block text-sm font-semibold text-medical-light hover:text-white">
            &larr; All editions
          </Link>
        </Panel>
      ) : (
        <IssueEditor issue={issue} />
      )}
    </MagazineGate>
  )
}
