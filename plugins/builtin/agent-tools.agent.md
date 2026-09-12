---
description: The shelf of generator tools under tools/ and the shared helpers in tools/lib/. Use before writing any script that makes sprites, sounds, textures, motion clips or other assets, and when you need a helper such as seeded random, noise, colour, or PNG and WAV encoding.
match: tools/**
---

# Agent Tools

- `tools/` is the shelf: one file per job, run with `node tools/<file>`.
- `tools/lib/` is the machinery they share — import it, and **add to it**.
- **Run `tools.list` before writing a generator.** It reads the directory, so it
  cannot go stale: every tool, whether it exports `main()`, what each one makes,
  and every export `tools/lib/` already offers.
  `node bin/engine.mjs --headless run tools.list`
- Run a wrapped tool through the engine: `node bin/engine.mjs --headless run tools.make <name>`.

## Improving a tool is the job, not a liberty

- A tool is yours to change. If it nearly does what you need, extend it rather
  than writing a second one beside it.
- **Anything reusable goes in `tools/lib/`.** Wrapping noise, a colour operation,
  an encoder, a seam check — if a second generator would want it, it belongs
  there and not inside one game's file. Two copies of the same helper drift, and
  a fix lands in only one of them.
- Extract when you copy the second time, not the third.
- Add the leading `/** … */` — its first sentence is what `tools.list` shows.
  A file nobody described costs its whole length to understand, and `tools.list`
  names the ones missing it.
- **Prove a change by its output**, not its diff: regenerate and compare bytes.
  A generator is seeded and reads no clock, so same input means same file.

## Writing a new one

- One file in `tools/`, named `make-<game>-<thing>.mjs` for a game's assets.
- The machinery is the engine's, the art direction is the game's — same split as
  plugins. See `agents/tooling.md`.
- Export `main()` if it should be runnable as an engine command.
- Seed from a name. Never `Date.now`, never `Math.random` without a seed.
