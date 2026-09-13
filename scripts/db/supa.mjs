// Thin wrapper around the Supabase CLI devDependency.
//
// WHY: the CLI resolves `env(NAME)` placeholders in supabase/config.toml from
// process.env (or a root `.env`), never from `.env.local`. All `db:*` npm scripts
// go through this file so `.env.local` and `supabase/.env` are loaded first, without
// overriding anything already exported in the shell (CI sets real env vars).
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

// Minimal KEY=VALUE parser so we do not need a dotenv dependency.
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '')
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (key && !(key in process.env)) process.env[key] = value
  }
}

loadEnvFile(path.join(root, '.env.local'))
loadEnvFile(path.join(root, 'supabase', '.env'))

// The npm package's bin is an ESM shim that picks the platform binary, so
// running it with the current Node avoids .cmd/.ps1 shell quirks on Windows.
const require = createRequire(import.meta.url)
const cli = require.resolve('supabase/dist/supabase.js')

const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
})
child.on('error', (err) => {
  console.error(`supa.mjs: failed to start the Supabase CLI: ${err.message}`)
  process.exit(1)
})
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 1)
})
