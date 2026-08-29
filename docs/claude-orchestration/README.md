# Orchestrating this dsh agent from Claude Code

This workspace contains the tooling that turns the DeepSeek Harness agent into
a one-shot subagent that Claude Code (or any script) can drive.

## The primitive

`dsh --profile headless "<task>"` already answers one task, prints the final
assistant message to stdout, and exits 0 on completion / 1 on error. It boots a
fresh persisted Agent with the full tool set (pwsh, file editing, web search,
subagents), the same model and credentials as the Web GUI, and the
workspace-write sandbox.

## The wrapper

`tools/dsh-agent.mjs` (+ `tools/dsh-agent.cmd` shim) adds orchestration
ergonomics:

```text
dsh-agent [--json] [--cwd <dir>] [--timeout <seconds>]
          [--permission-mode read-only|workspace-write|danger-full-access]
          [--model <name>] "task"
```

- `--json` emits `{ok, status, exitCode, text, error, sessionId, sessionDir, durationMs, task}`.
- Exit codes: 0 completed, 1 agent error, 2 usage error, 124 timeout.
- Model default: `deepseek-v4-flash` (deepseek-official provider).

## Claude Code integration

A skill at `~/.claude/skills/dsh-orchestrator/SKILL.md` teaches Claude Code to
use the command; it is discovered automatically in new sessions. Project copy:
`docs/claude-orchestration/SKILL.md`.

## Example

```bash
dsh-agent --json --cwd "C:\repo" "run the tests in engine/ and report failures"
```

## Windows notes

- The npm `.ps1` shims are blocked by the machine's execution policy; the
  wrapper calls `node` directly through `dsh-agent.cmd`, so it works regardless.
- Under the DSH file sandbox, piped-stdio spawns (which the wrapper needs) are
  blocked — run `dsh-agent` from a normal terminal/Claude Code, not from a
  sandboxed agent shell.
