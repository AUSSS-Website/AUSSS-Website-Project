import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import App from './App.jsx'
import './index.css'

// The exchange exam's address ends in a hidden word (/exam/<word>, src/exam),
// kept in the database and nowhere else. A page view would write that word
// into the project's analytics, so views of the exam's pages are not sent.
function withoutExamViews(event) {
  let path = window.location.pathname
  try {
    path = new URL(event.url, window.location.origin).pathname
  } catch {
    // Not an address: judge by the page that is open.
  }
  return path.startsWith('/exam/') ? null : event
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
      <Analytics beforeSend={withoutExamViews} />
    </BrowserRouter>
  </React.StrictMode>,
)
