import { useState } from 'react'
import usePageTitle from '../../../hooks/usePageTitle.js'
import { useSiteSettingsAdmin, useUpsertSiteSetting } from '../../officerQueries.js'
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
// from the dashboard before the site has a UI for it.

const KNOWN = [
  {
    key: 'magazineInHeader',
    label: 'Show the AUSSS Magazine in the header',
    hint: 'When off, the Magazine link disappears from the public navbar for everyone.',
    type: 'boolean',
    fallback: true,
  },
]

function BooleanSetting({ def, value, onChange, busy }) {
  const on = typeof value === 'boolean' ? value : def.fallback
  return (
    <div className="flex items-start justify-between gap-6">
      <div>
        <p className="text-sm font-semibold text-white">{def.label}</p>
        <p className="mt-1 text-xs text-silver/55">{def.hint}</p>
      </div>
      <Toggle checked={on} onChange={onChange} label={def.label} disabled={busy} />
    </div>
  )
}

// Raw editor for keys the UI doesn't know. The value must be valid JSON.
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
      setErr('Not valid JSON.')
      return
    }
    onSave(parsed)
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1">
        <p className="mb-2 font-mono text-xs text-silver/70">{k}</p>
        <input value={text} onChange={(e) => setText(e.target.value)} className={inputCls} />
        <ErrorText>{err}</ErrorText>
      </div>
      <button type="submit" disabled={busy} className={`${primaryBtnCls} px-5 py-2 text-xs`}>
        Save
      </button>
    </form>
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

  const knownKeys = new Set(KNOWN.map((d) => d.key))
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

          {save.error && <ErrorText>{save.error.message}</ErrorText>}
          {msg && <p className="text-xs font-semibold text-medical-light">{msg}</p>}
        </div>
      )}
    </>
  )
}
