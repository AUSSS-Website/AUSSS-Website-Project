import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import usePageTitle from '../../../hooks/usePageTitle.js'
import useTabParam from '../../../hooks/useTabParam.js'
import { committeeBySlug } from '../../../data/society.js'
import { errorText } from '../../../lib/errorText.js'
import { pressCls } from '../../../lib/motion.js'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { useCommittee } from '../../officerQueries.js'
import { ErrorText, PageHeader, PageLoading, Panel, outlineBtnCls } from '../../portalUi.jsx'
import PageEditor from './PageEditor.jsx'
import CallsPanel from './CallsPanel.jsx'
import MembersPanel from './MembersPanel.jsx'
import PositionsPanel from './PositionsPanel.jsx'
import EventsPanel from '../events/EventsPanel.jsx'

// /portal/committees/:slug. What an officer manages for their committee:
// the public page itself, its events, the recruitment calls running on it,
// the committee's own members, and the invites and positions of people who
// are not on its members list. The database decides what is allowed
// (save_committee_page and the calls policies); this page only decides what
// to show, so a member who types the URL sees a polite refusal instead of a
// broken editor.
//
// The open tab is in the address as ?tab=, so a reload and a link sent to
// another officer open the same one.

const TABS = [
  ['page', 'Committee page'],
  ['events', 'Events'],
  ['calls', 'Open calls'],
  ['members', 'Members'],
  ['invites', 'Invites'],
]

const tabId = (key) => `committee-tab-${key}`
const panelId = (key) => `committee-part-${key}`

// A tab is a small pill to the eye and 44px high for a finger: an unseen
// ::after carries the extra, in px because the root size shrinks on a 320px
// phone. The way back and "View public page" in the header take the same.
const tabTapCls =
  "relative after:absolute after:inset-x-0 after:top-1/2 after:h-[44px] after:-translate-y-1/2 after:content-['']"

// The tabs and what each one opens. Keyed by committee where it is used, so
// nothing typed for one committee is carried into the next.
function EditorTabs({ committee, staticCommittee }) {
  const [tab, setTab] = useTabParam(TABS, 'page')
  // A part is put on the page the first time its tab is opened and then stays
  // there, hidden while another tab shows. Every part holds something typed
  // (a half-written call, a note about a member, an event's title, an invite),
  // and a look at another tab must not lose it.
  const [opened, setOpened] = useState([tab])
  if (!opened.includes(tab)) setOpened([...opened, tab])

  // The arrow keys move along the row, as they do in any set of tabs. They
  // count from the tab that has the focus, not from the open one: the address
  // changes a moment before the page does, and a second quick press would
  // otherwise start from the old tab.
  const onKeyDown = (e) => {
    const keys = TABS.map(([key]) => key)
    const at = keys.findIndex((key) => tabId(key) === e.target.id)
    if (at < 0) return
    const to =
      e.key === 'ArrowRight'
        ? (at + 1) % keys.length
        : e.key === 'ArrowLeft'
          ? (at - 1 + keys.length) % keys.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? keys.length - 1
              : -1
    if (to < 0) return
    e.preventDefault()
    setTab(keys[to])
    document.getElementById(tabId(keys[to]))?.focus()
  }

  const parts = {
    page: <PageEditor committee={committee} staticCommittee={staticCommittee} />,
    events: <EventsPanel committee={committee} />,
    calls: <CallsPanel committee={committee} />,
    members: <MembersPanel committee={committee} />,
    invites: <PositionsPanel committee={committee} />,
  }

  return (
    <>
      <div
        role="tablist"
        aria-label="Committee editor"
        onKeyDown={onKeyDown}
        className="mb-8 flex flex-wrap gap-2"
      >
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={tabId(key)}
            aria-selected={tab === key}
            aria-controls={panelId(key)}
            onClick={() => setTab(key)}
            className={`rounded-full px-4 py-1.5 text-xs font-semibold ${pressCls} ${tabTapCls} ${
              tab === key
                ? 'bg-cta text-on-cta'
                : 'border border-line/15 text-soft/70 hover:text-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* The two fixed save bars (the page editor's and the call editor's)
          are hidden with their parts, so only one is ever on screen. */}
      {TABS.map(
        ([key]) =>
          (tab === key || opened.includes(key)) && (
            <div
              key={key}
              role="tabpanel"
              id={panelId(key)}
              aria-labelledby={tabId(key)}
              className={tab === key ? '' : 'hidden'}
            >
              {parts[key]}
            </div>
          ),
      )}
    </>
  )
}

export default function CommitteeEditorPage() {
  const { slug } = useParams()
  const { officerOf } = useAuth()
  const committee = useCommittee(slug)
  const staticCommittee = committeeBySlug(slug)
  usePageTitle(staticCommittee ? `Edit ${staticCommittee.abbr}` : 'Edit committee')

  if (committee.isPending) return <PageLoading />
  if (committee.error) {
    return (
      <Panel>
        <ErrorText>{errorText(committee.error, 'Couldn’t load this committee.')}</ErrorText>
      </Panel>
    )
  }
  if (!committee.data || !staticCommittee) {
    return (
      <Panel>
        <p className="text-sm text-soft/70">Unknown committee ({slug}).</p>
        <Link
          to="/portal/committees"
          className="mt-4 inline-block text-sm font-semibold text-accent hover:text-ink"
        >
          &larr; Choose another committee
        </Link>
      </Panel>
    )
  }
  if (!officerOf(slug)) {
    return (
      <Panel>
        <p className="text-sm text-soft/70">
          Only {committee.data.abbr}&rsquo;s officers and the Executive Board can
          edit this page. If you think you should have access, ask the webmaster
          to check your assignment for this term.
        </p>
        <Link
          to="/portal"
          className="mt-4 inline-block text-sm font-semibold text-accent hover:text-ink"
        >
          &larr; Back to your dashboard
        </Link>
      </Panel>
    )
  }

  const c = committee.data

  return (
    <>
      <PageHeader
        eyebrow={
          // The way back is one line of small capitals; the same unseen 44px
          // as the tabs gives a finger room to land on it.
          <Link to="/portal/committees" className={`transition-colors hover:text-ink ${tabTapCls}`}>
            &larr; Your committees
          </Link>
        }
        title={
          <span className="flex items-center gap-3">
            {c.logo && (
              <span
                className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-lg border bg-page p-1"
                style={{ borderColor: c.color || 'rgb(var(--c-line) / 0.15)' }}
              >
                <img src={c.logo} alt="" className="logo-ink h-full w-full object-contain" />
              </span>
            )}
            {c.abbr}
          </span>
        }
        subtitle={c.name}
        action={
          <Link
            to={`/committees/${c.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className={`${outlineBtnCls} ${tabTapCls}`}
          >
            View public page ↗
          </Link>
        }
      />

      <EditorTabs key={c.id} committee={c} staticCommittee={staticCommittee} />
    </>
  )
}
