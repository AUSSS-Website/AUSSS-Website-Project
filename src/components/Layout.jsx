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
    <div className="min-h-screen bg-cream dark:bg-forest-950">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <ScrollManager />
      <Navbar />
      <BackButton />
      <main id="main-content" tabIndex={-1}>
        <Outlet />
      </main>
      <Footer />
      <BackToTop />
      <CartDrawer open={cartOpen} onClose={closeCartDrawer} />
    </div>
  )
}
