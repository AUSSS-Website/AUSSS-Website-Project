import { useEffect, useRef, useState } from 'react'
import usePageTitle from '../../hooks/usePageTitle.js'
import { useAuth } from '../../auth/AuthProvider.jsx'
import { useLoadedProfile, useProfilePhoto, useUpdateProfile } from '../queries.js'
import { resizeImageToBlob } from '../officerQueries.js'
import { Avatar } from '../Avatar.jsx'
import { FACULTY_YEARS } from '../constants.js'
import {
  CheckField,
  ConfirmButton,
  ErrorText,
  Field,
  PageHeader,
  Panel,
  SaveStatus,
  inputCls,
  outlineBtnCls,
  primaryBtnCls,
} from '../portalUi.jsx'
import { errorText } from '../../lib/errorText.js'

// /portal/profile. Only the columns the database lets a member write are
// editable here; membership status, tier and joined year are EB-only, and the
// email follows the sign-in account (synced by a trigger), so it is read-only.
//
// The name and the photo set here are the ones shown everywhere: bylines in
// the portal and, for whoever holds an officer or board position, the public
// pages (src/lib/people.js).

// The portal's pills are under 44px tall to the eye. This ::after gives a
// finger the difference without changing how they look.
const tapCls = "relative after:absolute after:inset-x-0 after:-inset-y-[10px] after:content-['']"

export default function ProfilePage() {
  usePageTitle('Your profile')
  const { user, profile, profileError } = useAuth()
  // The row the sign-in check read, held here to ask for it again.
  const row = useLoadedProfile(user.id)

  if (!profile) {
    return (
      <>
        <PageHeader eyebrow="Profile" title="Your profile" />
        <Panel>
          {profileError ? (
            // A profile that failed to load is not one that was never made.
            // Asking again puts the sign-in check's spinner up until it answers.
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
              <ErrorText>{errorText(profileError, 'We couldn’t load your profile. Try again in a moment.')}</ErrorText>
              <button type="button" onClick={() => row.refetch()} className={`${outlineBtnCls} ${tapCls}`}>
                Try again
              </button>
            </div>
          ) : (
            <p className="text-sm text-soft/70">
              Your profile hasn’t been created yet. Sign out and back in; if it
              still doesn’t appear, tell the webmaster.
            </p>
          )}
        </Panel>
      </>
    )
  }

  // Keyed on the id (not updated_at): after a save the form already holds
  // the saved values, and remounting would wipe the "Saved." notice.
  return <ProfileForm key={profile.id} user={user} profile={profile} />
}

// The photo is saved on its own, the moment it is chosen: it is a file, not a
// field of the form below.
function PhotoPanel({ user, profile }) {
  const photo = useProfilePhoto(user.id)
  const inputRef = useRef(null)
  const chooseRef = useRef(null)
  const [error, setError] = useState('')
  // What the last change did, said under the buttons until the next one starts.
  const [done, setDone] = useState('')
  // From the moment a file is chosen: the picture is made smaller before it is
  // sent, and on a slow phone that takes a moment of its own.
  const [saving, setSaving] = useState(false)
  const busy = saving || photo.clear.isPending

  // Remove takes itself away once it has worked, and the keyboard's place with
  // it. The focus goes to the button left beside it, once that button is live
  // again, and only if nothing else has taken the focus meanwhile.
  const refocus = useRef(false)
  const hasPhoto = Boolean(profile.photo_path)
  useEffect(() => {
    if (!refocus.current || hasPhoto || busy) return
    refocus.current = false
    if (document.activeElement === document.body) chooseRef.current?.focus()
  }, [hasPhoto, busy])

  const pick = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError('')
    setDone('')
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      setError('Choose a JPEG, PNG or WebP image.')
      return
    }
    setSaving(true)
    try {
      // A file the browser cannot open as a picture fails here, before
      // anything is sent.
      const blob = await resizeImageToBlob(file, 512, 0.85).catch(() => null)
      if (!blob) {
        setError('That image could not be read. Choose another one.')
        return
      }
      await photo.set.mutateAsync({ blob, previousPath: profile.photo_path })
      setDone('Photo saved.')
    } catch (err) {
      setError(errorText(err, 'Could not save the photo.'))
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    setError('')
    setDone('')
    refocus.current = true
    try {
      await photo.clear.mutateAsync({
        previousPath: profile.photo_path,
        fallbackUrl: user.user_metadata?.avatar_url || user.user_metadata?.picture || null,
      })
      setDone('Photo removed.')
    } catch (err) {
      refocus.current = false
      setError(errorText(err, 'Could not remove the photo.'))
    }
  }

  return (
    <Panel className="mb-6 max-w-2xl">
      <div className="flex flex-wrap items-center gap-5">
        <Avatar name={profile.full_name} src={profile.avatar_url} size="lg" />
        {/* Never narrower than 12rem: on a small phone the words and the
            buttons go under the photo, where they have the panel's width. */}
        <div className="min-w-[12rem] flex-1">
          <p className="text-sm font-medium text-ink">Your photo</p>
          <p className="mt-1 max-w-md text-xs text-soft/55">
            Shown beside your name in the portal and in the members directory. If you hold an
            officer or board position, it is also your photo on the public website.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-5">
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={pick}
              className="sr-only"
              tabIndex={-1}
              aria-label="Choose a photo"
            />
            <button
              ref={chooseRef}
              type="button"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              className={`${outlineBtnCls} ${tapCls}`}
            >
              {saving ? 'Saving…' : profile.photo_path ? 'Change photo' : 'Choose a photo'}
            </button>
            {/* Removing deletes the stored file, so it asks twice, like every
                other remove in the portal. */}
            {profile.photo_path && (
              <ConfirmButton
                label="Remove"
                busyLabel="Removing…"
                busy={photo.clear.isPending}
                disabled={busy}
                onConfirm={remove}
                className={`${outlineBtnCls} ${tapCls}`}
                keepWidth
              />
            )}
          </div>
          <div className="mt-2">
            <SaveStatus saved={done} />
            <ErrorText>{error}</ErrorText>
          </div>
        </div>
      </div>
    </Panel>
  )
}

