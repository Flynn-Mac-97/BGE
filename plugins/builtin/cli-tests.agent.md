---
match: test/**
---

# CLI Tests

- The suite is `test/cli.test.mjs`; run it with `node test/cli.test.mjs` or `npm test`.
- It needs a dev server, one open editor tab, and the editor on the demo level — `level1` — because the suite reads `coin-2` and friends from it.
- It spawns the real CLI and writes into `project/`, restoring what it touched. A bridge test, not proof of game correctness.
- The door itself is covered offline, with nothing running: `node --test test/cli.offline.test.mjs` — exit codes, argument coercion, the determinism lint, and the pain lifecycle (isolated via `ENGINE_PAIN_FILE`).
- The other offline half is `node --test test/agent-workspace.test.mjs`.
