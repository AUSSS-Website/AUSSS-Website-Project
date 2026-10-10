import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { supabaseEnabled } from '../lib/supabase.js'
import { AuthCard } from '../portal/portalUi.jsx'
import ExamCallback from './ExamCallback.jsx'
import ExamDoor from './ExamDoor.jsx'

// Lazy boundary for everything under /exam/*, the exchange exam as students
// sit it (App.jsx imports this file with React.lazy). It is a tree of its
// own: no AuthProvider, no PortalLayout and no react-query, only the supabase
// client and the session state the door keeps.
//
// The address is hidden. Nothing on the site or in the portal links to it, it
// is in no sitemap, and while this tree is mounted the page tells crawlers
// not to index it (vercel.json says the same in a header). It is not in
// robots.txt on purpose: a crawler that may not fetch a page cannot read its
// noindex.

// <meta name="robots" content="noindex, nofollow"> for as long as an exam
// page is on screen; what was there before comes back on the way out.
function useNoIndex() {
  useEffect(() => {
    const found = document.querySelector('meta[name="robots"]')
    const before = found ? found.getAttribute('content') : null
    const meta = found || document.createElement('meta')
    meta.setAttribute('name', 'robots')
    meta.setAttribute('content', 'noindex, nofollow')
    if (!found) document.head.appendChild(meta)
    return () => {
      if (!found) meta.remove()
      else if (before === null) meta.removeAttribute('content')
      else meta.setAttribute('content', before)
    }
  }, [])
}

// Shown when VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are blank, e.g. a
// local build without .env.local (as the portal's own card in PortalRoot.jsx).
function NotConfigured() {
  return (
    <AuthCard
      eyebrow="Exchange exam"
      title="Exam not set up"
      subtitle="This copy of the site is not connected to the exam. Use the link the exchange team sent you."
    />
  )
}

export default function ExamRoot() {
  useNoIndex()
  if (!supabaseEnabled) return <NotConfigured />
  return (
    <Routes>
      {/* Google sign-in returns here, then goes on to the exam's own address. */}
      <Route path="callback" element={<ExamCallback />} />
      {/* The whole of a taker's flow, at the exam's hidden word. */}
      <Route path=":word" element={<ExamDoor />} />
      {/* /exam alone, or anything deeper, is not an address. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
