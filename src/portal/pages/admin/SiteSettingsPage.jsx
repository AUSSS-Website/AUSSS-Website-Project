import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import usePageTitle from '../../../hooks/usePageTitle.js'
import { errorText } from '../../../lib/errorText.js'
import { useSiteRebuildStatus, useSiteSettingsAdmin, useUpsertSiteSetting } from '../../officerQueries.js'
import { when } from '../../workUi.jsx'
import {
  ErrorText,
  PageHeader,
  PageLoading,
  Panel,
  SaveStatus,
  Toggle,
  inputCls,
  primaryBtnCls,
} from '../../portalUi.jsx'

// /portal/admin/settings (EB only, gated by RequireEB). Site-wide switches
// read by every visitor from public.site_settings. Known keys get a proper
// control; anything else is shown as raw JSON so a new setting can be added
// from the Supabase dashboard before the site has a control for it. The way
// to the New term page is here too (it is used once a year, so it has no
// link in the header).
//
// Every setting saves by itself and says so on its own row: a switch moves
// the moment it is flipped, "Saved." shows under it for a few seconds, and a
// save that fails puts that one switch back and says why beside it. The
// other rows are never touched by it.

// `askBeforeOn` is for a switch that can do harm while it is on: turning it on
// takes a second click, and this is the sentence that asks for it. Turning it
// off is always one click.
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
  {
    key: 'openCallsLive',
    label: 'Show Open Calls on the public site',
    hint: 'When on, the calls officers publish appear on their committee pages with an Apply button. When off, officers can still prepare calls in the portal and nobody else sees them.',
    type: 'boolean',
    fallback: false,
  },
  {
    key: 'magazineCountersVisible',
    label: 'Show reads and likes on the magazine',
    hint: 'Shows the number of reads and a Like button under each edition. Reads and how far people read are recorded either way.',
    type: 'boolean',
    fallback: false,
  },
  {
    key: 'domainEmailsLive',
    label: 'Show the @ausss-ainshams.org addresses',
    hint: 'Turn this on only after every forwarding rule is set up and a test message has arrived (RUNBOOK section 19), or mail sent to those addresses bounces. While it is off, the site shows the Gmail inboxes.',
    type: 'boolean',
    fallback: false,
    askBeforeOn: 'Click the switch again to turn this on. Mail bounces unless forwarding is set up.',
  },
]

// Settings with an editor of their own, which checks what is typed. They are
// not offered here as raw JSON, where a hand edit could skip those checks.
const EDITED_ELSEWHERE = {
  merchPaymentMethods: 'the payment methods, on the Merch page',
}

// How long "Saved." stays under a setting.
const SAVED_NOTE_MS = 4000
// A switch that asks before turning on keeps ConfirmButton's timing
// (portalUi.jsx), so the two feel alike: it stops asking after five seconds,
// and a second click inside half a second is a double-click, not an answer.
const DISARM_MS = 5000
const CONFIRM_AFTER_MS = 500

// On a touch screen a button is at least a thumb tall; with a mouse it keeps
// the portal's small pill.
const tapCls = '[@media(pointer:coarse)]:min-h-[44px]'

// What stands around each switch. Toggle (portalUi.jsx) is 28px tall and takes
// no class of its own, so both things are done from here. The ::after gives
// the switch a thumb's 44px to land on without changing how it looks: unseen,
// centred on it, and in px because the root size shrinks on a 320px phone.
// The last class stops the knob sliding for a reader who has asked for less
// motion; the track still changes colour.
const switchWrapCls =
  "inline-flex rounded-full [&>button::after]:absolute [&>button::after]:inset-x-0 [&>button::after]:top-1/2 [&>button::after]:h-[44px] [&>button::after]:-translate-y-1/2 [&>button::after]:content-[''] motion-reduce:[&>button>span]:transition-none"