// What the form holds for a profile row, and what Save sends for a form.
function formFrom(profile) {
  return {
    fullName: profile.full_name || '',
    phone: profile.phone || '',
    facultyYear: profile.faculty_year || '',
    digest: profile.email_digest !== false,
  }
}

function patchFrom(form) {
  return {
    full_name: form.fullName.trim() || null,
    phone: form.phone.trim() || null,
    faculty_year: form.facultyYear || null,
    email_digest: form.digest,
  }
}

function ProfileForm({ user, profile: given }) {
  const save = useUpdateProfile(user.id)
  // The form reads the row for itself, so the render that follows its own
  // save already holds the saved row. Handed down from the sign-in check, the
  // row arrives a moment later, and in a browser whose timers wait a
  // millisecond (Safari) the status line said "Unsaved changes" before "Saved.".
  const profile = useLoadedProfile(user.id).data ?? given
  const [form, setForm] = useState(() => formFrom(profile))
  // A year saved before the list changed on 2026-10-11 ("Year 6", "Intern")
  // shows as it is, not as "Not set", until the member chooses again.
  const [years] = useState(() =>
    profile.faculty_year && !FACULTY_YEARS.includes(profile.faculty_year)
      ? [profile.faculty_year, ...FACULTY_YEARS]
      : FACULTY_YEARS,
  )
  const [saved, setSaved] = useState(false)
  const change = (key, value) => {
    setSaved(false)
    setForm((f) => ({ ...f, [key]: value }))
  }

  // There is something to save when what Save would send differs from the
  // row. Follow the row when it changes elsewhere (another tab, the EB),
  // unless there are unsaved edits here.
  const base = JSON.stringify(patchFrom(formFrom(profile)))
  const current = JSON.stringify(patchFrom(form))
  const dirty = current !== base
  const lastBase = useRef(base)
  useEffect(() => {
    if (base !== lastBase.current && current === lastBase.current) setForm(formFrom(profile))
    lastBase.current = base
  }, [base, current, profile])

  const submit = async (e) => {
    e.preventDefault()
    setSaved(false)
    try {
      await save.mutateAsync(patchFrom(form))
      setSaved(true)
    } catch {
      // save.error is rendered below.
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Profile"
        title="Your profile"
        subtitle="What officers and the EB see about you. Your name, photo and positions also show in the members directory."
      />
      <PhotoPanel user={user} profile={profile} />
      <form onSubmit={submit} className="max-w-2xl">
        <Panel className="space-y-6">
          <Field label="Full name" htmlFor="pf-name">
            <input
              id="pf-name"
              value={form.fullName}
              onChange={(e) => change('fullName', e.target.value)}
              autoComplete="name"
              className={inputCls}
            />
          </Field>

          <Field
            label="Email"
            htmlFor="pf-email"
            hint="Comes from your sign-in account and can’t be changed here."
          >
            <input
              id="pf-email"
              value={profile.email || user.email || ''}
              readOnly
              disabled
              className={`${inputCls} cursor-not-allowed opacity-60`}
            />
          </Field>

          <Field label="Phone" htmlFor="pf-phone" hint="Optional. Your officers use it to reach you.">
            <input
              id="pf-phone"
              type="tel"
              value={form.phone}
              onChange={(e) => change('phone', e.target.value)}
              autoComplete="tel"
              placeholder="+20 1x xxxx xxxx"
              className={inputCls}
            />
          </Field>

          <Field label="Faculty year" htmlFor="pf-year">
            <select
              id="pf-year"
              value={form.facultyYear}
              onChange={(e) => change('facultyYear', e.target.value)}
              className={inputCls}
            >
              <option value="">Not set</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </Field>

          {/* A tick box, not a switch: it counts once the form is saved, like
              the fields above it. The row pads itself by 12px above and
              below, which the pt-3 and the -mb-3 here allow for. */}
          <div className="-mb-3 border-t border-line/10 pt-3">
            <CheckField
              checked={form.digest}
              onChange={(on) => change('digest', on)}
              label="Email me a daily digest"
              hint="At most one email a day, only when a task or an update is waiting for you. Everything stays in the portal either way."
            />
          </div>
        </Panel>

        <div className="mt-6 flex flex-wrap items-center gap-4">
          <button type="submit" disabled={save.isPending} className={`${primaryBtnCls} ${tapCls}`}>
            {save.isPending ? 'Saving…' : 'Save changes'}
          </button>
          <SaveStatus dirty={dirty && !save.isPending} saved={saved} />
          <ErrorText>{save.error ? errorText(save.error, 'Could not save your profile.') : ''}</ErrorText>
        </div>
      </form>
    </>
  )
}
