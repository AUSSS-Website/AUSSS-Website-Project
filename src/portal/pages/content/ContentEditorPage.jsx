import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import usePageTitle from '../../../hooks/usePageTitle.js'
import useMediaQuery from '../../../hooks/useMediaQuery.js'
import useLeaveWarning from '../../../hooks/useLeaveWarning.js'
import { contentSchema } from '../../../content/index.js'
import { defaultDoc, fillDoc, normalizeDoc, sameDoc, validateDoc } from '../../../content/schema.js'
import { useTermVars } from '../../../hooks/useCurrentTerm.js'
import { errorText } from '../../../lib/errorText.js'
import { pressCls } from '../../../lib/motion.js'
import { useContentBlock, useWriteContentBlock } from '../../contentQueries.js'
import { useNames } from '../../workQueries.js'
import { personName, when } from '../../workUi.jsx'
import {
  ConfirmButton,
  ErrorText,
  PageHeader,
  PageLoading,
  Panel,
  SaveStatus,
  outlineBtnCls,
  panelTitleCls,
  primaryBtnCls,
} from '../../portalUi.jsx'
import RecordEditor, { focusField, keepRowIds } from './RecordEditor.jsx'
import { BlockStatus } from './ContentPage.jsx'
import { previews } from './previews.jsx'
import usePreviewFollow from './usePreviewFollow.js'

// /portal/content/:key. One part of the public site, edited through its field
// schema. Three copies are in play:
//   the document on screen   what you are typing; lost if you leave without saving
//   the draft                saved in the database, seen only by the block's editors
//   the published document   what visitors see
// "Save draft" keeps your work for later or for a colleague to look at;
// "Publish" puts what is on screen on the site.
//
// On a wide screen the preview sits beside the form, scrolls on its own and
// follows the part of the form being worked on (usePreviewFollow.js) until it
// is scrolled by hand.

// A small control keeps its size and takes a finger all the same: its ::after
// reaches above and below it to 44px, in px because the root size shrinks on a
// small phone (the same as the form's own small buttons, RecordEditor.jsx).
const tallHitCls = "relative after:absolute after:inset-x-0 after:top-1/2 after:h-[44px] after:-translate-y-1/2 after:content-['']"
const backCls = `${tallHitCls} text-sm font-semibold text-accent transition-colors hover:text-ink`
// The two small answers to "Throw the draft away?". They stand side by side,
// so their areas do not meet.
const answerBtnCls = `${outlineBtnCls} ${tallHitCls}`

