---
name: wrap-up
description: End a working session on the AUSSS site. Check the work, push it once, post the PR text drafted during the session, watch CI and the Vercel preview, record the session in memory, and stop the dev server last. Run only when the user types /wrap-up or asks to wrap up.
disable-model-invocation: true
argument-hint: "[keep-server]"
---

# Wrap up the session

Arguments: $ARGUMENTS (`keep-server` leaves the dev server on localhost:5173 running)

Two of the user's rules meet here. Nothing goes to GitHub during a session (the push guard,
`.claude/hooks/guard-push.mjs`, refuses it), and the dev server on localhost:5173 stays up until
the end (`.claude/hooks/guard-dev-server.mjs`). This skill is the end. Run the steps in order and
stop at the first one that fails: say what failed and leave the rest for the user to decide.

## 1. See what is there

- `git status --short`, the branch, and `git log --oneline @{u}..` (what will go up). Untracked
  files are not pushed; list any that look like work (not `.claude/` scratch, `dist/`,
  `.page-walk/`) and ask whether they belong in a commit.
- Uncommitted changes to tracked files: commit them now, with a message in the repository's
  style (see `git log`), ending with the attribution lines the session was given.
- Drafted PR text: look in the session's scratchpad for `pr*-body.md` and similar notes.

## 2. Check it

- `npm test` (Vitest).
- `npm run build` (the build plus the pre-render; it reads the live database and writes nothing).
- If a migration changed, say that pgTAP only runs in CI (no Docker here), so db-ci is the check.
Any failure: stop, report it, push nothing.

## 3. Push and post

- Tell the user in one line what is about to go up (branch, number of commits, PR edits).
- Lift the push guard for this run: create `.claude/.wrap-up` (an empty file; it expires after
  three hours on its own) in a command of its own. The guard checks before a command runs, so
  `touch .claude/.wrap-up && git push` in one command is still refused.
- `git push`. In Git Bash put `export PATH="$PATH:/c/Program Files/GitHub CLI"` first for `gh`.
- For each drafted PR text: refresh any figures in it that changed (test counts, the head
  commit), then `gh pr edit <number> --body-file <file>`. A new PR: `gh pr create` with the base
  the stack needs (`gh pr list` shows what is open), never `main` for a branch that sits on
  another PR.

## 4. Watch it land

- CI: `gh run list --branch <branch> --limit 6 --json databaseId,workflowName,status` for the
  pushed head, then `gh run watch <id> --exit-status` for db-ci and site-ci (in the background
  when there is other work, so the user is told when they finish).
- A db-ci job that is cancelled after about 15 minutes with zero steps is a GitHub runner
  outage, not a failure: prove it and re-run it (see memory "CI job with no runner").
- Vercel: the Vercel MCP `list_deployments` with `projectId: prj_oC0vYsoO4wBCcQZfDBVRJ1WeBF5T`
  and no `teamId` or `slug` (naming the team makes it refuse). The newest deployment for the
  head commit should reach `READY`; on `ERROR`, read its build log and report.
- Remove `.claude/.wrap-up` once nothing more is pushed.

## 5. Record the session

- Update the project memory: the plan entry (what was built, what is merged or waiting, what
  the user still owes), the website guide's log for anything a visitor or officer can see, and
  any new rule the user gave. Keep the MEMORY.md index lines short.
- Do not mark anything as live that is only on an unmerged branch.

## 6. Stop the dev server (last)

Unless the argument is `keep-server` or the user says otherwise: stop the dev server. If this
session started it as a background task, stop that task. Otherwise ask the user to press Ctrl+C
in its terminal; the dev-server guard refuses killing node by name, on purpose.

## 7. Report

A short message: what was pushed, the PR links, CI and Vercel results, what waits on the user
(merges, migrations that db-deploy applies at merge, account steps), and whether the dev server
is still running.
