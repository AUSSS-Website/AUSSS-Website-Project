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
import VerifyPage from './pages/VerifyPage.jsx'
import VerificationQueuePage from './pages/admin/VerificationQueuePage.jsx'
import SiteSettingsPage from './pages/admin/SiteSettingsPage.jsx'
import RosterPage from './pages/admin/RosterPage.jsx'
import CommitteesPage from './pages/committee/CommitteesPage.jsx'
import CommitteeEditorPage from './pages/committee/CommitteeEditorPage.jsx'

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
            {/* Officer surfaces: the page itself checks officerOf(slug) so a
                member who types the URL gets a polite refusal. */}
            <Route path="committees" element={<CommitteesPage />} />
            <Route path="committees/:slug" element={<CommitteeEditorPage />} />
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
