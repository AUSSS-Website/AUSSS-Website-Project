import { useRef, useState } from 'react'
import usePageTitle from '../../hooks/usePageTitle.js'
import { useAuth } from '../../auth/AuthProvider.jsx'
import { useProfilePhoto, useUpdateProfile } from '../queries.js'
import { resizeImageToBlob } from '../officerQueries.js'
import { Avatar } from '../Avatar.jsx'
import { FACULTY_YEARS } from '../constants.js'
import {
  ErrorText,
  Field,
  PageHeader,
  Panel,
  Toggle,
  inputCls,
  outlineBtnCls,
  primaryBtnCls,
} from '../portalUi.jsx'

// /portal/profile. Only the columns the database lets a member write are
// editable here; membership status, tier and joined year are EB-only, and the
// email follows the sign-in account (synced by a trigger), so it is read-only.
//
// The name and the photo set here are the ones shown everywhere: bylines in
// the portal and, for whoever holds an officer or board position, the public
// pages (src/lib/people.js).

export default function ProfilePage() {
  usePageTitle('Your profile')
  const { user, profile } = useAuth()

  if (!profile) {
    return (
      <>
        <PageHeader eyebrow="Profile" title="Your profile" />
        <Panel>
          <p className="text-sm text-soft/70">
            Your profile hasn’t been created yet. Sign out and back in; if it
            still doesn’t appear, tell the webmaster.
          </p>
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
  const [error, setError] = useState('')
  const busy = photo.set.isPending || photo.clear.isPending

  const pick = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError('')
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      setError('Choose a JPEG, PNG or WebP image.')
      return
    }
    try {
      const blob = await resizeImageToBlob(file, 512, 0.85)
      await photo.set.mutateAsync({ blob, previousPath: profile.photo_path })
    } catch (err) {
      setError(err?.message || 'Could not save the photo.')
    }
  }

  const remove = async () => {
    setError('')
    try {
      await photo.clear.mutateAsync({
        previousPath: profile.photo_path,
        fallbackUrl: user.user_metadata?.avatar_url || user.user_metadata?.picture || null,
      })
    } catch (err) {
      setError(err?.message || 'Could not remove the photo.')
    }
  }

  return (
    <Panel className="mb-6 max-w-2xl">
      <div className="flex flex-wrap items-center gap-5">
        <Avatar name={profile.full_name} src={profile.avatar_url} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">Your photo</p>
          <p className="mt-1 max-w-md text-xs text-soft/55">
            Shown beside your name in the portal and in the members directory. If you hold an
            officer or board position, it is also your photo on the public website.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={pick}
              className="sr-only"
              tabIndex={-1}
              aria-label="Choose a photo"
            />
            <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className={outlineBtnCls}>
              {photo.set.isPending ? 'Saving…' : profile.photo_path ? 'Change photo' : 'Choose a photo'}
            </button>
            {profile.photo_path && (
              <button type="button" disabled={busy} onClick={remove} className={outlineBtnCls}>
                {photo.clear.isPending ? 'Removing…' : 'Remove'}
              </button>
            )}
          </div>
          <div className="mt-2">
            <ErrorText>{error}</ErrorText>
          </div>
        </div>
      </div>
    </Panel>
  )
}

function ProfileForm({ user, profile }) {
  const save = useUpdateProfile(user.id)
  const [fullName, setFullName] = useState(profile.full_name || '')
  const [phone, setPhone] = useState(profile.phone || '')
  const [facultyYear, setFacultyYear] = useState(profile.faculty_year || '')
  const [digest, setDigest] = useState(profile.email_digest !== false)
  const [msg, setMsg] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setMsg('')
    try {
      await save.mutateAsync({
        full_name: fullName.trim() || null,
        phone: phone.trim() || null,
        faculty_year: facultyYear || null,
        email_digest: digest,
      })
      setMsg('Saved.')
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
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
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
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="tel"
              placeholder="+20 1x xxxx xxxx"
              className={inputCls}
            />
          </Field>

          <Field label="Faculty year" htmlFor="pf-year">
            <select
              id="pf-year"
              value={facultyYear}
              onChange={(e) => setFacultyYear(e.target.value)}
              className={inputCls}
            >
              <option value="">Not set</option>
              {FACULTY_YEARS.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </Field>

          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line/10 pt-6">
            <div className="max-w-md">
              <p className="text-sm font-medium text-ink">Email me a daily digest</p>
              <p className="mt-1 text-xs text-soft/55">
                At most one email a day, only when a task or an update is waiting
                for you. Everything stays in the portal either way.
              </p>
            </div>
            <Toggle
              checked={digest}
              onChange={setDigest}
              label="Email me a daily digest"
              disabled={save.isPending}
            />
          </div>
        </Panel>

        <div className="mt-6 flex flex-wrap items-center gap-4">
          <button type="submit" disabled={save.isPending} className={primaryBtnCls}>
            {save.isPending ? 'Saving…' : 'Save changes'}
          </button>
          {msg && <p className="text-sm text-soft/70">{msg}</p>}
          <ErrorText>{save.error ? save.error.message || 'Could not save.' : ''}</ErrorText>
        </div>
      </form>
    </>
  )
}
