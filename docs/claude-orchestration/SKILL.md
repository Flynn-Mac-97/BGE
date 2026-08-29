---
name: dsh-orchestrator
description: Drive the local DeepSeek Harness (dsh) agent as a subagent. Use when you need to delegate a task to a second coding agent running on this machine — parallel work, an independent review, a long-running exploration, or work in a different directory. The dsh agent runs the DeepSeek v4 flash model with full workspace tool access (pwsh, file editing, web search, subagents) and returns a final message.
category: orchestration
risk: medium
source: local
date_added: '2026-09-01'
---

# dsh orchestrator — delegate tasks to the DeepSeek Harness agent

You can spawn the local DeepSeek Harness agent as a subagent through the
`dsh-agent` command. It is a one-shot agent: give it a task, it works until
quiescence (tools, edits, searches, its own subagents), then prints its final
message and exits.

## When to use

- The user asks you to orchestrate, parallelize, or delegate to the DeepSeek agent.
- A task is independent of your current context and would bloat it (large
  exploration, audit over many files, research).
- You want a second opinion or an independent implementation pass.
- Work must happen in a specific directory (`--cwd`).

## Command

```bash
dsh-agent [--json] [--cwd <dir>] [--timeout <seconds>] [--permission-mode <mode>] "task"
```

- `task` — the instruction, quoted. Keep it self-contained: the agent has no
  access to your conversation.
- `--json` — print a JSON envelope with `{ok, status, exitCode, text, error, sessionId, sessionDir, durationMs, task}` instead of raw text. Prefer this when you need to parse the result or check `ok`.
- `--cwd <dir>` — run in that directory (default: your current directory). The
  agent's sandbox root becomes that directory.
- `--timeout <seconds>` — kill the run after N seconds (exit 124).
- `--permission-mode <mode>` — `read-only` | `workspace-write` (default) | `danger-full-access`.
  Keep the default unless the task explicitly needs to touch files outside the
  workspace root; escalate deliberately, never by default.
- `--model <name>` — override the model (default: `deepseek-v4-flash`).

## Exit codes

| code | meaning |
|------|---------|
| 0    | task completed |
| 1    | agent error or unexpected failure |
| 2    | usage error |
| 124  | timed out |

## Workflow

1. Write a precise, self-contained task. Include file paths, acceptance
   criteria, and what the final message should report.
2. Run `dsh-agent --json "<task>"`.
3. Read `ok` and `text`. If `ok` is false, read `error` and either fix the
   task and re-run, or report the failure to the user.
4. The run is persisted as a session (`sessionId`/`sessionDir` under
   `$DSH_HOME/sessions`) — you can point the user there for the full log.

## Notes

- Each run is a fresh agent with no memory of your session: put all necessary
  context in the task.
- The agent shares the same `$DSH_HOME` settings and credentials as this
  harness (deepseek-official provider).
- Runs are sequential by default; you may start several in parallel yourself
  (e.g. background jobs) but remember each one is a separate process.
