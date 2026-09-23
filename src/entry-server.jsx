// Build-time rendering entry, used only by scripts/prerender.mjs. It renders
// the public app for one URL to a string so every public page ships as real
// HTML (crawlers that do not run JavaScript, and social preview cards, read
// that). The browser bundle never imports this file.
import { StrictMode } from 'react'
import { Writable } from 'node:stream'
import { renderToPipeableStream } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom'
import App from './App.jsx'

export function render(url) {
  return new Promise((resolve, reject) => {
    const chunks = []
    const sink = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(Buffer.from(chunk))
        cb()
      },
      final(cb) {
        resolve(Buffer.concat(chunks).toString('utf8'))
        cb()
      },
    })
    // The route tree is code-split with React.lazy; onAllReady fires once every
    // lazy chunk and Suspense boundary has resolved, so the markup is complete
    // and inline (no client-side swap scripts).
    const { pipe } = renderToPipeableStream(
      <StrictMode>
        <StaticRouter location={url}>
          <App />
        </StaticRouter>
      </StrictMode>,
      {
        onAllReady() {
          pipe(sink)
        },
        onShellError(err) {
          reject(err)
        },
        onError(err) {
          reject(err)
        },
      },
    )
  })
}
