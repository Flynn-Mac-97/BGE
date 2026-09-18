---
name: glass-agent-contracts
description: Discover live plugin dependencies, service owners, execution schedules, and command argument schemas. Use before extending a plugin, diagnosing a missing capability, or guessing command arguments.
---
<!-- generated from plugins/builtin/agent-contracts.agent.md at server start; edits are lost -->

Read the generated interface in `plugins/builtin/agent-contracts.agent/interface.generated.md`. Plugin edits refresh it while the server runs. This packet command also checks freshness:

```sh
node bin/engine.mjs agent.context '{"task":"…","files":["plugins/builtin/agent-contracts.js"]}'
```

# Agent Contracts

- `agent.commands` finds commands with their input schemas; `undeclared` means no schema exists.
- Both accept `{query, plugin, offset, limit}`; plugin is an exact display name, query is a substring, limit is 1–50 (default 20).
- Follow `nextOffset` to read more. A null nextOffset means the list is complete.
- Example: `node bin/engine.mjs --headless run agent.commands '{"query":"profile"}'`.
- `scheduleError` blocks system execution until invalid ordering is corrected. Panels and diagnostics remain available.
- `lifecycle: scoped` plugins own resources through the second `onLoad(context, scope)` argument: `on`, `defer`, `provide`, `require`.
- Declare `provides` and `requires` service names. Declare plugin dependencies in `needs`.
- System `id`, `before` and `after` define same-phase order. `reads` and `writes` document data access; they do not sandbox JavaScript.
- Legacy plugins remain supported; direct context assignments and subscriptions have no automatic cleanup guarantee.
