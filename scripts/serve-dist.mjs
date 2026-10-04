// Serves dist/ the way Vercel does: a static file first, then
// `<dir>/index.html` (the pre-rendered pages), then spa.html for everything
// else (portal, redirects, unknown URLs). `vite preview` cannot show the
// pre-rendered pages: its SPA fallback answers /join with index.html before
// looking for join/index.html. Usage: npm run preview:prerendered
//
// It also sends the response headers of vercel.json (the Content-Security-
// Policy among them), so a policy change can be tried here, with the page
// walk, before it is deployed.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const dist = path.join(process.cwd(), 'dist')
const port = Number(process.env.PORT || 4174)

// vercel.json "headers": each `source` is a path pattern; the two shapes in
// use ("/(.*)" and "/assets/(.*)") are already valid regular expressions.
const headerRules = (JSON.parse(fs.readFileSync(path.join(process.cwd(), 'vercel.json'), 'utf8')).headers || []).map(
  (rule) => ({ match: new RegExp(`^${rule.source}$`), headers: rule.headers }),
)

function headersFor(urlPath) {
  const out = {}
  for (const rule of headerRules) {
    if (!rule.match.test(urlPath)) continue
    // Left out here: upgrade-insecure-requests and HSTS (they would turn this
    // server's own http:// URLs into https:// ones that nothing answers) and
    // the year-long asset caching (the browser would keep serving this
    // build's files to the dev server on the same port).
    for (const h of rule.headers) {
      if (h.key === 'Strict-Transport-Security' || h.key === 'Cache-Control') continue
      out[h.key] = h.value.replace(/;\s*upgrade-insecure-requests/, '')
    }
  }
  return out
}
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  // The pdf.js worker. Without a script type the browser refuses to run it
  // (the nosniff header forbids guessing).
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
}

function resolveFile(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]).replace(/\/+$/, '')
  const candidates = [
    path.join(dist, clean),
    path.join(dist, clean, 'index.html'),
    path.join(dist, 'spa.html'),
  ]
  for (const c of candidates) {
    if (!c.startsWith(dist)) continue
    try {
      if (fs.statSync(c).isFile()) return c
    } catch {
      /* next candidate */
    }
  }
  return null
}

http
  .createServer((req, res) => {
    // Vercel serves its analytics script itself; answer with an empty one so
    // the local console matches production.
    if ((req.url || '').startsWith('/_vercel/insights/')) {
      res.writeHead(200, { 'content-type': 'text/javascript' })
      res.end('')
      return
    }
    const file = resolveFile(req.url || '/')
    if (!file) {
      res.writeHead(404)
      res.end('not found')
      return
    }
    res.writeHead(200, {
      ...headersFor((req.url || '/').split('?')[0]),
      'content-type': types[path.extname(file)] || 'application/octet-stream',
    })
    fs.createReadStream(file).pipe(res)
  })
  .listen(port, () => console.log(`dist served at http://localhost:${port}`))
