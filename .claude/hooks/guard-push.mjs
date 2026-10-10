// Claude Code PreToolUse hook for the Bash and PowerShell tools and the GitHub MCP tools,
// registered in .claude/settings.json. The user's rule (2026-10-08): nothing goes to GitHub
// until the session is wrapped up. Work is committed locally as it goes, and /wrap-up pushes it
// once at the end. Until then this refuses:
//   - git push, however it is spelled (git -C <dir> push, git push --force, ...)
//   - gh commands that write: pr create/edit/merge/comment/close/reopen/ready/review, issue
//     create/edit/comment/close, release create/edit/delete, repo edit, workflow run, run rerun
//     and run cancel, and gh api with a writing method or with fields (which make it a POST)
//   - the GitHub MCP tools that write (create_*, update_*, merge_*, push_files, add_*, fork_*)
// Reading (git fetch, gh pr view, gh run list or watch, gh api GET) passes.
//
// /wrap-up lifts the rule for itself by creating .claude/.wrap-up, and removes the file when it
// is done. A marker older than three hours counts as left behind and lifts nothing.

import fs from 'node:fs'
import path from 'node:path'

const MARKER_MAX_AGE_MS = 3 * 60 * 60 * 1000

const GIT_PUSH = /(?:^|[\s|&;({])git(?:\.exe)?(?:\s+(?:-C|-c)\s+\S+|\s+--?[\w-]+(?:=\S+)?)*\s+push\b/i
const GH_WRITE = new RegExp(
  String.raw`(?:^|[\s|&;({])gh(?:\.exe)?\s+(?:` +
    String.raw`pr\s+(?:create|edit|merge|comment|close|reopen|ready|review)` +
    String.raw`|issue\s+(?:create|edit|comment|close|reopen|delete)` +
    String.raw`|release\s+(?:create|edit|delete|upload)` +
    String.raw`|repo\s+(?:edit|delete|rename|archive)` +
    String.raw`|workflow\s+(?:run|enable|disable)` +
    String.raw`|run\s+(?:rerun|cancel|delete)` +
    String.raw`)\b`,
  'i',
)
const GH_API = /(?:^|[\s|&;({])gh(?:\.exe)?\s+api\b/i
const GH_API_WRITES = /\s(?:-X|--method)\s*=?\s*(?:POST|PATCH|PUT|DELETE)\b|\s(?:-f|-F|--field|--raw-field|--input)\b/i
const MCP_GITHUB_WRITE = /^mcp__.*github.*__(?:create_|update_|merge_|push_|add_|fork_|delete_)/i

const SHELL_ESCAPE = { Bash: '\\', PowerShell: '`' }

const REASON =
  'Blocked by .claude/hooks/guard-push.mjs: the user asked that nothing goes to GitHub until the ' +
  'session is wrapped up (no git push, no PR or issue edits, no workflow reruns). Commit locally ' +
  'and carry on; keep any PR text in a local file. Everything goes up together when the user ' +
  'runs /wrap-up.'

let raw = ''
for await (const chunk of process.stdin) raw += chunk
let input
try {
  // Windows PowerShell puts a byte-order mark in front of text it pipes.
  input = JSON.parse(raw.replace(/^﻿/, ''))
} catch {
  process.exit(0)
}

const tool = String(input?.tool_name ?? '')
let blocked = false
if (MCP_GITHUB_WRITE.test(tool)) {
  blocked = true
} else {
  const command = input?.tool_input?.command
  if (typeof command !== 'string') process.exit(0)
  const text = stripProse(command, SHELL_ESCAPE[tool] ?? '\\')
  for (const statement of text.split(/\r?\n|;|&&|\|\|/)) {
    if (GIT_PUSH.test(statement) || GH_WRITE.test(statement)) blocked = true
    if (GH_API.test(statement) && GH_API_WRITES.test(` ${statement}`)) blocked = true
  }
}
if (!blocked || wrappingUp()) process.exit(0)

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: REASON,
    },
  }),
)
process.exit(0)

// /wrap-up is running: its marker exists and is fresh.
function wrappingUp() {
  const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd()
  try {
    const stat = fs.statSync(path.join(root, '.claude', '.wrap-up'))
    return Date.now() - stat.mtimeMs < MARKER_MAX_AGE_MS
  } catch {
    return false
  }
}

// Drops text that is data rather than commands, so a commit message or a PR body that mentions
// git push does not trip the guard: here-doc bodies, PowerShell here-strings, and quoted strings
// with a space in them. (The same rule as guard-dev-server.mjs.) A quoted script handed to a
// nested shell is kept, unquoted.
function stripProse(cmd, escape) {
  const NESTED_SHELL = /(?:^|\s)(?:-c|-command|-encodedcommand|\/c|\/k)\s*$/i
  const withoutBlocks = cmd
    .replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n[ \t]*\2[ \t]*(?=\r?\n|$)/g, ' ')
    .replace(/@(['"])\r?\n[\s\S]*?\r?\n\1@/g, ' ')
  let out = ''
  for (let i = 0; i < withoutBlocks.length; ) {
    const ch = withoutBlocks[i]
    if (ch !== '"' && ch !== "'") {
      out += ch
      i++
      continue
    }
    let j = i + 1
    while (j < withoutBlocks.length && withoutBlocks[j] !== ch) {
      j += ch === '"' && withoutBlocks[j] === escape ? 2 : 1
    }
    const body = withoutBlocks.slice(i + 1, j)
    out += !/\s/.test(body) || NESTED_SHELL.test(out) ? ` ${body} ` : ' '
    i = j + 1
  }
  return out
}
