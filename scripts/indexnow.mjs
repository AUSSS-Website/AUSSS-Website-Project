// Tells Bing (and through it DuckDuckGo, Copilot and ChatGPT search) which
// public pages changed, using IndexNow (https://www.indexnow.org).
//
// The build works out what changed: scripts/prerender.mjs hashes every page
// it writes, compares the hashes with the ones the live site published at
// its own build (/page-hashes.json) and writes the difference to
// /indexnow-urls.json. This script runs after a production deploy
// (.github/workflows/after-deploy.yml), reads that list from the live site
// and submits it. Nothing is stored between runs.
//
// The key is not a secret: IndexNow proves ownership by finding the same key
// in a text file on the site (public/<key>.txt). To rotate it, rename that
// file, put the new key inside it and change KEY below.
//
//   node scripts/indexnow.mjs            submit what the last build changed
//   node scripts/indexnow.mjs --all      submit every URL in the sitemap
//   node scripts/indexnow.mjs --dry-run  print what would be submitted
const SITE = 'https://ausss-ainshams.org'
const KEY = '28ef8fbf5f626f384f1d1a3a23725e6d'
const ENDPOINT = 'https://api.indexnow.org/indexnow'

const args = new Set(process.argv.slice(2))
const all = args.has('--all')
const dryRun = args.has('--dry-run')

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'ausss-indexnow' } })
  if (!res.ok) throw new Error(`${url} answered ${res.status}`)
  return res.text()
}

async function sitemapUrls() {
  const sitemap = await get(`${SITE}/sitemap.xml`)
  return [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, '&'))
}

async function changedUrls() {
  const list = JSON.parse(await get(`${SITE}/indexnow-urls.json`))
  if (!Array.isArray(list)) throw new Error('indexnow-urls.json is not a list')
  return list.filter((url) => typeof url === 'string' && url.startsWith(`${SITE}/`))
}

async function main() {
  // Without the key file every submission is rejected, so stop before sending.
  const keyFile = (await get(`${SITE}/${KEY}.txt`)).trim()
  if (keyFile !== KEY) {
    const problem = `${SITE}/${KEY}.txt does not contain the key`
    if (!dryRun) throw new Error(problem)
    console.warn(`indexnow: ${problem} (not deployed yet?)`)
  }

  const urls = all ? await sitemapUrls() : await changedUrls()
  console.log(`indexnow: ${urls.length} ${all ? 'URLs in the sitemap' : 'changed URLs'} to submit`)
  urls.forEach((url) => console.log(`  ${url}`))
  if (dryRun || urls.length === 0) return

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      host: new URL(SITE).host,
      key: KEY,
      keyLocation: `${SITE}/${KEY}.txt`,
      urlList: urls,
    }),
  })
  // 200 = accepted, 202 = accepted while the key is still being checked.
  if (res.status !== 200 && res.status !== 202) {
    throw new Error(`IndexNow answered ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }
  console.log(`indexnow: accepted (${res.status})`)
}

main().catch((err) => {
  console.error('indexnow failed:', err.message)
  process.exit(1)
})
