---
match: tools/**
---

# Agent Tools

- `tools/` is the agent tooling shelf. Check `tools.list` before writing a new script — tooling written once stays here so nobody regenerates it.
- Each tool exports `main()` and runs standalone (`node tools/<file>`); regeneration is byte-identical (seeded, no wall time).
- Run a wrapped tool through the engine: `node bin/engine.mjs --headless run tools.make <name>`.
- Add tooling as one file in `tools/` that exports `main()`, then add a row to the shelf in `plugins/builtin/agent-tools.js`.
