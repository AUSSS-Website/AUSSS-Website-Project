import { Navigate, Route, Routes } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { supabaseEnabled } from '../lib/supabase.js'
import { queryClient } from './queryClient.js'
import { AuthProvider } from '../auth/AuthProvider.jsx'
import { RequireAuth, RequireEB } from '../auth/RequireAuth.jsx'
import PortalLayout from './PortalLayout.jsx'
import { AuthCard, BackLink } from './portalUi.jsx'
import SignInPage from './pages/SignInPage.jsx'
import CallbackPage from './pages/CallbackPage.jsx'
import DashboardPage from './pages/DashboardPage.jsx'
import ProfilePage from './pages/ProfilePage.jsx'
import DirectoryPage from './pages/DirectoryPage.jsx'
import VerifyPage from './pages/VerifyPage.jsx'
import TasksPage from './pages/tasks/TasksPage.jsx'
import TaskPage from './pages/tasks/TaskPage.jsx'
import UpdatesPage from './pages/updates/UpdatesPage.jsx'
import NotificationsPage from './pages/NotificationsPage.jsx'
import VerificationQueuePage from './pages/admin/VerificationQueuePage.jsx'
import SiteSettingsPage from './pages/admin/SiteSettingsPage.jsx'
import RosterPage from './pages/admin/RosterPage.jsx'
import CommitteesPage from './pages/committee/CommitteesPage.jsx'
import CommitteeEditorPage from './pages/committee/CommitteeEditorPage.jsx'
import GalleryEditorPage from './pages/gallery/GalleryPage.jsx'
import AlbumEditorPage from './pages/gallery/AlbumEditorPage.jsx'
import MagazineEditorPage from './pages/magazine/MagazinePage.jsx'
import IssueEditorPage from './pages/magazine/IssueEditorPage.jsx'
import MerchEditorPage from './pages/merch/MerchPage.jsx'
import ProductEditorPage from './pages/merch/ProductEditorPage.jsx'
import SubmissionsPage from './pages/submissions/SubmissionsPage.jsx'
import ContentPage from './pages/content/ContentPage.jsx'
import ContentEditorPage from './pages/content/ContentEditorPage.jsx'
import AuditLogPage from './pages/admin/AuditLogPage.jsx'

// Lazy boundary for everything under /portal/*. This is the ONLY place the
// public app touches the portal, so supabase-js and react-query stay out of
// the public bundle entirely (App.jsx imports this file with React.lazy).

// Shown when VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are blank, e.g. a
// local build without .env.local. Better than a white screen from createClient.
function NotConfigured() {
  return (
    <AuthCard
      eyebrow="Members"
      title="Portal not set up"
      subtitle="The members portal is not configured on this deployment yet. Check back soon."
    >
      <BackLink />
    </AuthCard>
  )
}

export default function PortalRoot() {
  if (!supabaseEnabled) return <NotConfigured />
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Routes>
          <Route path="sign-in" element={<SignInPage />} />
          <Route path="callback" element={<CallbackPage />} />
          <Route
            element={
              <RequireAuth>
                <PortalLayout />
              </RequireAuth>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="verify" element={<VerifyPage />} />
            {/* Members who opted in; the database refuses an unverified account. */}
            <Route path="directory" element={<DirectoryPage />} />
            {/* The database decides which tasks and updates each person gets. */}
            <Route path="tasks" element={<TasksPage />} />
            <Route path="tasks/:id" element={<TaskPage />} />
            <Route path="updates" element={<UpdatesPage />} />
            <Route path="notifications" element={<NotificationsPage />} />
            {/* Officer surfaces: the page itself checks officerOf(slug) so a
                member who types the URL gets a polite refusal. */}
            <Route path="committees" element={<CommitteesPage />} />
            <Route path="committees/:slug" element={<CommitteeEditorPage />} />
            {/* Gallery editor: PNSD officers and the EB (the page checks officerOf('pnsd')). */}
            <Route path="gallery" element={<GalleryEditorPage />} />
            <Route path="gallery/:slug" element={<AlbumEditorPage />} />
            {/* Magazine editor: CBSD officers and the EB (the page checks officerOf('cbsd')). */}
            <Route path="magazine" element={<MagazineEditorPage />} />
            <Route path="magazine/:slug" element={<IssueEditorPage />} />
            {/* Merch shop: the EB (the page checks isEB; the database decides). */}
            <Route path="merch" element={<MerchEditorPage />} />
            <Route path="merch/:id" element={<ProductEditorPage />} />
            {/* Submissions: the EB (orders, stories, waitlist) and the exchange officers (stories). */}
            <Route path="submissions" element={<SubmissionsPage />} />
            {/* Site content: the EB, and officers for the parts that name their
                committee. The database returns only the blocks a person may edit. */}
            <Route path="content" element={<ContentPage />} />
            <Route path="content/:key" element={<ContentEditorPage />} />
            {/* The audit log: the webmaster (the page says so to anyone else, and
                the database returns them no rows). */}
            <Route path="admin/audit" element={<AuditLogPage />} />
            <Route
              path="admin/settings"
              element={
                <RequireEB>
                  <SiteSettingsPage />
                </RequireEB>
              }
            />
            <Route
              path="admin/roster"
              element={
                <RequireEB>
                  <RosterPage />
                </RequireEB>
              }
            />
            <Route
              path="admin/verification"
              element={
                <RequireEB>
                  <VerificationQueuePage />
                </RequireEB>
              }
            />
          </Route>
          <Route path="*" element={<Navigate to="/portal" replace />} />
        </Routes>
      </AuthProvider>
    </QueryClientProvider>
  )
}
