---
name: glass-deepseek-harness
description: DeepSeek Harness — What this project needs to drive `dsh-agent`, so no vendor name is in engine code. Checked against **v0.1.1-rc.2**, 2026-08-29.
---
<!-- generated from plugins/builtin/deepseek-harness.agent.md at server start; edits are lost -->

# DeepSeek Harness

What this project needs to drive `dsh-agent`, so no vendor name is in engine
code. Checked against **v0.1.1-rc.2**, 2026-08-29.

## The wrapper

`tools/dsh-agent.mjs` wraps `dsh --profile headless`: one task, final message to
stdout, exit. Notes in `docs/claude-orchestration/README.md`.

```sh
dsh-agent --json [--cwd <dir>] [--timeout <seconds>] [--permission-mode <mode>] [--model <name>] "task"
```

`--timeout` is **seconds** here. Permission modes: `read-only`,
`workspace-write` (default), `danger-full-access` — not Claude Code's words,
and nothing translates between them.

Always `--json`. Scraping raw text breaks when the wrapper changes.

```
{ ok, status, exitCode, text, error, sessionId, sessionDir, durationMs, task }
```

Exit: **0** completed · **1** agent error · **2** usage error · **124** timed out.

## Reading a session log

`$DSH_HOME/sessions/<project>/session-<uuid>/session.jsonl.zstd`, keyed by the
cwd the run started in.

**Multi-frame zstd.** `zstdDecompressSync` returns only the first frame — 167
bytes of header, which reads as a truncated file rather than an error. Split on
the frame magic `28 b5 2f fd` and decompress each frame.

Records: `turn/start`, `turn/end`, `step/start`, `step/end`, `tool/call`,
`tool/result`, `assistant/message`. Wall clock is `turn/end` minus `turn/start`;
effort is the count of `tool/call`.

**No token counts anywhere in the log**, and the running agent cannot see its
own. Cost measures as tool calls and wall clock only.

| run | wall clock | tool calls |
|---|---|---|
| a registry plugin | 486 s | 71 |
| a provider plugin | 294 s | 49 |
| a provider plugin | 365 s | 54 |

About two thirds of each run was reading before the first write.

## Two that bite

Leaves `tools/.dsh-agent.<pid>.<id>.tmpdir/` while running. Windows locks it, so
a watcher following it dies with EBUSY — the dev server ignores dot-directories
for this reason.

Two parallel runs reported the **same** `sessionId` though two sessions existed
on disk. Trust `sessionDir` over the envelope.

## Windows

npm installs a `.cmd` shim, so `spawn('dsh-agent')` gives ENOENT. Same fix as
any npm shim: `cmd.exe /d /s /c`, `windowsVerbatimArguments`, own quoting.
