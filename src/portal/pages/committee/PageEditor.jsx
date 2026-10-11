import { useEffect, useId, useRef, useState } from 'react'
import CommitteePreview from '../../../components/CommitteePreview.jsx'
import useLeaveWarning from '../../../hooks/useLeaveWarning.js'
import { errorText } from '../../../lib/errorText.js'
import { driveImg } from '../../../lib/img.js'
import { pressCls } from '../../../lib/motion.js'
import {
  resizeImageToBlob,
  uploadCommitteePhoto,
  useSaveCommitteePage,
} from '../../officerQueries.js'
import {
  CheckField,
  ConfirmButton,
  ErrorText,
  Field,
  SaveStatus,
  UndoLine,
  inputCls,
  outlineBtnCls,
  primaryBtnCls,
} from '../../portalUi.jsx'

// The "Committee page" editor. The parent renders the page header and tabs;
// this component owns only the form, the live preview and the sticky save bar.
//
//   <PageEditor committee={row} staticCommittee={societyCommittee} />
//
// `committee` is the committees row (useCommittee): its `page` is {} for no
// override, else the document the database normalised on the last save.
// `staticCommittee` is the matching src/data/society.js entry and supplies the
// defaults the form starts from.

const MAX_MEMBERS = 10

// The id of a member row's name field, for putting the focus there.
const memberNameId = (id) => `cp-member-${id}-name`

function uid() {
  try {
    return crypto.randomUUID()
  } catch {
    return 'm' + Date.now() + Math.round(Math.random() * 1e6)
  }
}

// Form state from an override document plus the society.js defaults. Used
// for the initial state and again after every save/reset, because the server
// normalises what it stores (trims, caps, drops unknown keys) and the form
// should show what actually persisted rather than what was typed.
function seed(override, staticCommittee) {
  const o = override && typeof override === 'object' ? override : {}
  const s = staticCommittee || {}
  const committeeAbout = Array.isArray(s.about)
    ? s.about
    : s.about
      ? [s.about]
      : s.description
        ? [s.description]
        : []
  const leadPhoto = (Array.isArray(s.officers) && s.officers[0]?.photo) || s.photo || ''
  return {
    tagline: o.tagline || s.tagline || '',
    aboutText: (o.about?.length ? o.about : committeeAbout).join('\n\n'),
    // Presets stay pre-loaded so officers can tweak them; the section itself
    // is opt-in and off by default.
    whatWeDoText: (o.whatWeDo?.length ? o.whatWeDo : s.whatWeDo || []).join('\n'),
    whatWeDoEnabled: Boolean(o.whatWeDoEnabled),
    photo: o.photo || leadPhoto || '',
    membersEnabled: Boolean(o.membersEnabled),
    members: Array.isArray(o.members)
      ? o.members.map((m) => ({
          id: m.id || uid(),
          name: m.name || '',
          title: m.title || '',
          photo: m.photo || '',
        }))
      : [],
  }
}

const splitParagraphs = (text) =>
  text
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean)
const splitLines = (text) =>
  text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)

// A heading over a part of the form that is more than one field (the photo
// and its buttons, a tick box with the list it switches on). It looks like
// Field's label, since it stands among fields, but it is not a <label>: there
// is no single control for it to be tied to, so it names the group instead.
function Group({ label, hint, children }) {
  const id = useId()
  return (
    <div role="group" aria-labelledby={id}>
      <p id={id} className="block text-sm font-medium text-ink">
        {label}
      </p>
      {hint ? <p className="mb-3 mt-1 text-xs text-soft/50">{hint}</p> : <div className="mt-3" />}
      {children}
    </div>
  )
}

// A small text button under or beside a photo button. For a pointer it is one
// line of text; on a touch screen it is 44px high, in px because the root size
// shrinks on a 320px phone.
const textActionCls =
  'inline-flex items-center justify-center text-xs font-semibold transition-colors [@media(pointer:coarse)]:min-h-[44px]'

// A pill that stands clear of its neighbours stays the height it looks, and
// an unseen ::after gives a finger 44px to land on, above and below it only.
const pillTapCls =
  "relative after:absolute after:inset-x-0 after:top-1/2 after:h-[44px] after:-translate-y-1/2 after:content-['']"

// A member row's three controls stand in a column beside the fields. That is
// too close for a finger, so on a touch screen they lie in a row under the
// fields instead, each with its 44px.
const memberActionsCls =
  'flex flex-col gap-2 [@media(pointer:coarse)]:w-full [@media(pointer:coarse)]:flex-row [@media(pointer:coarse)]:flex-wrap [@media(pointer:coarse)]:items-center [@media(pointer:coarse)]:gap-x-5 [@media(pointer:coarse)]:gap-y-0'

