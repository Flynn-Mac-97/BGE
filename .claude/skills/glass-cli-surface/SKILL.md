---
name: glass-cli-surface
description: Lists every CLI access point: kernel verbs, offline ops, flags, the work lock's refusals, and every plugin command. Use to discover what node bin/engine.mjs can do, to check a verb exists before calling it, and when adding or changing a verb.
---
<!-- generated from plugins/builtin/cli-surface.agent.md at server start; edits are lost -->

# CLI Surface

- `cli.surface` lists every CLI access point and its purpose: the kernel surface, the offline ops, the flags, the work lock's refusals, and every plugin command.
- The kernel, offline, flag and refusal entries are curated here and kept in step with `bin/engine.mjs help`; the plugin commands are read live from the loader, so a new verb appears the moment its plugin loads.
- Any command id also works as a verb: `node bin/engine.mjs <id>` — and every verb is inspectable through this one call.
- `refusals` says what the checkout refuses and where. No verb sets the lock, so an agent cannot find it in the command list.
- Change a verb's shape — a new flag, a renamed reply field, a new refusal — and update this plugin in the same edit.
