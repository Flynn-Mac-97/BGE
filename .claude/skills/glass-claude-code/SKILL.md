---
name: glass-claude-code
description: Claude Code — What this project needs to drive `claude`, so no vendor name is in engine code. 220**, 2026-08-29. Run `claude --help` before trusting an old line.
---
<!-- generated from plugins/builtin/claude-code.agent.md at server start; edits are lost -->

# Claude Code

What this project needs to drive `claude`, so no vendor name is in engine
code. Checked against **v2.1.220**, 2026-08-29. Run `claude --help` before
trusting an old line.

## The file it reads

`CLAUDE.md` at the root, one line pointing at `AGENTS.md`. `AGENTS.md` is
generated from `agents/bootstrap.md`; `CLAUDE.md` is never regenerated, so a
hand-written one is safe.

## One-shot

```sh
claude -p --output-format json "<task>"
```

Without `-p` it opens an interactive session and an orchestrator hangs.

Only work with `--print`: `--output-format`, `--input-format`,
`--no-session-persistence`, `--max-budget-usd`, `--fallback-model`,
`--include-partial-messages`.

**No timeout flag. No cwd flag.** Apply both to the child process.

## Permission modes

`acceptEdits` · `auto` · `bypassPermissions` · `manual` · `dontAsk` · `plan`

Its own vocabulary — no `workspace-write`, no `read-only`, and nothing
translates to another tool's words. Nearest to "edit without asking" is
`acceptEdits`.

## Output

One JSON object: `result`, `is_error`, `session_id`, `uuid`, `duration_ms`,
`total_cost_usd`, `usage`, `stop_reason`, `modelUsage`, `permission_denials`.

`usage` carries `input_tokens`, `output_tokens` and two cache counts. It does
report its own tokens and cost, unlike the DeepSeek Harness. One trivial
read-only task measured USD 0.094, about 2 s.

## Windows

npm installs a `.cmd` shim. `spawn('claude')` gives ENOENT, `spawn('claude.cmd')`
throws EINVAL. Use `cmd.exe /d /s /c` with `windowsVerbatimArguments` and quote
the arguments yourself — `shell: true` concatenates unescaped, so a task
containing `&` starts a second command.
