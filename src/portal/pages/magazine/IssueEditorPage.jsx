import { memo, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import usePageTitle from '../../../hooks/usePageTitle.js'
import useLeaveWarning from '../../../hooks/useLeaveWarning.js'
import { errorText } from '../../../lib/errorText.js'
import { pressCls } from '../../../lib/motion.js'
import {
  issueErrorText,
  pageUrl,
  sweepPages,
  uploadPageImages,
  uploadPdfPages,
  useIssueInsights,
  useIssueMutations,
  useIssues,
} from '../../magazineQueries.js'
import {
  ErrorText,
  Field,
  PageHeader,
  PageLoading,
  Panel,
  SaveStatus,
  UndoLine,
  inputCls,
  outlineBtnCls,
  primaryBtnCls,
} from '../../portalUi.jsx'
import { ConfirmButton } from '../gallery/galleryUi.jsx'
import ExportButtons from '../../ExportButtons.jsx'
import { MagazineGate, STATUS_LABEL, tapCls } from './MagazinePage.jsx'

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

// A control that is small to the eye still gives a finger 44px: its ::after
// reaches past it above and below. In px, because the root size shrinks on a
// 320px phone.
const reachCls = "relative after:absolute after:inset-x-0 after:-inset-y-[12px] after:content-['']"
const focusCls =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'
// A button that is switched off for a while but keeps the keyboard's focus,
// which a disabled button would drop.
const offCls = 'aria-disabled:pointer-events-none aria-disabled:opacity-40'

// A held Enter presses a button again and again. On the two buttons below that
// would undo, put back, undo: only a fresh press counts.
const freshPressOnly = (e) => {
  if (e.key === 'Enter' && e.repeat) e.preventDefault()
}

function DetailsForm({ issue: given }) {
  const navigate = useNavigate()
  const { update, change } = useIssueMutations()
  // The form reads the edition for itself, so the render that follows its own
  // save already holds the saved row. Handed down from the page, the row
  // arrives a moment later and the form would look unsaved for a frame.
  const issue = useIssues().data?.find((m) => m.id === given.id) ?? given
  const [form, setForm] = useState(() => formFrom(issue))
  const [saved, setSaved] = useState(false)
  // What "Undo changes" last threw away, for the line that offers it back.
  const [undone, setUndone] = useState(null)

  // Follow the row when its text changes elsewhere (another editor saved),
  // unless there are unsaved edits here. A reading that brings the same text
  // back (after a status change, a new cover or an upload) leaves the form
  // alone, so nothing typed is lost to it.
  const base = JSON.stringify(formFrom(issue))
  const current = JSON.stringify(form)
  const dirty = current !== base
  const lastBase = useRef(base)
  useEffect(() => {
    if (base !== lastBase.current && current === lastBase.current) setForm(formFrom(issue))
    lastBase.current = base
  }, [base, current, issue])
  useLeaveWarning(dirty)

  const set = (k) => (e) => {
    const { value } = e.target
    setSaved(false)
    setUndone(null)
    // An error from the last save was about what the form held then.
    if (update.isError) update.reset()
    setForm((f) => ({ ...f, [k]: value }))
  }

  // "Undo changes" and "Put them back" each go when pressed, and the other
  // comes in its place. The keyboard is moved to the one that came, or it
  // would be left on nothing and start again from the top of the page.
  const undoButton = useRef(null)
  const undoLine = useRef(null)
  const focusNext = useRef(null) // 'offer' or 'undo', until the focus has moved
  useEffect(() => {
    const next = focusNext.current
    focusNext.current = null
    if (next === 'offer') undoLine.current?.querySelector('button')?.focus()
    if (next === 'undo') undoButton.current?.focus()
  }, [undone])

  const undo = () => {
    if (update.isError) update.reset()
    focusNext.current = 'offer'
    setUndone(form)
    setForm(formFrom(issue))
  }

  const putBack = () => {
    focusNext.current = 'undo'
    setSaved(false)
    setForm(undone)
    setUndone(null)
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!dirty || update.isPending) return
    const sent = form
    let row
    try {
      row = await update.mutateAsync({ id: issue.id, patch: sent })
    } catch {
      // The error shows above the button.
      return
    }
    // The database tidies what it stores (spaces trimmed, the ID made
    // lowercase), so the form takes the saved row and is clean again.
    // Anything typed while the save was on its way is kept, and still to be
    // saved.
    setForm((f) => (f === sent ? formFrom(row) : f))
    setSaved(true)
    if (row.slug !== issue.slug) navigate(`/portal/magazine/${row.slug}`, { replace: true })
  }

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
        <Field label="ID" htmlFor="issue-slug" hint="Permanent id, also the key of the reads and likes counters. Change it only for a brand-new edition.">
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
            <ErrorText>{issueErrorText(update.error, 'We couldn’t save the edition.')}</ErrorText>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <button type="submit" className={`${primaryBtnCls} ${tapCls}`} disabled={!dirty || update.isPending}>
            {update.isPending ? 'Saving…' : 'Save'}
          </button>
          {dirty && (
            <button
              type="button"
              ref={undoButton}
              className={`${outlineBtnCls} ${tapCls}`}
              onClick={undo}
              onKeyDown={freshPressOnly}
              disabled={update.isPending}
            >
              Undo changes
            </button>
          )}
          <SaveStatus dirty={dirty && !update.isPending} saved={saved} />
        </div>
        {/* Always in the page, and empty until changes are undone, so a screen
            reader says the line when it comes. The wrapper is no box of its
            own: it is there to find the line's button by. */}
        <div ref={undoLine} className="contents" onKeyDown={freshPressOnly}>
          <UndoLine className="py-1 sm:col-span-2" undoLabel="Put them back" onUndo={putBack}>
            {undone ? 'Changes undone.' : null}
          </UndoLine>
        </div>
      </form>

      {/* The status is no part of the form above: it is saved the moment it is
          chosen, so it stands on its own and does not wait for Save. */}
      <div className="mt-6 border-t border-line/10 pt-5">
        <p id="issue-status" className="text-sm font-medium text-ink">
          Status
        </p>
        <p className="mt-1 text-xs text-soft/50">Takes effect at once, without Save.</p>
        {/* On a phone the pills wrap. The rows stand further apart than a
            pill reaches (reachCls), so one row's reach never lies over the
            pill above it. */}
        <div role="group" aria-labelledby="issue-status" className="mt-3 flex flex-wrap gap-x-2 gap-y-3.5">
          {Object.entries(STATUS_LABEL).map(([key, label]) => {
            const on = issue.status === key
            return (
              <button
                key={key}
                type="button"
                onClick={() => !on && change.mutate({ id: issue.id, patch: { status: key } })}
                aria-pressed={on}
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${reachCls} ${pressCls} ${focusCls} ${
                  on ? 'border-medical/40 bg-medical/15 text-accent' : 'border-line/15 text-soft/70 hover:text-ink'
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>
        {change.error && (
          <div className="mt-3">
            <ErrorText>{errorText(change.error, 'We couldn’t change the status.')}</ErrorText>
          </div>
        )}
        {issue.status === 'published' && !issue.page_count && !issue.canva_url && (
          <p className="mt-3 text-xs text-warn">
            Published, but not on the site yet: it needs pages or a Canva link first.
          </p>
        )}
      </div>
    </Panel>
  )
}

// Where an upload had got to when it failed, for an error that has nothing
// fit to show of its own.
function stoppedAt({ done, total }) {
  if (!total) return 'The upload couldn’t start.'
  if (done < total) return `Page ${done + 1} of ${total} couldn’t be uploaded.`
  return 'The new pages were uploaded, but the edition couldn’t be switched to them.'
}

// The edition's pages as thumbnails; a click makes one the cover. Kept apart
// from the upload's progress, which would otherwise redraw every thumbnail
// each time a page lands. The cover moves the moment it is chosen and moves
// back if the save fails (`change` in magazineQueries.js).
const PageGrid = memo(function PageGrid({ issue }) {
  const { change } = useIssueMutations()
  return (
    <>
      {change.error && (
        <div className="mt-3">
          <ErrorText>{errorText(change.error, 'We couldn’t change the cover.')}</ErrorText>
        </div>
      )}
      <ul className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-8">
        {Array.from({ length: issue.page_count }, (_, i) => i + 1).map((n) => {
          const hero = n === issue.hero_page
          return (
            <li key={n}>
              <button
                type="button"
                onClick={() => !hero && change.mutate({ id: issue.id, patch: { hero_page: n } })}
                aria-pressed={hero}
                aria-label={`Page ${n}${hero ? ', the cover' : ', make it the cover'}`}
                className={`relative block w-full overflow-hidden rounded-lg border bg-page ${pressCls} ${focusCls} ${
                  hero ? 'border-medical' : 'border-line/10 hover:border-line/40'
                }`}
              >
                <img src={pageUrl(issue, n)} alt="" loading="lazy" className="aspect-[1300/1839] w-full object-cover" />
                <span className="absolute bottom-1 left-1 rounded-full bg-page/80 px-1.5 text-3xs font-semibold text-ink contrast-more:bg-page">
                  {n}
                </span>
                {hero && (
                  <span className="absolute right-1 top-1 rounded-full bg-cta px-1.5 text-3xs font-bold uppercase tracking-[0.15em] text-on-cta">
                    Cover
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </>
  )
})

// `onUploading(true or false)` tells the page whether an upload is running, so
// it can hold the ways out that would cut it off.
function PagesPanel({ issue, onUploading }) {
  const { refetch } = useIssues()
  const [progress, setProgress] = useState(null) // { done, total } while an upload runs
  const [stopping, setStopping] = useState(false)
  const [error, setError] = useState(null)
  const [note, setNote] = useState(null) // { text, ok }: how the last upload ended
  const pdfRef = useRef(null)
  const imgRef = useRef(null)
  const pdfBtn = useRef(null)
  const stopBtn = useRef(null)
  const stopper = useRef(null) // the AbortController of the upload in progress
  const busy = progress != null
  useLeaveWarning(busy)
  useEffect(() => {
    onUploading(busy)
  }, [busy, onUploading])

  // The new pages go into a folder of their own and the edition is pointed at
  // it only at the end (replacePages in magazineQueries.js), so whatever stops
  // an upload before that, the edition is as it was. The messages say so.
  const run = async (upload) => {
    if (stopper.current) return
    const stop = new AbortController()
    stopper.current = stop
    let at = { done: 0, total: 0 }
    const kept = issue.page_count > 0 ? 'The edition still shows the pages it had.' : 'No pages were added.'
    setError(null)
    setNote(null)
    setStopping(false)
    setProgress(at)
    try {
      const count = await upload((done, total) => {
        at = { done, total }
        setProgress(at)
      }, stop.signal)
      await refetch()
      setNote({ text: `${count} ${count === 1 ? 'page' : 'pages'} uploaded.`, ok: true })
    } catch (err) {
      if (err?.stopped) setNote({ text: `Upload stopped. ${kept}`, ok: false })
      // The one failure after which the edition may be showing either set of
      // pages (replacePages): its own sentence says so, and `kept` would not
      // be true.
      else if (err?.unsure) setError(err.message)
      else setError(`${errorText(err, stoppedAt(at))} ${kept}`)
    } finally {
      // The Stop button is about to go: the keyboard returns to the button
      // the upload was begun from.
      if (document.activeElement === stopBtn.current) pdfBtn.current?.focus()
      stopper.current = null
      setProgress(null)
    }
  }

  const onPdf = (file) => file && run((report, signal) => uploadPdfPages(issue, file, report, { signal }))
  const onImages = (files) =>
    files.length && run((report, signal) => uploadPageImages(issue, files, report, { signal }))

  // Takes effect before the next page is sent; the line beside the button
  // says so at once.
  const stop = () => {
    stopper.current?.abort()
    setStopping(true)
  }

  let label = ''
  if (stopping) label = 'Stopping…'
  else if (!progress?.total) label = 'Reading the file…'
  else if (progress.done < progress.total) label = `Uploading page ${progress.done + 1} of ${progress.total}…`
  else label = 'Putting the new pages in place…'

  return (
    <Panel title="Pages" className="mb-6">
      <p className="mt-3 text-xs text-soft/55">
        Upload the edition&rsquo;s PDF: every page is turned into an image in your browser and uploaded, which replaces
        the current pages. Large PDFs take a minute or two; keep this tab open.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          ref={pdfBtn}
          className={`${primaryBtnCls} ${tapCls} ${offCls}`}
          onClick={() => !busy && pdfRef.current?.click()}
          aria-disabled={busy || undefined}
        >
          {issue.page_count ? 'Replace pages from a PDF' : 'Upload the PDF'}
        </button>
        <button
          type="button"
          className={`${outlineBtnCls} ${tapCls} ${offCls}`}
          onClick={() => !busy && imgRef.current?.click()}
          aria-disabled={busy || undefined}
        >
          Or pick page images
        </button>
        {/* The two buttons above open these; the keyboard has no need to stop on them. */}
        <input
          ref={pdfRef}
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
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
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const files = Array.from(e.target.files || [])
            e.target.value = ''
            onImages(files)
          }}
        />
      </div>
      {progress && (
        <div className="mt-4 max-w-md">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm tabular-nums text-soft/70">{label}</p>
            <button
              type="button"
              ref={stopBtn}
              className={`${outlineBtnCls} ${reachCls} ${offCls}`}
              onClick={stop}
              aria-disabled={stopping || undefined}
            >
              Stop
            </button>
          </div>
          <div
            role="progressbar"
            aria-label="Uploading the pages"
            aria-valuemin={0}
            aria-valuemax={progress.total || undefined}
            aria-valuenow={progress.total ? progress.done : undefined}
            aria-valuetext={label}
            className="mt-3 h-1 overflow-hidden rounded-full bg-veil/10"
          >
            <div
              className="h-full origin-left rounded-full bg-medical motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out"
              style={{ transform: `scaleX(${progress.total ? progress.done / progress.total : 0})` }}
            />
          </div>
        </div>
      )}
      {/* Always in the page, so a screen reader says how the upload ended. */}
      <p role="status" className={note ? `mt-3 text-sm ${note.ok ? 'text-ok' : 'text-soft/70'}` : 'sr-only'}>
        {note?.text}
      </p>
      {error && (
        <div className="mt-3">
          <ErrorText>{error}</ErrorText>
        </div>
      )}
      {issue.page_count > 0 && (
        <p className="mt-4 text-xs text-soft/55">
          {issue.page_count} pages
          {issue.pages_base.startsWith('/assets/') && ' (built into the site before the portal; uploading a PDF moves them online)'}
          . Click a page to make it the cover shown in the header, the switcher and link previews.
        </p>
      )}
      {issue.page_count > 0 && <PageGrid issue={issue} />}
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
  const reachColumns = [
    { label: 'Page', value: (r) => r.page },
    { label: 'Readers who reached it', value: (r) => r.readers },
    { label: 'Share of tracked sessions', value: (r) => `${pct(r.readers)}%` },
  ]
  const summary = d
    ? [
        ['Reads', d.views],
        ['Likes', d.likes],
        ['Downloads', d.downloads],
        ['Tracked reading sessions', tracked],
        ['Read to the end', tracked ? `${d.finished} (${pct(d.finished)}%)` : 'not tracked yet'],
        ['Median page reached', tracked ? `${Math.round(d.median_page || 0)} of ${issue.page_count}` : 'not tracked yet'],
      ]
    : []
  return (
    <Panel title="Readers" className="mb-6">
      {d && (
        <div className="mt-3">
          <ExportButtons
            title={`Readers: ${issue.title}`}
            subtitle="Reads, likes, downloads and how far readers get, as recorded by the website."
            filename={`ausss-magazine-${issue.slug}-readers`}
            columns={reachColumns}
            rows={d.reach || []}
            summary={summary}
          />
        </div>
      )}
      {d ? (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              ['Reads', d.views],
              ['Likes', d.likes],
              ['Downloads', d.downloads],
              ['Read to the end', tracked ? `${pct(d.finished)}%` : '–'],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-line/10 bg-page p-3">
                <dt className="text-3xs font-semibold uppercase tracking-[0.2em] text-soft/50">{label}</dt>
                <dd className="heading-serif mt-1 text-2xl text-ink">{value}</dd>
              </div>
            ))}
          </dl>
          {tracked > 0 ? (
            <>
              <p className="mt-4 text-xs text-soft/55">
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
              <div className="mt-1 flex justify-between text-3xs text-soft/40">
                <span>Page 1</span>
                <span>Page {issue.page_count}</span>
              </div>
            </>
          ) : (
            <p className="mt-4 text-xs text-soft/55">
              Reading depth is recorded from 2026-09-24 on; the reads before that come from the old counter. No
              tracked reading session yet.
            </p>
          )}
        </>
      ) : q.isPending ? (
        <p className="mt-3 text-sm text-soft/60">Loading…</p>
      ) : (
        <div className="mt-3">
          <ErrorText>{errorText(q.error, 'We couldn’t load the readers’ numbers.')}</ErrorText>
        </div>
      )}
    </Panel>
  )
}

function IssueEditor({ issue }) {
  const navigate = useNavigate()
  const { remove } = useIssueMutations()
  // An upload is running, and leaving now would cut it off.
  const [uploading, setUploading] = useState(false)
  // The way back was pressed during an upload: the page says why it stayed.
  const [held, setHeld] = useState(false)
  useEffect(() => {
    if (!uploading) setHeld(false)
  }, [uploading])

  // The pages an upload replaced go a week later, the next time an editor is
  // here (sweepPages in magazineQueries.js).
  useEffect(() => {
    sweepPages(issue.id).catch(() => {
      /* the next visit tries again */
    })
  }, [issue.id])

  const deleteIssue = async () => {
    try {
      await remove.mutateAsync(issue)
    } catch {
      // The error shows under the button.
      return
    }
    navigate('/portal/magazine', { replace: true })
  }
  return (
    <>
      <PageHeader
        eyebrow={
          // The app has no way to ask "leave this page?" for a link of its
          // own, so during an upload the way back is switched off, and says
          // why when it is pressed.
          <Link
            to="/portal/magazine"
            aria-disabled={uploading || undefined}
            onClick={(e) => {
              if (!uploading) return
              e.preventDefault()
              setHeld(true)
            }}
            className={`relative rounded after:absolute after:inset-x-0 after:-inset-y-[15px] after:content-[''] ${focusCls} ${
              uploading ? 'cursor-not-allowed opacity-50' : 'hover:text-ink'
            }`}
          >
            &larr; All editions
          </Link>
        }
        title={issue.title}
        subtitle={`${STATUS_LABEL[issue.status] || issue.status} · ${issue.slug}`}
        action={
          <Link to="/magazine" target="_blank" rel="noopener noreferrer" className={`${outlineBtnCls} ${tapCls}`}>
            View on the site ↗
          </Link>
        }
      />
      <p role="status" className={held ? '-mt-4 mb-6 text-sm text-warn' : 'sr-only'}>
        {held && 'Pages are still uploading. Wait for the upload to finish, or stop it, before you leave this page.'}
      </p>
      <DetailsForm issue={issue} />
      {issue.status !== 'missing' && <ReadersPanel issue={issue} />}
      <PagesPanel issue={issue} onUploading={setUploading} />
      <Panel title="Delete edition" className="mt-8">
        <p className="mt-3 text-xs text-soft/55">
          Removes the edition and any pages uploaded from the portal. Prefer marking it as a draft. This cannot be undone.
        </p>
        <div className="mt-4">
          <ConfirmButton
            label="Delete this edition"
            confirmLabel="Click again to delete the edition and its pages"
            busyLabel="Deleting…"
            onConfirm={deleteIssue}
            busy={remove.isPending}
            disabled={uploading}
            className={`${outlineBtnCls} ${tapCls}`}
            keepWidth
          />
        </div>
        {remove.error && (
          <div className="mt-3">
            <ErrorText>{errorText(remove.error, 'We couldn’t delete the edition.')}</ErrorText>
          </div>
        )}
      </Panel>
    </>
  )
}

export default function IssueEditorPage() {
  const { slug } = useParams()
  const issues = useIssues()
  const list = issues.data || []
  // Saving a new ID changes the edition's address. The list is read again a
  // moment before the address follows, and for that moment no edition has the
  // ID in the address: the one that was open is kept by its id, so the editor
  // and an upload running in it stay on the screen.
  const shown = useRef(null) // { slug, id } of the edition on the screen
  const issue =
    list.find((m) => m.slug === slug) ||
    (shown.current?.slug === slug ? list.find((m) => m.id === shown.current.id) : undefined)
  useEffect(() => {
    if (issue) shown.current = { slug, id: issue.id }
  }, [issue, slug])
  usePageTitle(issue ? `Edit ${issue.title}` : 'Edit edition')

  // The editor stays up for as long as there is an edition to show: a later
  // reading that fails must not take the form, and what is typed in it, away.
  return (
    <MagazineGate>
      {issue ? (
        <IssueEditor key={issue.id} issue={issue} />
      ) : issues.isPending ? (
        <PageLoading />
      ) : !issues.data ? (
        <Panel>
          <ErrorText>{errorText(issues.error, 'We couldn’t load the edition.')}</ErrorText>
          <button
            type="button"
            className={`${outlineBtnCls} ${tapCls} mt-4`}
            onClick={() => issues.refetch()}
            disabled={issues.isFetching}
          >
            {issues.isFetching ? 'Trying…' : 'Try again'}
          </button>
        </Panel>
      ) : (
        <Panel>
          <p className="text-sm text-soft/70">No edition with the id {slug}.</p>
          <Link to="/portal/magazine" className="mt-4 inline-block text-sm font-semibold text-accent hover:text-ink">
            &larr; All editions
          </Link>
        </Panel>
      )}
    </MagazineGate>
  )
}
