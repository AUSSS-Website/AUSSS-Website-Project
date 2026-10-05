import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import usePageTitle from '../../../hooks/usePageTitle.js'
import { contentSchema } from '../../../content/index.js'
import { defaultDoc, normalizeDoc, sameDoc, validateDoc } from '../../../content/schema.js'
import { useContentBlock, useWriteContentBlock } from '../../contentQueries.js'
import { useNames } from '../../workQueries.js'
import { personName, when } from '../../workUi.jsx'
import { ErrorText, PageHeader, Panel, Spinner, outlineBtnCls, primaryBtnCls } from '../../portalUi.jsx'
import RecordEditor from './RecordEditor.jsx'
import { BlockStatus } from './ContentPage.jsx'
import { previews } from './previews.jsx'

// /portal/content/:key. One part of the public site, edited through its field
// schema. Three copies are in play:
//   the document on screen   what you are typing; lost if you leave without saving
//   the draft                saved in the database, seen only by the block's editors
//   the published document   what visitors see
// "Save draft" keeps your work for later or for a colleague to look at;
// "Publish" puts what is on screen on the site.

function BackToList() {
  return (
    <Link to="/portal/content" className="text-sm font-semibold text-accent hover:text-ink">
      &larr; All site content
    </Link>
  )
}

// What the editor opens with: the draft if there is one, else what is
// published, else the copy that ships in the code.
function workingDoc(schema, block) {
  if (block?.draft) return normalizeDoc(schema, block.draft)
  if (block?.published) return normalizeDoc(schema, block.published)
  return defaultDoc(schema)
}

