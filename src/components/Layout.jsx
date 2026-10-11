import { Outlet } from 'react-router-dom'
import Navbar from './Navbar.jsx'
import Footer from './Footer.jsx'
import BackToTop from './BackToTop.jsx'
import BackButton from './BackButton.jsx'
import ScrollManager from './ScrollManager.jsx'
import CartDrawer from './CartDrawer.jsx'
import { useCartDrawerOpen, closeCartDrawer } from '../lib/cart.js'

export default function Layout() {
  const cartOpen = useCartDrawerOpen()
  return (
    <div className="min-h-screen bg-page">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <ScrollManager />
      <Navbar />
      {/* The floating Back, shown from lg up. Below that the bar carries its
          own (Navbar.jsx), so on a phone nothing floats over the page. */}
      <BackButton />
      {/* The skip link's target takes focus so the next Tab starts in the page.
          It is not a control, so it draws no focus ring round the whole page. */}
      <main id="main-content" tabIndex={-1} className="focus:outline-none">
        <Outlet />
      </main>
      <Footer />
      <BackToTop />
      <CartDrawer open={cartOpen} onClose={closeCartDrawer} />
    </div>
  )
}
