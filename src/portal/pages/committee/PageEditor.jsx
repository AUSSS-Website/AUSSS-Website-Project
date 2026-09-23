import { useState } from 'react'
import CommitteePreview from '../../../components/CommitteePreview.jsx'
import { driveImg } from '../../../lib/img.js'
import {
  resizeImageToBlob,
  uploadCommitteePhoto,
  useSaveCommitteePage,
} from '../../officerQueries.js'
import { ErrorText, Field, inputCls, outlineBtnCls, primaryBtnCls } from '../../portalUi.jsx'

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

export default function PageEditor({ committee, staticCommittee }) {
  const save = useSaveCommitteePage(committee.slug)
  const [form, setForm] = useState(() => seed(committee.page, staticCommittee))
  const patch = (p) => setForm((prev) => ({ ...prev, ...p }))

  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  // Which photo button is mid-upload: 'officer' or 'member-<id>'. One at a
  // time is enough; the buttons are disabled while it runs.
  const [uploading, setUploading] = useState('')
  // { at: hint, message } so the error renders beside the button that failed.
  const [photoErr, setPhotoErr] = useState(null)
  const photoErrAt = (hint) => (photoErr && photoErr.at === hint ? photoErr.message : '')
  // Reset is destructive, so it takes two clicks: the first arms the button,
  // the second fires. No browser dialogs.
  const [confirmReset, setConfirmReset] = useState(false)

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
      const blob = await resizeImageToBlob(file, 512)
      const url = await uploadCommitteePhoto(committee.slug, blob, { hint })
      onDone(url)
    } catch (e) {
      setPhotoErr({
        at: hint,
        message: e?.message || 'That image couldn’t be read. Try a different file.',
      })
    } finally {
      setUploading('')
    }
  }

  const addMember = () => {
    if (members.length >= MAX_MEMBERS) return
    patch({ members: [...members, { id: uid(), name: '', title: '', photo: '' }] })
  }
  const removeMember = (id) =>
    setForm((prev) => ({ ...prev, members: prev.members.filter((m) => m.id !== id) }))
  const updateMember = (id, p) =>
    setForm((prev) => ({
      ...prev,
      members: prev.members.map((m) => (m.id === id ? { ...m, ...p } : m)),
    }))

  const busy = save.isPending

  const submit = async () => {
    setMsg('')
    setErr('')
    setConfirmReset(false)
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
      setForm(seed(doc, staticCommittee))
      setMsg('Saved. Your committee page is updated.')
    } catch (e) {
      setErr(e?.message || 'Could not save. Check your connection and try again.')
    }
  }

  const reset = async () => {
    if (!confirmReset) {
      setConfirmReset(true)
      return
    }
    setMsg('')
    setErr('')
    setConfirmReset(false)
    try {
      // {} clears the override; the public page falls back to society.js.
      await save.mutateAsync({})
      setForm(seed({}, staticCommittee))
      setMsg('Reset. Your committee page shows the defaults again.')
    } catch (e) {
      setErr(e?.message || 'Could not reset. Check your connection and try again.')
    }
  }

  return (
    // Bottom padding keeps the last field clear of the fixed save bar.
    <div className="pb-28">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="space-y-8">
          {/* Officer photo */}
          <Field label="Your photo">
            <div className="flex items-center gap-5">
              <div className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-full bg-forest-800 ring-2 ring-white/10">
                {photo ? (
                  <img
                    src={driveImg(photo)}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="text-xs text-silver/40">No photo</span>
                )}
              </div>
              <div className="space-y-2">
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
                    className="block text-xs font-semibold text-silver/55 hover:text-white"
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
          </Field>

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
          <Field
            label="What we do"
            hint="Optional, off by default. Turn it on to show this section on your page."
          >
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={whatWeDoEnabled}
                onChange={(e) => patch({ whatWeDoEnabled: e.target.checked })}
                className="h-4 w-4 accent-medical"
              />
              <span className="text-sm text-silver/80">
                Show the “What we do” section on my committee page
              </span>
            </label>

            {whatWeDoEnabled && (
              <textarea
                value={whatWeDoText}
                onChange={(e) => patch({ whatWeDoText: e.target.value })}
                rows={5}
                placeholder="One item per line."
                aria-label="What we do, one item per line"
                className={`${inputCls} mt-4 resize-y`}
              />
            )}
          </Field>

          {/* Members section */}
          <Field
            label="Members section"
            hint={`Optional. Show up to ${MAX_MEMBERS} members on your page.`}
          >
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={membersEnabled}
                onChange={(e) => patch({ membersEnabled: e.target.checked })}
                className="h-4 w-4 accent-medical"
              />
              <span className="text-sm text-silver/80">
                Show the members section on my committee page
              </span>
            </label>

            {membersEnabled && (
              <div className="mt-5 space-y-4">
                {members.length === 0 && (
                  <p className="text-sm text-silver/50">No members yet. Add your first below.</p>
                )}
                {members.map((m, i) => {
                  const hint = `member-${m.id}`
                  return (
                    <div
                      key={m.id}
                      className="flex flex-wrap items-center gap-4 rounded-2xl border border-white/10 bg-forest-800 p-4"
                    >
                      <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full bg-forest-950 ring-2 ring-white/10">
                        {m.photo ? (
                          <img
                            src={driveImg(m.photo)}
                            alt=""
                            referrerPolicy="no-referrer"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <span className="text-[10px] text-silver/40">No photo</span>
                        )}
                      </div>
                      <div className="flex min-w-[12rem] flex-1 flex-col gap-2">
                        <input
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
                      <div className="flex flex-col gap-2">
                        <FileButton
                          label={m.photo ? 'Replace' : 'Photo'}
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
                            className="text-xs font-semibold text-silver/55 hover:text-white"
                          >
                            Remove photo
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => removeMember(m.id)}
                          className="text-xs font-semibold text-red-400/80 hover:text-red-300"
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
                  className={`${outlineBtnCls} px-4 py-2`}
                >
                  {members.length >= MAX_MEMBERS
                    ? `Maximum ${MAX_MEMBERS} members`
                    : '+ Add member'}
                </button>
              </div>
            )}
          </Field>
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

      {/* Sticky save bar. The parent hides this editor on other tabs so only
          one bar is ever on screen. */}
      <div className="fixed inset-x-0 bottom-0 z-[90] border-t border-white/15 bg-forest-950/95 px-4 py-3 backdrop-blur-md">
        <div className="container-prose flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            {msg && <p className="text-sm text-silver/70">{msg}</p>}
            <ErrorText>{err}</ErrorText>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {confirmReset && (
              <button
                type="button"
                onClick={() => setConfirmReset(false)}
                className="text-xs font-semibold text-silver/55 hover:text-white"
              >
                Keep my page
              </button>
            )}
            <button
              type="button"
              onClick={reset}
              disabled={busy || Boolean(uploading)}
              className={`${outlineBtnCls} py-2 ${
                confirmReset ? 'border-red-400/60 text-red-300 hover:bg-red-400/10' : ''
              }`}
            >
              {confirmReset ? 'Click again to reset' : 'Reset to defaults'}
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={busy || Boolean(uploading)}
              className={primaryBtnCls}
            >
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function FileButton({ label, onFile, small, busy, disabled }) {
  const off = busy || disabled
  return (
    <label
      aria-busy={busy || undefined}
      className={`inline-flex items-center justify-center rounded-full border border-white/20 font-semibold text-white transition-colors ${
        small ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm'
      } ${off ? 'cursor-wait opacity-50' : 'cursor-pointer hover:bg-white/10'}`}
    >
      {busy ? 'Uploading…' : label}
      <input
        type="file"
        accept="image/*"
        className="hidden"
        disabled={off}
        onChange={(e) => {
          const f = e.target.files && e.target.files[0]
          e.target.value = '' // allow re-picking the same file
          onFile(f)
        }}
      />
    </label>
  )
}
