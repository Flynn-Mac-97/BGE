---
match: tools/dsh-agent* docs/claude-orchestration/**
---

# DeepSeek Harness

What this engine needs to know about driving the DeepSeek Harness, kept here so
no vendor name has to appear in engine code. Switch this guide off and the
engine loses nothing but these notes.

Checked against `dsh-agent` **v0.1.1-rc.2** on 2026-08-29.

## The wrapper

`tools/dsh-agent.mjs` in this repository wraps `dsh --profile headless`. It
boots a fresh persisted agent, submits one task, waits for quiescence, prints
the final message and exits. `docs/claude-orchestration/README.md` explains why
it exists.

```sh
dsh-agent [--json] [--cwd <dir>] [--timeout <seconds>]
          [--permission-mode <mode>] [--model <name>] "task"
```

`--timeout` is in **seconds** here, not milliseconds.

`--permission-mode` takes `read-only`, `workspace-write` (the default) or
`danger-full-access`. These are not the same words Claude Code uses; nothing
translates between the two vocabularies.

## What it prints

With `--json`, one envelope:

```
{ ok, status, exitCode, text, error, sessionId, sessionDir, durationMs, task }
```

Always pass `--json` and read that. Scraping the raw text breaks the moment the
wrapper changes.

Exit codes: **0** completed · **1** agent error · **2** usage error ·
**124** timed out.

## Reading a session log

Sessions persist to
`$DSH_HOME/sessions/<project>/session-<uuid>/session.jsonl.zstd`, keyed by the
working directory the run started in.

That file is **multi-frame zstd**. `zstdDecompressSync` returns only the first
frame — 167 bytes of header — which reads as a truncated file rather than an
error. Split on the frame magic `28 b5 2f fd` and decompress each frame:

```js
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const starts = []
for (let i = 0; i + 4 <= buffer.length; i++) {
  if (buffer.compare(MAGIC, 0, 4, i, i + 4) === 0) starts.push(i)
}
```

Record types include `turn/start`, `turn/end`, `step/start`, `step/end`,
`tool/call`, `tool/result` and `assistant/message`. A run's wall clock is the
gap between `turn/start` and `turn/end`; its effort is the count of
`tool/call`.

**No token counts are recorded anywhere in the log**, and the running agent
cannot see its own. Cost can only be measured in tool calls and wall clock.

Three observed runs, each writing one or two plugin files:

| task | wall clock | tool calls |
|---|---|---|
| a registry plugin | 486 s | 71 |
| a provider plugin | 294 s | 49 |
| a provider plugin | 365 s | 54 |

About two thirds of every run was reading and grepping before the first write.

## Two things that bite

It leaves a scratch directory beside itself while a task runs —
`tools/.dsh-agent.<pid>.<id>.tmpdir/`. Windows locks it, so a file watcher that
follows it dies with `EBUSY`. The dev server ignores dot-directories for this
reason.

Running two agents in parallel, both envelopes reported the **same**
`sessionId`, though two distinct sessions existed on disk. Trust `sessionDir`
on the filesystem over the envelope until that is fixed.

## Spawning it on Windows

npm installs it as a `.cmd` shim, so `spawn('dsh-agent')` answers `ENOENT`.
Same fix as any other npm shim: `cmd.exe /d /s /c` with
`windowsVerbatimArguments` and your own quoting.
