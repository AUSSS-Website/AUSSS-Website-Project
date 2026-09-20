import { useState } from 'react'
import usePageTitle from '../../hooks/usePageTitle.js'
import { useAuth } from '../../auth/AuthProvider.jsx'
import { useUpdateProfile } from '../queries.js'
import { FACULTY_YEARS } from '../constants.js'
import {
  ErrorText,
  Field,
  PageHeader,
  Panel,
  Toggle,
  inputCls,
  primaryBtnCls,
} from '../portalUi.jsx'

// /portal/profile. Only the columns the column-level grant allows are
// editable here; membership status/tier/joined year are EB-only via RPC and
// email follows the auth account (synced by a DB trigger), so it's read-only.

export default function ProfilePage() {
  usePageTitle('Your profile')
  const { user, profile } = useAuth()

  if (!profile) {
    return (
      <>
        <PageHeader eyebrow="Profile" title="Your profile" />
        <Panel>
          <p className="text-sm text-silver/70">
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

function ProfileForm({ user, profile }) {
  const save = useUpdateProfile(user.id)
  const [fullName, setFullName] = useState(profile.full_name || '')
  const [phone, setPhone] = useState(profile.phone || '')
  const [facultyYear, setFacultyYear] = useState(profile.faculty_year || '')
  const [optIn, setOptIn] = useState(Boolean(profile.directory_opt_in))
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
        directory_opt_in: optIn,
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
        subtitle="What officers and the EB see about you."
      />
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

          <Field label="Phone" htmlFor="pf-phone" hint="Optional. Used by your officer to reach you.">
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

          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-6">
            <div className="max-w-md">
              <p className="text-sm font-medium text-white">Show me in the members directory</p>
              <p className="mt-1 text-xs text-silver/55">
                Off by default. When on, other verified members can see your name
                and positions.
              </p>
            </div>
            <Toggle
              checked={optIn}
              onChange={setOptIn}
              label="Show me in the members directory"
              disabled={save.isPending}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-6">
            <div className="max-w-md">
              <p className="text-sm font-medium text-white">Email me a daily digest</p>
              <p className="mt-1 text-xs text-silver/55">
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
          {msg && <p className="text-sm text-silver/70">{msg}</p>}
          <ErrorText>{save.error ? save.error.message || 'Could not save.' : ''}</ErrorText>
        </div>
      </form>
    </>
  )
}
