// Claude Code PreToolUse hook for the Edit and Write tools, registered in .claude/settings.json.
// It protects migrations that may already be applied to the hosted database. Editing one changes
// nothing there (the migration history says it ran) but leaves the repository disagreeing with
// production, and every fresh-database run in CI then builds a schema production never had.
//   - on main: db-deploy has applied it, so the edit is refused and Claude is told to write a
//     new migration
//   - committed or staged but not on main: it may have gone live through the Supabase MCP, so
//     the user is asked. /ship-migration renames an applied file with `git mv`, which stages it,
//     so a file applied a minute ago is caught here too
//   - a file git does not know yet (a draft) passes

import { execFileSync } from 'node:child_process'
import path from 'node:path'

let raw = ''
for await (const chunk of process.stdin) raw += chunk
let input
try {
  // Windows PowerShell puts a byte-order mark in front of text it pipes.
  input = JSON.parse(raw.replace(/^﻿/, ''))
} catch {
  process.exit(0)
}
const file = input?.tool_input?.file_path
if (typeof file !== 'string') process.exit(0)

const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd()
const rel = path.relative(root, path.resolve(root, file)).split(path.sep).join('/')
if (!/^supabase\/migrations\/[^/]+\.sql$/i.test(rel)) process.exit(0)

if (['origin/main', 'main'].some((ref) => git('cat-file', '-e', `${ref}:${rel}`))) {
  decide(
    'deny',
    `Blocked by .claude/hooks/guard-migrations.mjs: ${rel} is on main, so db-deploy has applied it ` +
      'to the live database. Editing it would not change the database and would leave the ' +
      'repository disagreeing with it. Put the change in a new migration (npm run db:new -- <name>).',
  )
}
if (git('ls-files', '--error-unmatch', '--', rel)) {
  decide(
    'ask',
    `${rel} is already committed or staged, so it may have been applied to the live database. ` +
      'Approve only if it has not been applied yet; otherwise the change belongs in a new migration.',
  )
}
process.exit(0)

function git(...args) {
  try {
    execFileSync('git', args, { cwd: root, stdio: 'ignore', windowsHide: true, timeout: 5000 })
    return true
  } catch {
    return false
  }
}

function decide(permissionDecision, permissionDecisionReason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision, permissionDecisionReason },
    }),
  )
  process.exit(0)
}