// True for a few seconds after show(): a "Saved." that says its piece and
// leaves, so it is never still up when the next change is made.
function useBriefNote() {
  const [shown, setShown] = useState(false)
  const timer = useRef(null)
  // False once the row has left the page. A save can still be on its way
  // then, and its "Saved." must not start a timer that nothing will clear.
  const here = useRef(false)
  useEffect(() => {
    here.current = true
    return () => {
      here.current = false
      clearTimeout(timer.current)
    }
  }, [])
  const show = () => {
    if (!here.current) return
    clearTimeout(timer.current)
    setShown(true)
    timer.current = setTimeout(() => setShown(false), SAVED_NOTE_MS)
  }
  const hide = () => {
    clearTimeout(timer.current)
    setShown(false)
  }
  return [shown, show, hide]
}

function BooleanSetting({ def }) {
  // The row reads the setting for itself, so the render that follows its own
  // save already holds the saved value. Handed down from the page, the value
  // would arrive a moment later and the switch would flick back for a frame.
  const stored = useSiteSettingsAdmin().data?.[def.key]
  const kept = typeof stored === 'boolean' ? stored : def.fallback
  const save = useUpsertSiteSetting()
  // What was last asked for, until the server has answered. The switch shows
  // this at once; null means it shows what the server holds.
  const [asked, setAsked] = useState(null)
  const [error, setError] = useState('')
  const [savedNote, noteSaved, clearNote] = useBriefNote()
  const want = useRef(null)
  const sending = useRef(false)
  // The first click on a switch that asks before it turns on.
  const [armed, setArmed] = useState(false)
  const armedAt = useRef(0)
  useEffect(() => {
    if (!armed) return undefined
    const timer = setTimeout(() => setArmed(false), DISARM_MS)
    return () => clearTimeout(timer)
  }, [armed])

  const on = asked ?? kept
  const saving = asked !== null

  // The switch never waits and is never locked. A flip made while a write is
  // on its way is sent after it, so the last position asked for is the one
  // kept; if a write fails the switch goes back to what the server holds.
  const write = async (next) => {
    want.current = next
    setAsked(next)
    setError('')
    clearNote()
    if (sending.current) return
    sending.current = true
    try {
      let sent
      do {
        sent = want.current
        await save.mutateAsync({ key: def.key, value: sent })
      } while (want.current !== sent)
      noteSaved()
    } catch (err) {
      setError(errorText(err, 'We couldn’t save that. The switch is back where it was.'))
    } finally {
      sending.current = false
      setAsked(null)
    }
  }

  const flip = (next) => {
    if (next && def.askBeforeOn) {
      if (!armed) {
        armedAt.current = performance.now()
        setArmed(true)
        return
      }
      if (performance.now() - armedAt.current < CONFIRM_AFTER_MS) return
    }
    setArmed(false)
    write(next)
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">{def.label}</p>
          <p className="mt-1 text-xs text-soft/55">{def.hint}</p>
        </div>
        {/* A fixed width, so the words under the switch never push the text
            beside it; a line is kept for them, so the row never changes height. */}
        <div className="flex w-16 shrink-0 flex-col items-end gap-1">
          <span
            className={`${switchWrapCls} ${armed ? 'outline outline-2 outline-offset-2 outline-danger' : ''}`}
            onBlur={() => setArmed(false)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setArmed(false)
              // A held key repeats Enter's click; only a fresh press counts.
              if (e.key === 'Enter' && e.repeat) e.preventDefault()
            }}
          >
            <Toggle checked={on} onChange={flip} label={def.label} />
          </span>
          <p role="status" className={`min-h-[1rem] text-xs ${saving ? 'text-soft/60' : 'text-ok'}`}>
            {saving ? 'Saving…' : savedNote ? 'Saved.' : ''}
          </p>
        </div>
      </div>
      {def.askBeforeOn && (
        <p role="status" className={armed ? 'mt-2 text-xs font-semibold text-danger' : 'sr-only'}>
          {armed ? def.askBeforeOn : ''}
        </p>
      )}
      {error && (
        <div className="mt-2">
          <ErrorText>{error}</ErrorText>
        </div>
      )}
    </div>
  )
}

