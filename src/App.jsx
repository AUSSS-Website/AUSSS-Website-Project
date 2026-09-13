import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout.jsx'
import Home from './pages/Home.jsx'

// Code-split non-home pages so the initial load only ships Home + Layout.
// /gallery in particular pulls in gsap, which we don't want in the main chunk.
const CommitteePage = lazy(() => import('./pages/CommitteePage.jsx'))
const ContactPage = lazy(() => import('./pages/ContactPage.jsx'))
const IFMSAPage = lazy(() => import('./pages/IFMSAPage.jsx'))
const IFMSAHistoryPage = lazy(() => import('./pages/IFMSAHistoryPage.jsx'))
const MagazinePage = lazy(() => import('./pages/MagazinePage.jsx'))
const LoginPage = lazy(() => import('./pages/LoginPage.jsx'))
const AccountPage = lazy(() => import('./pages/AccountPage.jsx'))
const MerchPage = lazy(() => import('./pages/MerchPage.jsx'))
const CheckoutPage = lazy(() => import('./pages/CheckoutPage.jsx'))
const MembersPage = lazy(() => import('./pages/MembersPage.jsx'))
const ConstitutionPage = lazy(() => import('./pages/ConstitutionPage.jsx'))
const ExchangePage = lazy(() => import('./pages/ExchangePage.jsx'))
const ExchangeDirectionPage = lazy(
  () => import('./pages/ExchangeDirectionPage.jsx'),
)
const ExchangeJoinPage = lazy(() => import('./pages/ExchangeJoinPage.jsx'))
const ShareStoryPage = lazy(() => import('./pages/ShareStoryPage.jsx'))
const GalleryPage = lazy(() => import('./pages/GalleryPage.jsx'))
const GalleryAdminPage = lazy(() => import('./pages/GalleryAdminPage.jsx'))
const JoinPage = lazy(() => import('./pages/JoinPage.jsx'))
const SortingPage = lazy(() => import('./pages/SortingPage.jsx'))
// The members portal (Supabase auth + react-query) is its own tree with its
// own chrome. Lazy so supabase-js never lands in the public bundle.
const PortalRoot = lazy(() => import('./portal/PortalRoot.jsx'))

// Brand-coloured placeholder shown while a lazy chunk is in flight. Matches
// the dark hero so there's no white flash on inner-page navigation.
function RouteFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-forest-950">
      <span className="h-10 w-10 animate-spin rounded-full border-2 border-white/15 border-t-medical-light" />
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      {/* Sibling of the public Layout route: the portal renders its own header
          and footer and must not inherit the marketing navbar. */}
      <Route
        path="/portal/*"
        element={
          <Suspense fallback={<RouteFallback />}>
            <PortalRoot />
          </Suspense>
        }
      />
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route
          path="*"
          element={
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/committees/:slug" element={<CommitteePage />} />
                <Route path="/contact" element={<ContactPage />} />
                <Route path="/exchange" element={<ExchangePage />} />
                <Route
                  path="/exchange/outgoings"
                  element={<ExchangeDirectionPage dir="outgoing" />}
                />
                <Route
                  path="/exchange/incomings"
                  element={<ExchangeDirectionPage dir="incoming" />}
                />
                {/* Singular forms people will type. */}
                <Route
                  path="/exchange/outgoing"
                  element={<Navigate to="/exchange/outgoings" replace />}
                />
                <Route
                  path="/exchange/incoming"
                  element={<Navigate to="/exchange/incomings" replace />}
                />
                <Route path="/exchange/join" element={<ExchangeJoinPage />} />
                <Route path="/exchange/share" element={<ShareStoryPage />} />
                <Route path="/gallery" element={<GalleryPage />} />
                <Route path="/gallery/admin" element={<GalleryAdminPage />} />
                <Route path="/gallery/:slug" element={<GalleryPage />} />
                <Route path="/join" element={<JoinPage />} />
                <Route path="/sorting" element={<SortingPage />} />
                {/* Friendly alias people will guess/type. */}
                <Route path="/quiz" element={<Navigate to="/sorting" replace />} />
                <Route path="/ifmsa" element={<IFMSAPage />} />
                <Route path="/ifmsa/history" element={<IFMSAHistoryPage />} />
                <Route path="/magazine" element={<MagazinePage />} />
                <Route path="/merch" element={<MerchPage />} />
                <Route path="/merch/checkout" element={<CheckoutPage />} />
                <Route path="/members" element={<MembersPage />} />
                <Route path="/constitution" element={<ConstitutionPage />} />
                <Route path="/login" element={<LoginPage />} />
                <Route path="/account" element={<AccountPage />} />
                {/* Social merged into Contact, keep the old URL working. */}
                <Route path="/social" element={<Navigate to="/contact" replace />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          }
        />
      </Route>
    </Routes>
  )
}
