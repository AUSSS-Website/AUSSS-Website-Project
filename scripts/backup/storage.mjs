// Mirrors every Supabase Storage bucket into a local folder, for the nightly
// backup (.github/workflows/backup.yml, docs/RUNBOOK.md section 20).
//
//   node scripts/backup/storage.mjs <folder>
//
// Needs SUPABASE_URL and SUPABASE_SECRET_KEY (the sb_secret_... key: the
// receipts bucket is private and listing objects is not open to anon).
//
// The folder is kept between runs (the workflow caches it), so only objects
// that are new or changed since the last run are downloaded. That matters on
// the free plan, where everything read from Storage counts against 5 GB of
// egress a month. A file deleted from a bucket is deleted from the mirror
// too; the dated archives made from earlier runs still hold it.
//
// Layout: <folder>/<bucket>/<object path>, plus <folder>/manifest.json with
// each object's size, type and version tag (what a restore re-uploads from).
import fs from 'node:fs/promises'
import path from 'node:path'

const BASE = (process.env.SUPABASE_URL || '').replace(/\/$/, '')
const KEY = process.env.SUPABASE_SECRET_KEY || ''
const dest = process.argv[2]

if (!BASE || !KEY || !dest) {
  console.error('usage: SUPABASE_URL=... SUPABASE_SECRET_KEY=... node scripts/backup/storage.mjs <folder>')
  process.exit(1)
}

const PAGE = 1000
const PARALLEL = 6

async function api(pathname, init = {}) {
  const res = await fetch(`${BASE}/storage/v1/${pathname}`, {
    ...init,
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, ...(init.headers || {}) },
  })
  if (!res.ok) {
    throw new Error(`${init.method || 'GET'} ${pathname} answered ${res.status}: ${(await res.text()).slice(0, 200)}`)
  }
  return res
}

// Every object in a bucket, folders walked depth-first. The list endpoint
// returns folders as entries without an id.
async function listObjects(bucket, prefix = '') {
  const out = []
  for (let offset = 0; ; offset += PAGE) {
    const res = await api(`object/list/${bucket}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix, limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } }),
    })
    const rows = await res.json()
    for (const row of rows) {
      const full = prefix ? `${prefix}/${row.name}` : row.name
      if (row.id === null || row.id === undefined) {
        out.push(...(await listObjects(bucket, full)))
      } else {
        out.push({
          path: full,
          size: row.metadata?.size ?? null,
          type: row.metadata?.mimetype ?? null,
          tag: row.metadata?.eTag || row.updated_at || '',
        })
      }
    }
    if (rows.length < PAGE) return out
  }
}

// A bucket path can never climb out of the mirror folder.
function localPath(bucket, objectPath) {
  const root = path.resolve(dest, bucket)
  const file = path.resolve(root, ...objectPath.split('/'))
  if (!file.startsWith(root + path.sep)) throw new Error(`unsafe object path ${bucket}/${objectPath}`)
  return file
}

async function download(bucket, object) {
  const encoded = object.path.split('/').map(encodeURIComponent).join('/')
  const res = await api(`object/${bucket}/${encoded}`)
  const file = localPath(bucket, object.path)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, Buffer.from(await res.arrayBuffer()))
}

async function inBatches(items, worker) {
  const queue = [...items]
  await Promise.all(
    Array.from({ length: PARALLEL }, async () => {
      for (let item = queue.shift(); item; item = queue.shift()) await worker(item)
    }),
  )
}

async function readManifest(file) {
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

async function exists(file) {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

async function main() {
  await fs.mkdir(dest, { recursive: true })
  const manifestFile = path.join(dest, 'manifest.json')
  const before = await readManifest(manifestFile)
  const after = {}

  const buckets = await (await api('bucket')).json()
  let total = 0
  let fetched = 0
  let removed = 0

  for (const bucket of buckets) {
    const objects = await listObjects(bucket.id)
    const known = before[bucket.id]?.objects || {}
    const now = {}
    const wanted = []
    for (const object of objects) {
      now[object.path] = { size: object.size, type: object.type, tag: object.tag }
      const same = known[object.path]?.tag === object.tag && (await exists(localPath(bucket.id, object.path)))
      if (!same) wanted.push(object)
    }
    await inBatches(wanted, (object) => download(bucket.id, object))

    for (const gone of Object.keys(known).filter((p) => !(p in now))) {
      await fs.rm(localPath(bucket.id, gone), { force: true })
      removed += 1
    }

    after[bucket.id] = { public: Boolean(bucket.public), objects: now }
    total += objects.length
    fetched += wanted.length
    console.log(`storage backup: ${bucket.id}: ${objects.length} objects, ${wanted.length} downloaded`)
  }

  await fs.writeFile(manifestFile, JSON.stringify(after, null, 2))
  console.log(
    `storage backup: ${buckets.length} buckets, ${total} objects, ${fetched} downloaded, ${removed} removed from the mirror`,
  )
}

main().catch((err) => {
  console.error('storage backup failed:', err.message)
  process.exit(1)
})
