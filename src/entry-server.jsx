// Build-time rendering entry, used only by scripts/prerender.mjs. It renders
// the public app for one URL to a string so every public page ships as real
// HTML (crawlers that do not run JavaScript, and social preview cards, read
// that). The browser bundle never imports this file.
import { StrictMode } from 'react'
import { Writable } from 'node:stream'
import { renderToPipeableStream } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom'
import App from './App.jsx'
import { setBakedGallery } from './lib/gallery.js'
import { setBakedMagazine } from './lib/magazine.js'
import { setBakedStories } from './lib/exchangeStories.js'
import { setBakedPeople } from './lib/people.js'
import { setBakedContent } from './lib/content.js'
import { setBakedMerch } from './lib/merch.js'
import { setBakedSettings } from './hooks/useSiteSettings.js'
import { setBakedEvents } from './lib/events.js'

// `albums`, `issues`, `stories` and `people` are the live gallery, magazine
// shelf, published exchange stories and position holders the prerender fetched
// once (src/lib/gallery.js, magazine.js, exchangeStories.js, people.js), so
// /gallery, every album page, /magazine, the exchange pages and every page
// that names an officer render with the real content. `content` is the
// published documents of the portal's content editor (src/lib/content.js), and
// `merch` the shop's catalogue (src/lib/merch.js), and `settings` the site
// settings (src/hooks/useSiteSettings.js), and `events` the published events
// (src/lib/events.js).
export function render(url, albums, issues, stories = [], people = [], content = {}, merch = [], settings = {}, events = []) {
  setBakedGallery(albums)
  setBakedMagazine(issues)
  setBakedStories(stories)
  setBakedPeople(people)
  setBakedContent(content)
  setBakedMerch(merch)
  setBakedSettings(settings)
  setBakedEvents(events)
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
