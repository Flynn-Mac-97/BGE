---
match: bin/**
---

# CLI Surface

- `cli.surface` lists every CLI access point and its purpose: the kernel surface, the offline ops, the flags, and every plugin command.
- The kernel and offline entries are curated here and kept in step with `bin/engine.mjs help`; the plugin commands are read live from the loader, so a new verb appears the moment its plugin loads.
- Any command id also works as a verb: `node bin/engine.mjs <id>` — and every verb is inspectable through this one call.
