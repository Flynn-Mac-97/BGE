---
match: CLAUDE.md .claude/**
---

# Claude Code

What this engine needs to know about driving Claude Code, kept here so no
vendor name has to appear in engine code. Switch this guide off and the engine
loses nothing but these notes.

Checked against `claude` **v2.1.220** on 2026-08-29. Numbers and flag names go
stale — run `claude --help` before trusting an old line.

## The file it reads

Claude Code reads `CLAUDE.md` at the repository root. This project keeps one
line in it pointing at `AGENTS.md`, so the instructions live in one place:

```
See [AGENTS.md](AGENTS.md) — it is generated and always current.
```

`AGENTS.md` is generated from `agents/bootstrap.md`. `CLAUDE.md` is not
regenerated once it exists, so a hand-written one is never clobbered.

## One-shot use

`-p` / `--print` answers one task and exits. Without it the tool opens an
interactive session and an orchestrator will hang waiting for a prompt.

```sh
claude -p --output-format json "<task>"
```

These flags only work together with `--print`: `--output-format`,
`--input-format`, `--no-session-persistence`, `--max-budget-usd`,
`--fallback-model`, `--include-partial-messages`.

There is **no timeout flag and no working-directory flag**. A caller applies
both to the child process itself.

## Permission modes

`--permission-mode` takes exactly these words:

`acceptEdits` · `auto` · `bypassPermissions` · `manual` · `dontAsk` · `plan`

They are Claude Code's own vocabulary and they are not shared with other
agents — there is no `workspace-write` and no `read-only` here. The nearest
mode to "edit this workspace without asking" is `acceptEdits`.

## What it prints

`--output-format json` gives one object:

| key | what it is |
|---|---|
| `result` | the final message |
| `is_error` | whether the run failed |
| `session_id`, `uuid` | how to find the run again |
| `duration_ms`, `total_cost_usd` | what it took |
| `usage` | `input_tokens`, `output_tokens`, and the two cache counts |
| `stop_reason`, `modelUsage`, `permission_denials` | why it stopped, and what it was refused |

Unlike the DeepSeek Harness, Claude Code **does** report its own token counts
and cost. One trivial read-only task measured USD 0.094 and about two seconds.

## Spawning it on Windows

npm installs it as a `.cmd` shim. `spawn('claude')` answers `ENOENT` and
`spawn('claude.cmd')` throws `EINVAL`. Go through `cmd.exe /d /s /c` with
`windowsVerbatimArguments`, quoting the arguments yourself — `shell: true`
concatenates them unescaped, so a task containing `&` starts a second command.