// Raw editor for keys this page does not know. The value must be valid JSON.
function RawSetting({ k, value }) {
  const save = useUpsertSiteSetting()
  const id = useId()
  // `base` is what the box held when it was last loaded or saved: the text is
  // unsaved while it differs.
  const [base, setBase] = useState(() => JSON.stringify(value))
  const [text, setText] = useState(base)
  const [err, setErr] = useState('')
  const [savedNote, noteSaved, clearNote] = useBriefNote()
  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    clearNote()
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      setErr('That is not valid JSON.')
      return
    }
    try {
      await save.mutateAsync({ key: k, value: parsed })
      // The box takes the value as it was stored, so spacing typed by hand
      // does not leave it looking unsaved.
      const stored = JSON.stringify(parsed)
      setBase(stored)
      setText(stored)
      noteSaved()
    } catch (error) {
      setErr(errorText(error, 'We couldn’t save that setting.'))
    }
  }
  return (
    <form onSubmit={submit}>
      <label htmlFor={id} className="mb-2 block font-mono text-xs text-soft/70">
        {k}
      </label>
      {/* On a phone the box takes the whole line and Save goes under it. */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          id={id}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className={`${inputCls} min-w-[12rem] flex-1 font-mono`}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={err ? true : undefined}
          aria-describedby={err ? `${id}-error` : undefined}
        />
        <button
          type="submit"
          disabled={save.isPending}
          // Wide enough for "Saving…", so the box beside it keeps its width.
          className={`${primaryBtnCls} ${tapCls} min-w-[6.5rem] shrink-0 px-5 py-2 text-xs`}
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
      <SaveStatus dirty={text !== base} saved={savedNote} className="mt-2" />
      {err && (
        <div className="mt-2">
          <ErrorText id={`${id}-error`}>{err}</ErrorText>
        </div>
      )}
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

// The way to /portal/admin/rollover. Opening that page changes nothing: it
// shows what the switch would do, and has its own button at the end.
function NewTermPanel() {
  return (
    <Panel title="New term">
      <p className="mt-4 text-sm text-soft/75">
        At the end of the academic year, move the society into the next term: the work accounts keep their
        positions, open tasks move across, and the gallery&rsquo;s albums can go to the archive.
      </p>
      <p className="mt-2 text-xs text-soft/55">
        Opening the page changes nothing. It shows what the switch will do, and nothing happens until you press the
        button at its end.
      </p>
      <Link to="/portal/admin/rollover" className={`${primaryBtnCls} mt-5`}>
        New term
        <span aria-hidden="true">&rarr;</span>
      </Link>
    </Panel>
  )
}

export default function SiteSettingsPage() {
  usePageTitle('Site settings')
  const settings = useSiteSettingsAdmin(true)

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
        <PageLoading />
      ) : settings.error ? (
        <Panel>
          <ErrorText>{errorText(settings.error, 'We couldn’t load the settings.')}</ErrorText>
        </Panel>
      ) : (
        <div className="max-w-2xl space-y-5">
          <Panel title="Public site" className="space-y-6">
            <div className="mt-4 space-y-6">
              {KNOWN.map((def) => (
                <BooleanSetting key={def.key} def={def} />
              ))}
            </div>
          </Panel>

          {others.length > 0 && (
            <Panel title="Other settings" className="space-y-6">
              <div className="mt-4 space-y-5">
                {others.map(([k, v]) => (
                  <RawSetting key={k} k={k} value={v} />
                ))}
              </div>
            </Panel>
          )}

          <RebuildPanel />
        </div>
      )}

      {/* Outside the settings themselves, so it is there even if they fail to load. */}
      <div className="mt-5 max-w-2xl">
        <NewTermPanel />
      </div>
    </>
  )
}
