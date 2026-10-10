// Claude Code PreToolUse hook for the Bash and PowerShell tools, registered in
// .claude/settings.json. It keeps the Vite dev server on localhost:5173 alive for the whole
// session: the user works in it between tasks and stops it only when wrapping up. It refuses
//   - a kill aimed at node, vite or the port by name (taskkill /IM node.exe, Stop-Process -Name
//     node, Get-Process node | Stop-Process, pkill node, npx kill-port 5173, lsof -ti:5173 |
//     xargs kill), which would also take down the MCP servers that run on node
//   - a kill by process id when the id is the process listening on 5173 or one of its parents
// and lets every other command through. The refusal reason goes back to Claude.
//
// Stopping the server at the end of a session: Claude stops its own background task for it, or
// the user presses Ctrl+C in the server's terminal.

import { execFileSync } from 'node:child_process'

const PORT = 5173

// A command word that ends processes, at the start of a statement or a pipeline stage.
const KILL_VERB = /(?:^|[\s|&;({])(?:taskkill|stop-process|spps|pkill|killall|kill-port|fkill|kill)(?:\.exe)?(?=\s|$)/i
const KILL_CALL = /\.kill\s*\(|\bwmic\b.*\b(?:delete|terminate)\b|\bInvoke-CimMethod\b.*\bTerminate\b/i
// node or node.exe as a word (not node_modules, node.js or a path segment), vite, or the port.
const TARGET = new RegExp(String.raw`\bnode(?:\.exe)?\b(?![-_.\/\\])|\bvite\b|(?<!\d)${PORT}(?!\d)`, 'i')
// What comes right before the script handed to a nested shell (bash -c, powershell -Command).
const NESTED_SHELL = /(?:^|\s)(?:-c|-command|-encodedcommand|\/c|\/k)\s*$/i

const SHELL_ESCAPE = { Bash: '\\', PowerShell: '`' }

const REASON =
  `Blocked by .claude/hooks/guard-dev-server.mjs: this would stop the dev server on localhost:${PORT} ` +
  '(or every node process, which includes the MCP servers). The user keeps that server running for ' +
  'the whole session and stops it only when wrapping up. If a process has to go, end it by its own ' +
  'process id. If the user has asked for the server to be stopped as part of wrapping up, stop your ' +
  'own background task for it, or ask them to press Ctrl+C in its terminal.'

let raw = ''
for await (const chunk of process.stdin) raw += chunk
let input
try {
  // Windows PowerShell puts a byte-order mark in front of text it pipes.
  input = JSON.parse(raw.replace(/^﻿/, ''))
} catch {
  process.exit(0)
}
const command = input?.tool_input?.command
if (typeof command !== 'string') process.exit(0)

const text = stripProse(command, SHELL_ESCAPE[input.tool_name] ?? '\\')
const statements = text.split(/\r?\n|;|&&|\|\|/).filter((s) => KILL_VERB.test(s) || KILL_CALL.test(s))
if (!statements.length) process.exit(0)

let protectedIds
for (const statement of statements) {
  const ids = (statement.match(/(?<![\w.-])\d+(?![\w.])/g) ?? []).map(Number)
  if (TARGET.test(statement)) deny()
  // Stop-Process $p, where $p was filled from Get-Process node earlier in the same command.
  if (!ids.length && /\$\w/.test(statement) && TARGET.test(text)) deny()
  if (ids.length) {
    protectedIds ??= serverProcessIds()
    if (ids.some((id) => protectedIds.has(id))) deny()
  }
}
process.exit(0)

function deny() {
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
}

// Drops text that is data rather than commands, so a commit message or a PR body that mentions
// taskkill does not trip the guard: here-doc bodies, PowerShell here-strings, and quoted strings
// with a space in them. A quoted script handed to a nested shell is kept, unquoted.
function stripProse(cmd, escape) {
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

// The process listening on the port and every process above it (the npm or shell that started
// it, and so on), since ending a parent with /T or -Tree ends the server too.
function serverProcessIds() {
  const keep = new Set()
  const listeners = listenerIds()
  if (!listeners.length) return keep
  const parents = parentIds()
  for (let id of listeners) {
    for (let depth = 0; id && !keep.has(id) && depth < 32; depth++) {
      keep.add(id)
      id = parents.get(id)
    }
  }
  return keep
}

function listenerIds() {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true, timeout: 5000 })
      const ids = new Set()
      for (const line of out.split(/\r?\n/)) {
        // TCP  [::1]:5173  [::]:0  LISTENING  1234. The state word is translated on
        // non-English Windows; a listening socket's foreign port is always 0.
        const f = line.trim().split(/\s+/)
        if (f[0] === 'TCP' && f[1]?.endsWith(`:${PORT}`) && /:0$/.test(f[2] ?? '')) ids.add(Number(f.at(-1)))
      }
      return [...ids]
    }
    const out = execFileSync('lsof', ['-nP', `-iTCP:${PORT}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8', timeout: 5000 })
    return out.split(/\s+/).filter(Boolean).map(Number)
  } catch {
    return []
  }
}

function parentIds() {
  const parents = new Map()
  try {
    const out =
      process.platform === 'win32'
        ? execFileSync(
            'powershell',
            [
              '-NoProfile',
              '-NonInteractive',
              '-Command',
              'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }',
            ],
            { encoding: 'utf8', windowsHide: true, timeout: 10000 },
          )
        : execFileSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8', timeout: 5000 })
    for (const line of out.split(/\r?\n/)) {
      const [id, parent] = line.trim().split(/\s+/).map(Number)
      if (id) parents.set(id, parent)
    }
  } catch {
    // Without the process table only the listener itself is protected.
  }
  return parents
}
