// Serves dist/ the way Vercel does: a static file first, then
// `<dir>/index.html` (the pre-rendered pages), then spa.html for everything
// else (portal, redirects, unknown URLs). `vite preview` cannot show the
// pre-rendered pages: its SPA fallback answers /join with index.html before
// looking for join/index.html. Usage: npm run preview:prerendered
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const dist = path.join(process.cwd(), 'dist')
const port = Number(process.env.PORT || 4174)
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
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
    const file = resolveFile(req.url || '/')
    if (!file) {
      res.writeHead(404)
      res.end('not found')
      return
    }
    res.writeHead(200, {
      'content-type': types[path.extname(file)] || 'application/octet-stream',
    })
    fs.createReadStream(file).pipe(res)
  })
  .listen(port, () => console.log(`dist served at http://localhost:${port}`))
