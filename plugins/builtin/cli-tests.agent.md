---
match: test/**
description: Run the CLI-and-editor bridge suite, which drives the real CLI against a live editor tab and a real project on disk. Use when changing bin/engine.mjs, the dev server's API routes, hot reload, or anything an agent drives from a terminal.
category: core
---

# CLI Tests

- The suite is `test/cli.bridge.mjs`; run it with `node test/cli.bridge.mjs` or `npm test`.
- It needs a dev server and one open editor tab. It asks `/api/project` which directory that editor serves, and reads and restores files there — so it never edits a project the editor is not on.
- The project it runs against must hold a level named `level1`, because the suite reads `coin-2` and friends from it. Against any other project those checks fail for reasons that have nothing to do with the change under test (pain p282).
- It spawns the real CLI and writes real files, restoring what it touched. A bridge test, not proof of game correctness.
- The door itself is covered offline, with nothing running: `node --test test/cli.offline.test.mjs` — exit codes, argument coercion, the determinism lint, and the pain lifecycle (isolated via `ENGINE_PAIN_FILE`).
- The other offline half is `node --test test/agent-workspace.test.mjs`.
- `tests.cli` runs the suite from inside the editor and answers with the same pass and fail counts.