// The way back to the list. With typing in the form that is not saved it asks
// first: the browser's own question (useLeaveWarning) is put for a closed tab
// or a reload, and never for a link inside the site.
function BackToList({ ask = false }) {
  const navigate = useNavigate()
  if (ask) {
    return (
      <ConfirmButton
        variant="text"
        label="All site content"
        confirmLabel="Click again to leave without saving"
        className={backCls}
        onConfirm={() => navigate('/portal/content')}
      >
        &larr; All site content
      </ConfirmButton>
    )
  }
  return (
    <Link to="/portal/content" className={backCls}>
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

// What to say when a write got an answer that was not written for people.
const NOT_DONE = {
  publish: 'This was not published. Try again in a moment.',
  save: 'The draft was not saved. Try again in a moment.',
  discard: 'The draft was not discarded. Try again in a moment.',
}

function Editor({ schema, block, onUnsaved }) {
  const write = useWriteContentBlock()
  const [doc, setDoc] = useState(() => workingDoc(schema, block))
  // The version this screen was loaded from; a save over a newer one is refused.
  const [base, setBase] = useState(block.updated_at)
  const [showErrors, setShowErrors] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [msg, setMsg] = useState('')
  // Counts the times the document on screen was put aside for another one
  // (Undo my changes, a discarded draft). The form starts afresh each time,
  // so nothing in it still offers to undo a step of the document that is gone.
  const [round, setRound] = useState(0)
  const names = useNames(useMemo(() => [block.draft_saved_by, block.published_by], [block.draft_saved_by, block.published_by]))

  const clean = useMemo(() => normalizeDoc(schema, doc), [schema, doc])
  // The preview shows {years} and {anniversary} the way the site does; the form keeps them as typed.
  const vars = useTermVars()
  const shown = useMemo(() => fillDoc(schema, clean, vars), [schema, clean, vars])
  const errors = useMemo(() => validateDoc(schema, clean), [schema, clean])
  const errorCount = Object.keys(errors).length
  const saved = useMemo(() => workingDoc(schema, block), [schema, block])
  const live = block.published ? normalizeDoc(schema, block.published) : defaultDoc(schema)
  const dirty = !sameDoc(schema, clean, saved)
  const differsFromLive = !block.published || !sameDoc(schema, clean, live)

  // Leaving with unsaved typing asks first: the browser for a closed tab or a
  // reload, the link back to the list for itself (BackToList).
  useLeaveWarning(dirty)
  useEffect(() => {
    onUnsaved(dirty)
    return () => onUnsaved(false)
  }, [dirty, onUnsaved])

  const run = async (action) => {
    setMsg('')
    setConfirmDiscard(false)
    if (action !== 'discard' && errorCount > 0) {
      setShowErrors(true)
      return
    }
    const sent = clean
    try {
      const row = await write.mutateAsync({ action, key: schema.key, doc: sent, base })
      const kept = workingDoc(schema, row)
      setBase(row.updated_at)
      if (action === 'discard') {
        setDoc(kept)
        setRound((n) => n + 1)
      } else {
        // The screen takes the saved copy of what it showed. If it shows more
        // by now (a picture that finished uploading while the save was on its
        // way), it keeps that, and the page says there is something unsaved.
        setDoc((now) => {
          if (!sameDoc(schema, now, sent)) return now
          keepRowIds(schema.fields, now, kept)
          return kept
        })
      }
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

  // The button that did it leaves the page with the last unsaved change, so
  // the status line is what says it was done.
  const undoAll = () => {
    setDoc(saved)
    setRound((n) => n + 1)
    setShowErrors(false)
    setMsg('Your changes were undone.')
  }

  const Preview = previews[schema.key]
  const busy = write.isPending
  const formRef = useRef(null)
  const boxRef = useRef(null)
  const sideBySide = useMediaQuery('(min-width: 1280px)')
  const { following, follow } = usePreviewFollow({ formRef, boxRef, enabled: Boolean(Preview) && sideBySide, version: clean })

  // validateDoc lists the problems in the order of the form, so the first is the one highest up.
  const showFirstProblem = () => focusField(formRef.current, Object.keys(errors)[0])
  const problems = showErrors && errorCount > 0

  return (
    <div className="grid items-start gap-6 xl:grid-cols-2">
      <div className="min-w-0 space-y-5">
        <Panel>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <BlockStatus block={block} />
            {schema.path && (
              <a href={schema.path} target="_blank" rel="noopener noreferrer" className={`${tallHitCls} text-xs font-semibold text-accent transition-colors hover:text-ink`}>
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
          <div ref={formRef}>
            <RecordEditor key={round} schema={schema} doc={doc} onChange={setDoc} errors={showErrors ? errors : {}} disabled={busy} />
          </div>
        </Panel>

        <Panel className="z-10 md:sticky md:bottom-4 md:shadow-lg md:shadow-black/10">
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={primaryBtnCls} disabled={busy || !differsFromLive} onClick={() => run('publish')}>
              {busy && write.variables?.action === 'publish' ? 'Publishing…' : 'Publish'}
            </button>
            <button type="button" className={`${outlineBtnCls} px-5 py-2.5 text-sm`} disabled={busy || !dirty} onClick={() => run('save')}>
              {busy && write.variables?.action === 'save' ? 'Saving…' : 'Save draft'}
            </button>
            {/* It throws away every change since the last save, so it asks for a second click. */}
            {dirty && (
              <ConfirmButton label="Undo my changes" className={`${outlineBtnCls} px-5 py-2.5 text-sm`} keepWidth disabled={busy} onConfirm={undoAll} />
            )}
            {block.draft && !dirty && (
              confirmDiscard ? (
                // Named as a group, so a screen reader says the question when the cursor lands on an answer.
                <span role="group" aria-label="Throw the draft away?" className="flex flex-wrap items-center gap-2 text-sm text-soft/75">
                  Throw the draft away?
                  {/* The ! is needed: the pill's own border and text colours come later in the stylesheet and would win. */}
                  <button type="button" className={`${answerBtnCls} !border-danger/50 !text-danger`} disabled={busy} onClick={() => run('discard')}>
                    Yes, discard it
                  </button>
                  <button type="button" className={answerBtnCls} disabled={busy} onClick={() => setConfirmDiscard(false)}>
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
          {(problems || write.error) && (
            <div className="mt-2 space-y-1">
              {problems && (
                <p role="alert">
                  {/* The sentence is the way there: it brings the first field with a problem into view, with the cursor in it. */}
                  <button
                    type="button"
                    onClick={showFirstProblem}
                    className={`inline-flex min-h-[44px] items-center rounded text-left text-sm font-semibold text-danger underline decoration-danger/40 underline-offset-4 ${pressCls} hover:decoration-danger`}
                  >
                    {errorCount === 1 ? 'One thing needs fixing above before this can be saved.' : `${errorCount} things need fixing above before this can be saved.`}
                  </button>
                </p>
              )}
              {write.error && <ErrorText>{errorText(write.error, NOT_DONE[write.variables?.action])}</ErrorText>}
            </div>
          )}
          {/* What the last save or undo said shows only while nothing has changed since; after that it is "Unsaved changes". */}
          <SaveStatus dirty={dirty} saved={msg} className="mt-3" />
        </Panel>
      </div>

      {Preview && (
        <section aria-label="Preview" className="min-w-0 xl:sticky xl:top-6">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p className={panelTitleCls}>Preview: how it will look on the site</p>
            {sideBySide &&
              (following ? (
                <p className="text-xs text-soft/55">Follows the form. Scroll it yourself to stop that.</p>
              ) : (
                <button
                  type="button"
                  onClick={follow}
                  className={`relative text-xs font-semibold text-accent ${pressCls} hover:text-ink after:absolute after:-inset-x-2 after:top-1/2 after:h-[44px] after:-translate-y-1/2 after:content-['']`}
                >
                  Follow the form again
                </button>
              ))}
          </div>
          {/* no-reveal: the public pages fade their sections in on scroll; here they just show.
              Beside the form it is a box of its own, as tall as the window, that scrolls. */}
          <div
            ref={boxRef}
            tabIndex={sideBySide ? 0 : undefined}
            aria-label={sideBySide ? 'Preview, scrolls on its own' : undefined}
            className="no-reveal rounded-2xl border border-line/10 bg-page xl:max-h-[calc(100vh-5.5rem)] xl:overflow-y-auto xl:overscroll-contain"
          >
            <div className="p-5 sm:p-8">
              <Preview doc={shown} />
            </div>
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
  // Whether the editor holds typing that is not saved, for the way back to ask first.
  const [unsaved, setUnsaved] = useState(false)

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
      <PageHeader eyebrow="Site content" title={schema.title} subtitle={schema.description} action={<BackToList ask={unsaved} />} />
      {block.isPending ? (
        <PageLoading />
      ) : block.data ? (
        // Once the block has been read the editor stays, whatever a later read
        // says. The block is read again by itself when the connection comes
        // back, and a read that fails then must not take the form off the
        // screen with what was typed in it. A save that cannot reach the
        // server says so itself.
        //
        // Remounted when another block is opened, so its state never carries over.
        <Editor key={schema.key} schema={schema} block={block.data} onUnsaved={setUnsaved} />
      ) : block.error ? (
        <Panel>
          <ErrorText>{errorText(block.error, 'We couldn’t load this part of the site.')}</ErrorText>
        </Panel>
      ) : (
        <Panel>
          <p className="text-sm text-soft/70">
            You cannot edit this part of the site. It belongs to the Executive Board or to another
            committee’s officers.
          </p>
        </Panel>
      )}
    </>
  )
}