function Editor({ schema, block }) {
  const write = useWriteContentBlock()
  const [doc, setDoc] = useState(() => workingDoc(schema, block))
  // The version this screen was loaded from; a save over a newer one is refused.
  const [base, setBase] = useState(block.updated_at)
  const [showErrors, setShowErrors] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [msg, setMsg] = useState('')
  const names = useNames(useMemo(() => [block.draft_saved_by, block.published_by], [block.draft_saved_by, block.published_by]))

  const clean = useMemo(() => normalizeDoc(schema, doc), [schema, doc])
  const errors = useMemo(() => validateDoc(schema, clean), [schema, clean])
  const errorCount = Object.keys(errors).length
  const saved = useMemo(() => workingDoc(schema, block), [schema, block])
  const live = block.published ? normalizeDoc(schema, block.published) : defaultDoc(schema)
  const dirty = !sameDoc(schema, clean, saved)
  const differsFromLive = !block.published || !sameDoc(schema, clean, live)

  // Leaving with unsaved typing asks first.
  useEffect(() => {
    if (!dirty) return undefined
    const warn = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const run = async (action) => {
    setMsg('')
    setConfirmDiscard(false)
    if (action !== 'discard' && errorCount > 0) {
      setShowErrors(true)
      return
    }
    try {
      const row = await write.mutateAsync({ action, key: schema.key, doc: clean, base })
      setBase(row.updated_at)
      setDoc(workingDoc(schema, row))
      setShowErrors(false)
      setMsg(
        action === 'publish'
          ? 'Published. Visitors see it straight away; search engines and link previews follow within a few minutes.'
          : action === 'save'
            ? 'Draft saved. The site has not changed.'
            : 'Draft discarded.',
      )
    } catch {
      // write.error is shown below
    }
  }

  const Preview = previews[schema.key]
  const busy = write.isPending

  return (
    <div className="grid items-start gap-6 xl:grid-cols-2">
      <div className="min-w-0 space-y-5">
        <Panel>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <BlockStatus block={block} />
            {schema.path && (
              <a href={schema.path} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-accent hover:text-ink">
                Open {schema.path} on the site &rarr;
              </a>
            )}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-soft/60">
            {block.published_at
              ? `Published ${when(block.published_at)} by ${personName(names, block.published_by)}.`
              : 'Nothing has been published from the portal yet, so the site shows the copy it was built with.'}
            {block.draft_saved_at
              ? ` A draft was saved ${when(block.draft_saved_at)} by ${personName(names, block.draft_saved_by)}; the draft is what you see below.`
              : block.published_at
                ? ' That is what you see below.'
                : ' That copy is what you see below.'}
          </p>
        </Panel>

        <Panel>
          <RecordEditor schema={schema} doc={doc} onChange={setDoc} errors={showErrors ? errors : {}} disabled={busy} />
        </Panel>

        <Panel className="z-10 md:sticky md:bottom-4 md:shadow-lg md:shadow-black/10">
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={primaryBtnCls} disabled={busy || !differsFromLive} onClick={() => run('publish')}>
              {busy && write.variables?.action === 'publish' ? 'Publishing…' : 'Publish'}
            </button>
            <button type="button" className={`${outlineBtnCls} px-5 py-2.5 text-sm`} disabled={busy || !dirty} onClick={() => run('save')}>
              {busy && write.variables?.action === 'save' ? 'Saving…' : 'Save draft'}
            </button>
            {dirty && (
              <button type="button" className={`${outlineBtnCls} px-5 py-2.5 text-sm`} disabled={busy} onClick={() => { setDoc(saved); setShowErrors(false); setMsg('') }}>
                Undo my changes
              </button>
            )}
            {block.draft && !dirty && (
              confirmDiscard ? (
                <span className="flex flex-wrap items-center gap-2 text-sm text-soft/75">
                  Throw the draft away?
                  <button type="button" className={`${outlineBtnCls} border-danger/50 text-danger`} disabled={busy} onClick={() => run('discard')}>
                    Yes, discard it
                  </button>
                  <button type="button" className={outlineBtnCls} disabled={busy} onClick={() => setConfirmDiscard(false)}>
                    Keep it
                  </button>
                </span>
              ) : (
                <button type="button" className={`${outlineBtnCls} px-5 py-2.5 text-sm`} disabled={busy} onClick={() => setConfirmDiscard(true)}>
                  Discard draft
                </button>
              )
            )}
          </div>
          <div className="mt-3 space-y-1 empty:hidden">
            {showErrors && errorCount > 0 && (
              <ErrorText>
                {errorCount === 1 ? 'One thing needs fixing above before this can be saved.' : `${errorCount} things need fixing above before this can be saved.`}
              </ErrorText>
            )}
            {write.error && <ErrorText>{write.error.message}</ErrorText>}
            {msg && <p role="status" className="text-xs font-semibold text-accent">{msg}</p>}
            {!msg && !write.error && dirty && <p className="text-xs text-soft/55">You have changes that are not saved.</p>}
          </div>
        </Panel>
      </div>

      {Preview && (
        <section aria-label="Preview" className="min-w-0 xl:sticky xl:top-6">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-accent">
            Preview: how it will look on the site
          </p>
          {/* no-reveal: the public pages fade their sections in on scroll; here they just show. */}
          <div className="no-reveal rounded-2xl border border-line/10 bg-page p-5 sm:p-8">
            <Preview doc={clean} />
          </div>
        </section>
      )}
    </div>
  )
}

export default function ContentEditorPage() {
  const { key } = useParams()
  const schema = contentSchema(key)
  usePageTitle(schema ? schema.title : 'Site content')
  const block = useContentBlock(schema ? key : null)

  if (!schema) {
    return (
      <Panel>
        <p className="text-sm text-soft/70">That part of the site cannot be edited here.</p>
        <div className="mt-4">
          <BackToList />
        </div>
      </Panel>
    )
  }

  return (
    <>
      <PageHeader eyebrow="Site content" title={schema.title} subtitle={schema.description} action={<BackToList />} />
      {block.isPending ? (
        <div className="py-16 text-center">
          <Spinner />
        </div>
      ) : block.error ? (
        <Panel>
          <ErrorText>Couldn’t load this part of the site: {block.error.message}</ErrorText>
        </Panel>
      ) : !block.data ? (
        <Panel>
          <p className="text-sm text-soft/70">
            You cannot edit this part of the site. It belongs to the Executive Board or to another
            committee’s officers.
          </p>
        </Panel>
      ) : (
        // Remounted when another block is opened, so its state never carries over.
        <Editor key={schema.key} schema={schema} block={block.data} />
      )}
    </>
  )
}
