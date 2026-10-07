import { Link } from 'react-router-dom'
import usePageTitle from '../../../hooks/usePageTitle.js'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { PageHeader, Panel, outlineBtnCls } from '../../portalUi.jsx'
import EventsPanel from './EventsPanel.jsx'

// /portal/events. Every event this person may edit in one list: their
// committees' events, and for the EB every committee's and the society-wide
// ones, which only the EB adds. Each committee's page in the portal has the
// same list for that committee alone (its Events tab).

export default function EventsPage() {
  usePageTitle('Events')
  const { isEB, assignments } = useAuth()
  const isOfficer = isEB || assignments.some((a) => a.position?.level === 'officer' && a.position?.committee)

  return (
    <>
      <PageHeader
        eyebrow={isEB ? 'Executive Board' : 'Officer'}
        title="Events"
        subtitle={
          isEB
            ? 'Every committee’s events, and the society-wide ones that only the Executive Board adds.'
            : 'The events of the committees you are an officer of this term.'
        }
        action={
          <Link to="/events" target="_blank" rel="noopener noreferrer" className={outlineBtnCls}>
            View events page ↗
          </Link>
        }
      />
      {isOfficer ? (
        <EventsPanel />
      ) : (
        <Panel>
          <p className="text-sm text-soft/70">
            Events are added by each committee&rsquo;s officers and by the Executive Board. If you think you should have
            access, ask the webmaster to check your assignment for this term.
          </p>
          <Link to="/portal" className="mt-4 inline-block text-sm font-semibold text-accent hover:text-ink">
            &larr; Back to your dashboard
          </Link>
        </Panel>
      )}
    </>
  )
}
