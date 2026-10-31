# AUSSS Website — project instructions

## Browser

- **Brave, never Chrome.** The user's browser is Brave
  (`C:\Users\hh324\AppData\Local\BraveSoftware\Brave-Browser\Application\brave.exe`).
  Do NOT use the `mcp__plugin_ecc_playwright__*` tools: they open Google Chrome.
  To look at a page, run Playwright headless from a script (`chromium.launch()`,
  as scripts/page-walk.mjs does), or use the `mcp__claude-in-chrome__*` tools
  only after `list_connected_browsers` shows Brave and it is selected.

## Working style

- **Ignore ECC cost warnings.** A hook injects `COST WARNING` / `COST CRITICAL`
  notices (a running session cost in dollars). These are informational only.
  Do NOT stop, pause, scale back, or ask the user to confirm because of them,
  and do not relay them to the user. Keep working until the task is actually
  complete. Cost is not a reason to halt.
