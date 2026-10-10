// Claude Code PostToolUse hook for the Edit and Write tools, registered in .claude/settings.json.
// After a JavaScript file under src/ changes, it runs the unit tests that import it, directly or
// through other files (vitest related, about a second here). Passing tests say nothing; failing
// ones are handed back to Claude with the failure, so a broken helper is caught at the edit and
// not at the next full test run. Files with no tests that reach them pass silently.

import { spawnSync } from 'node:child_process'
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
const abs = path.resolve(root, file)
const rel = path.relative(root, abs).split(path.sep).join('/')
if (!/^src\/.+\.(?:js|jsx|mjs)$/i.test(rel)) process.exit(0)

const vitest = path.join(root, 'node_modules', 'vitest', 'vitest.mjs')
const run = spawnSync(process.execPath, [vitest, 'related', abs, '--run', '--passWithNoTests', '--reporter=dot'], {
  cwd: root,
  encoding: 'utf8',
  timeout: 90000,
  windowsHide: true,
  env: { ...process.env, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' },
})
if (run.status === 0) process.exit(0)

// Keep the part that says what failed; the full log would flood the conversation.
const out = `${run.stdout || ''}\n${run.stderr || ''}`.replace(/\x1b\[[0-9;]*m/g, '')
const lines = out.split(/\r?\n/)
const start = lines.findIndex((l) => /FAIL|Failed Tests|AssertionError|Error:/.test(l))
const excerpt = lines
  .slice(Math.max(0, start), Math.max(0, start) + 40)
  .join('\n')
  .trim()

process.stdout.write(
  JSON.stringify({
    decision: 'block',
    reason:
      `The unit tests related to ${rel} fail after this edit (vitest related, run by ` +
      `.claude/hooks/test-related.mjs). Fix the code or, if the test was wrong, the test:\n\n` +
      (excerpt || out.slice(-3000)),
  }),
)
process.exit(0)
