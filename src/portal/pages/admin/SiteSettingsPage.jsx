import { useState } from 'react'
import usePageTitle from '../../../hooks/usePageTitle.js'
import { useSiteRebuildStatus, useSiteSettingsAdmin, useUpsertSiteSetting } from '../../officerQueries.js'
import { when } from '../../workUi.jsx'
import {
  Centered,
  ErrorText,
  PageHeader,
  Panel,
  Spinner,
  Toggle,
  inputCls,
  primaryBtnCls,
} from '../../portalUi.jsx'

// /portal/admin/settings (EB only, gated by RequireEB). Site-wide switches
// read by every visitor from public.site_settings. Known keys get a proper
// control; anything else is shown as raw JSON so a new setting can be added
// from the Supabase dashboard before the site has a control for it.

const KNOWN = [
  {
    key: 'magazineInHeader',
    label: 'Show the AUSSS Magazine in the header',
    hint: 'When off, the Magazine button disappears from the public site’s header for everyone.',
    type: 'boolean',
    fallback: true,
  },
  {
    key: 'merchOrdersOpen',
    label: 'Take merch orders',
    hint: 'When off, the shop stays up and the checkout says orders are closed. The same switch is on the Merch page.',
    type: 'boolean',
    fallback: true,
  },
]

// Settings with an editor of their own, which checks what is typed. They are
// not offered here as raw JSON, where a hand edit could skip those checks.
const EDITED_ELSEWHERE = {
  merchPaymentMethods: 'the payment methods, on the Merch page',
}

function BooleanSetting({ def, value, onChange, busy }) {
  const on = typeof value === 'boolean' ? value : def.fallback
  return (
    <div className="flex items-start justify-between gap-6">
      <div>
        <p className="text-sm font-semibold text-ink">{def.label}</p>
        <p className="mt-1 text-xs text-soft/55">{def.hint}</p>
      </div>
      <Toggle checked={on} onChange={onChange} label={def.label} disabled={busy} />
    </div>
  )
}

// Raw editor for keys this page does not know. The value must be valid JSON.
function RawSetting({ k, value, onSave, busy }) {
  const [text, setText] = useState(JSON.stringify(value))
  const [err, setErr] = useState('')
  const submit = (e) => {
    e.preventDefault()
    setErr('')
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      setErr('That is not valid JSON.')
      return
    }
    onSave(parsed)
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1">
        <p className="mb-2 font-mono text-xs text-soft/70">{k}</p>
        <input value={text} onChange={(e) => setText(e.target.value)} className={inputCls} />
        <ErrorText>{err}</ErrorText>
      </div>
      <button type="submit" disabled={busy} className={`${primaryBtnCls} px-5 py-2 text-xs`}>
        Save
      </button>
    </form>
  )
}

// The public pages are rebuilt on their own after something published changes
// (a photo, an album, an edition, a story, who holds a position), and once a
// night. This only reports on that; there is nothing to press.
function RebuildPanel() {
  const status = useSiteRebuildStatus()
  const s = status.data
  if (status.isPending || status.error || !s) return null
  const waiting = s.requested_at && (!s.fired_at || s.fired_at < s.requested_at)
  return (
    <Panel title="Public pages">
      <p className="mt-4 text-sm text-soft/75">
        {s.fired_at ? `Last rebuilt ${when(s.fired_at)}.` : 'Not rebuilt from the portal yet.'}{' '}
        {waiting
          ? 'A change is waiting; the next rebuild starts within a few minutes of the last edit.'
          : 'Nothing is waiting.'}
      </p>
      <p className="mt-2 text-xs text-soft/50">
        Visitors always see the latest names, photos, albums and stories straight away. The rebuild
        is for search engines and link previews, which read the saved copy of each page.
      </p>
      {!s.hook && (
        <p className="mt-3 text-xs text-warn">
          The rebuild is not connected yet: the webmaster still has to save the deploy hook
          (RUNBOOK section 23). Until then the pages are rebuilt on each code release only.
        </p>
      )}
    </Panel>
  )
}

export default function SiteSettingsPage() {
  usePageTitle('Site settings')
  const settings = useSiteSettingsAdmin(true)
  const save = useUpsertSiteSetting()
  const [msg, setMsg] = useState('')

  const set = async (key, value) => {
    setMsg('')
    try {
      await save.mutateAsync({ key, value })
      setMsg('Saved.')
    } catch {
      // save.error is rendered below
    }
  }

  const knownKeys = new Set([...KNOWN.map((d) => d.key), ...Object.keys(EDITED_ELSEWHERE)])
  const others = Object.entries(settings.data || {}).filter(([k]) => !knownKeys.has(k))

  return (
    <>
      <PageHeader
        eyebrow="Executive Board"
        title="Site settings"
        subtitle="Switches every visitor sees. Changes go live within a minute."
      />

      {settings.isPending ? (
        <Centered>
          <Spinner />
        </Centered>
      ) : settings.error ? (
        <Panel>
          <ErrorText>Couldn’t load settings: {settings.error.message}</ErrorText>
        </Panel>
      ) : (
        <div className="max-w-2xl space-y-5">
          <Panel title="Public site" className="space-y-6">
            <div className="mt-4 space-y-6">
              {KNOWN.map((def) => (
                <BooleanSetting
                  key={def.key}
                  def={def}
                  value={settings.data[def.key]}
                  busy={save.isPending}
                  onChange={(next) => set(def.key, next)}
                />
              ))}
            </div>
          </Panel>

          {others.length > 0 && (
            <Panel title="Other settings" className="space-y-6">
              <div className="mt-4 space-y-5">
                {others.map(([k, v]) => (
                  <RawSetting key={k} k={k} value={v} busy={save.isPending} onSave={(val) => set(k, val)} />
                ))}
              </div>
            </Panel>
          )}

          <RebuildPanel />

          {save.error && <ErrorText>{save.error.message}</ErrorText>}
          {msg && <p className="text-xs font-semibold text-accent">{msg}</p>}
        </div>
      )}
    </>
  )
}