export default function PageEditor({ committee, staticCommittee }) {
  const save = useSaveCommitteePage(committee.slug)
  const [form, setForm] = useState(() => seed(committee.page, staticCommittee))
  const patch = (p) => setForm((prev) => ({ ...prev, ...p }))
  // The form as the database last gave it: at the start, and after each save
  // or reset. Whatever differs from it has not been saved.
  const [savedForm, setSavedForm] = useState(form)
  const dirty = JSON.stringify(form) !== JSON.stringify(savedForm)

  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  // Which of the two writes is running, for the wording on its button.
  const [action, setAction] = useState('') // 'save' | 'reset'
  // Which photo button is mid-upload: 'officer' or 'member-<id>'. One at a
  // time is enough; the buttons are disabled while it runs.
  const [uploading, setUploading] = useState('')
  // { at: hint, message } so the error renders beside the button that failed.
  const [photoErr, setPhotoErr] = useState(null)
  const photoErrAt = (hint) => (photoErr && photoErr.at === hint ? photoErr.message : '')
  // The last member taken off the list, for one Undo: { member, index }.
  const [removed, setRemoved] = useState(null)

  // Closing the tab would lose what is typed, and cut an upload off.
  useLeaveWarning(dirty || Boolean(uploading))

  const { tagline, aboutText, whatWeDoText, whatWeDoEnabled, photo, membersEnabled, members } =
    form

  // Live-preview projections of the text fields (mirror what save() sends and
  // what CommitteePage renders), recomputed each keystroke.
  const aboutParas = splitParagraphs(aboutText)
  const whatWeDoList = splitLines(whatWeDoText)

  // The database refuses data: URIs, so a picked file goes to Storage first
  // and only its public URL enters the form.
  const pickPhoto = async (file, hint, onDone) => {
    if (!file) return
    setPhotoErr(null)
    setUploading(hint)
    try {
      // The browser's own error for a file it cannot draw says nothing a
      // person can use, so reading and sending each have their own sentence.
      let blob
      try {
        blob = await resizeImageToBlob(file, 512)
      } catch {
        throw Object.assign(new Error('That image couldn’t be read. Try a different file.'), {
          rejected: true,
        })
      }
      const url = await uploadCommitteePhoto(committee.slug, blob, { hint })
      onDone(url)
    } catch (e) {
      setPhotoErr({ at: hint, message: errorText(e, 'That photo couldn’t be uploaded. Try again.') })
    } finally {
      setUploading('')
    }
  }

  const addMember = () => {
    if (members.length >= MAX_MEMBERS) return
    patch({ members: [...members, { id: uid(), name: '', title: '', photo: '' }] })
    // The list may be full again, with no room for the member Undo would put back.
    setRemoved(null)
  }
  const removeMember = (id) => {
    const index = members.findIndex((m) => m.id === id)
    if (index < 0) return
    const member = members[index]
    // A row nobody has filled in goes without a way back of its own, and it
    // leaves the way back to the member removed before it standing (one place
    // up, if the empty row stood above that one).
    if (member.name.trim() || member.title.trim() || member.photo) setRemoved({ member, index })
    else if (removed && index < removed.index) setRemoved({ ...removed, index: removed.index - 1 })
    patch({ members: members.filter((m) => m.id !== id) })
  }
  // The Undo button goes with its line once it is pressed, and the keyboard's
  // place would go back to the top of the page with it. So the member who has
  // just been put back takes the focus, in the name field, once the row is on
  // the page. `focusNext` holds that field's id until then.
  const focusNext = useRef('')
  useEffect(() => {
    if (!focusNext.current) return
    document.getElementById(focusNext.current)?.focus()
    focusNext.current = ''
  }, [members])
  const undoRemove = () => {
    if (!removed) return
    setForm((prev) => {
      const next = [...prev.members]
      next.splice(Math.min(removed.index, next.length), 0, removed.member)
      return { ...prev, members: next }
    })
    setRemoved(null)
    focusNext.current = memberNameId(removed.member.id)
  }
  const updateMember = (id, p) =>
    setForm((prev) => ({
      ...prev,
      members: prev.members.map((m) => (m.id === id ? { ...m, ...p } : m)),
    }))

  const busy = save.isPending

  // After a write the form shows what the database stored, and that is the
  // new measure of "saved".
  const settle = (doc) => {
    const next = seed(doc, staticCommittee)
    setForm(next)
    setSavedForm(next)
    setRemoved(null)
  }

  const submit = async () => {
    setMsg('')
    setErr('')
    setAction('save')
    const fields = {
      tagline: tagline.trim(),
      about: splitParagraphs(aboutText),
      whatWeDo: splitLines(whatWeDoText),
      whatWeDoEnabled,
      photo,
      membersEnabled,
      members: members
        .map((m) => ({
          id: m.id,
          name: m.name.trim(),
          title: m.title.trim(),
          photo: m.photo,
        }))
        .filter((m) => m.name || m.photo),
    }
    try {
      const doc = await save.mutateAsync(fields)
      settle(doc)
      setMsg('Saved. Your committee page is updated.')
    } catch (e) {
      setErr(errorText(e, 'Could not save. Try again.'))
    }
  }

  // Reset is destructive, so it takes two clicks (ConfirmButton below).
  const reset = async () => {
    setMsg('')
    setErr('')
    setAction('reset')
    try {
      // {} clears the override; the public page falls back to society.js.
      await save.mutateAsync({})
      settle({})
      setMsg('Reset. Your committee page shows the defaults again.')
    } catch (e) {
      setErr(errorText(e, 'Could not reset. Try again.'))
    }
  }

  return (
    // Bottom padding keeps the last field clear of the fixed save bar.
    <div className="pb-28">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="space-y-8">
          {/* Officer photo */}
          <Group label="Your photo">
            <div className="flex items-center gap-5">
              <div className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-full bg-card ring-2 ring-line/10">
                {photo ? (
                  <img
                    src={driveImg(photo)}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="text-xs text-soft/40">No photo</span>
                )}
              </div>
              <div className="flex flex-col items-start gap-2 [@media(pointer:coarse)]:gap-0">
                <FileButton
                  label={photo ? 'Replace photo' : 'Upload photo'}
                  busy={uploading === 'officer'}
                  disabled={Boolean(uploading)}
                  onFile={(f) => pickPhoto(f, 'officer', (url) => patch({ photo: url }))}
                />
                {photo && (
                  <button
                    type="button"
                    onClick={() => patch({ photo: '' })}
                    className={`${textActionCls} text-soft/55 hover:text-ink`}
                  >
                    Remove photo
                  </button>
                )}
              </div>
            </div>
            {photoErrAt('officer') && (
              <div className="mt-3">
                <ErrorText>{photoErrAt('officer')}</ErrorText>
              </div>
            )}
          </Group>

          {/* Tagline */}
          <Field
            label="Tagline"
            htmlFor="cp-tagline"
            hint="One short line shown under the committee name."
          >
            <input
              id="cp-tagline"
              value={tagline}
              onChange={(e) => patch({ tagline: e.target.value })}
              placeholder="e.g. Four-week clinical clerkships abroad."
              className={inputCls}
            />
          </Field>

          {/* Bio */}
          <Field
            label="About"
            htmlFor="cp-about"
            hint="Who you are, in a paragraph or two. Separate paragraphs with a blank line."
          >
            <textarea
              id="cp-about"
              value={aboutText}
              onChange={(e) => patch({ aboutText: e.target.value })}
              rows={6}
              className={`${inputCls} resize-y`}
            />
          </Field>

          {/* What we do, opt-in, off by default. The preset list stays
              pre-filled so officers can edit it before turning the section on. */}
          <Group
            label="What we do"
            hint="Optional, off by default. Turn it on to show this section on your page."
          >
            {/* The tick box brings its own 44px row, so the hint's gap above
                it is taken back. */}
            <CheckField
              checked={whatWeDoEnabled}
              onChange={(on) => patch({ whatWeDoEnabled: on })}
              label="Show the “What we do” section on my committee page"
              className="-mt-3"
            />

            {whatWeDoEnabled && (
              <textarea
                value={whatWeDoText}
                onChange={(e) => patch({ whatWeDoText: e.target.value })}
                rows={5}
                placeholder="One item per line."
                aria-label="What we do, one item per line"
                className={`${inputCls} mt-1 resize-y`}
              />
            )}
          </Group>

          {/* Members section */}
          <Group
            label="Members section"
            hint={`Optional. Show up to ${MAX_MEMBERS} members on your page.`}
          >
            <CheckField
              checked={membersEnabled}
              onChange={(on) => patch({ membersEnabled: on })}
              label="Show the members section on my committee page"
              className="-mt-3"
            />

            {membersEnabled && (
              <div className="mt-2 space-y-4">
                {members.length === 0 && (
                  <p className="text-sm text-soft/50">No members yet. Add your first below.</p>
                )}
                {members.map((m, i) => {
                  const hint = `member-${m.id}`
                  return (
                    <div
                      key={m.id}
                      className="flex flex-wrap items-center gap-4 rounded-2xl border border-line/10 bg-card p-4"
                    >
                      <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full bg-page ring-2 ring-line/10">
                        {m.photo ? (
                          <img
                            src={driveImg(m.photo)}
                            alt=""
                            referrerPolicy="no-referrer"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <span className="text-3xs text-soft/40">No photo</span>
                        )}
                      </div>
                      <div className="flex min-w-[12rem] flex-1 flex-col gap-2">
                        <input
                          id={memberNameId(m.id)}
                          value={m.name}
                          onChange={(e) => updateMember(m.id, { name: e.target.value })}
                          placeholder={`Member ${i + 1} name`}
                          aria-label={`Member ${i + 1} name`}
                          className={inputCls}
                        />
                        <input
                          value={m.title}
                          onChange={(e) => updateMember(m.id, { title: e.target.value })}
                          placeholder="Title / role"
                          aria-label={`Member ${i + 1} title or role`}
                          className={inputCls}
                        />
                      </div>
                      <div className={memberActionsCls}>
                        <FileButton
                          label={m.photo ? 'Replace' : 'Photo'}
                          ariaLabel={`${m.photo ? 'Replace the photo' : 'Add a photo'} of member ${i + 1}`}
                          small
                          busy={uploading === hint}
                          disabled={Boolean(uploading)}
                          onFile={(f) =>
                            pickPhoto(f, hint, (url) => updateMember(m.id, { photo: url }))
                          }
                        />
                        {m.photo && (
                          <button
                            type="button"
                            onClick={() => updateMember(m.id, { photo: '' })}
                            aria-label={`Remove photo of member ${i + 1}`}
                            className={`${textActionCls} text-soft/55 hover:text-ink`}
                          >
                            Remove photo
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => removeMember(m.id)}
                          aria-label={`Remove member ${i + 1}`}
                          className={`${textActionCls} text-danger/80 hover:text-danger`}
                        >
                          Remove
                        </button>
                      </div>
                      {photoErrAt(hint) && (
                        <div className="w-full">
                          <ErrorText>{photoErrAt(hint)}</ErrorText>
                        </div>
                      )}
                    </div>
                  )
                })}
                <button
                  type="button"
                  onClick={addMember}
                  disabled={members.length >= MAX_MEMBERS}
                  className={`${outlineBtnCls} px-4 py-2 ${pillTapCls}`}
                >
                  {members.length >= MAX_MEMBERS
                    ? `Maximum ${MAX_MEMBERS} members`
                    : '+ Add member'}
                </button>
              </div>
            )}
            {/* Far enough under the add button that the two do not share any
                of their unseen 44px. */}
            <UndoLine onUndo={undoRemove} className="mt-5 py-1">
              {removed && membersEnabled ? 'Member removed.' : null}
            </UndoLine>
          </Group>
        </div>

        <aside className="lg:sticky lg:top-24">
          <CommitteePreview
            committee={staticCommittee}
            tagline={tagline}
            about={aboutParas}
            whatWeDo={whatWeDoList}
            whatWeDoEnabled={whatWeDoEnabled}
            photo={photo}
            members={members}
            membersEnabled={membersEnabled}
          />
        </aside>
      </div>

      {/* Fixed save bar. The parent hides this editor on other tabs so only
          one bar is ever on screen. With unsaved edits in the form it says
          so; what the last save said shows only while nothing has changed
          since. The bar has no side padding of its own: container-prose
          alone puts what is in it on the page's own column. */}
      <div className="fixed inset-x-0 bottom-0 z-[90] border-t border-line/15 bg-page/95 py-3 backdrop-blur-md reduce-transparency:bg-page reduce-transparency:backdrop-filter-none">
        <div className="container-prose flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <SaveStatus dirty={dirty} saved={msg} className="text-sm" />
            <ErrorText>{err}</ErrorText>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <ConfirmButton
              label="Reset to defaults"
              confirmLabel="Click again to reset"
              busyLabel="Resetting…"
              busy={busy && action === 'reset'}
              disabled={busy || Boolean(uploading)}
              onConfirm={reset}
              className={`${outlineBtnCls} py-2 ${pillTapCls}`}
              keepWidth
            />
            <button
              type="button"
              onClick={submit}
              disabled={busy || Boolean(uploading)}
              className={`${primaryBtnCls} ${pillTapCls}`}
            >
              {busy && action === 'save' ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// A photo button. The file input itself is out of sight and out of the tab
// order, and a real button opens it, so the keyboard reaches it and it shows
// its focus like any other button.
function FileButton({ label, ariaLabel, onFile, small, busy, disabled }) {
  const inputRef = useRef(null)
  const off = busy || disabled
  return (
    <>
      <button
        type="button"
        disabled={off}
        aria-busy={busy || undefined}
        aria-label={busy ? undefined : ariaLabel}
        onClick={() => inputRef.current?.click()}
        className={`inline-flex items-center justify-center rounded-full border border-line/20 font-semibold text-ink hover:bg-veil/10 disabled:opacity-50 [@media(pointer:coarse)]:min-h-[44px] ${pressCls} ${
          small ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm'
        } ${busy ? 'cursor-wait' : ''}`}
      >
        {busy ? 'Uploading…' : label}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        disabled={off}
        onChange={(e) => {
          const f = e.target.files && e.target.files[0]
          e.target.value = '' // allow re-picking the same file
          onFile(f)
        }}
      />
    </>
  )
}
