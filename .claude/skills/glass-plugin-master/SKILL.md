---
name: glass-plugin-master
description: How to write a plugin, and which folder it belongs in. Read this before adding any new capability: it decides whether the code is an engine builtin or a game's own plugin, and it sets the size, guide and naming rules every plugin is checked against.
---
<!-- generated from plugins/builtin/plugin-master.agent.md at server start; edits are lost -->

Read the generated interface in `plugins/builtin/plugin-master.agent/interface.generated.md`. Plugin edits refresh it while the server runs. This packet command also checks freshness:

```sh
node bin/engine.mjs agent.context '{"task":"…","files":["plugins/builtin/plugin-master.js"]}'
```

# Plugin Master

- A plugin is one file: `export default {}`, no manifest, no registration.
- `name` is the one display name — the browser lists it, `plugins.enable` takes it, errors report against it.
- Declare a category by purpose: `engine` (simulation), `visuals` (drawing),
  `game` (gameplay), `editor` (editing), or `agents` (agent tools).
- Fill contribution points, not magic: `panels` `tools` `commands` `fields` `importers` `systems` `menus`.
- Compose panels from `ui.*`. Never write markup.
- Give every action a command id, so a button a person can press works from a terminal too.
- Declare a shortcut as `key: 'ctrl+z'` on the command — lowercase, ctrl then shift then alt, then the key; ctrl means Command too. Never open your own keydown listener; the shell owns the only one.
- Expose verbs and state through `context`. Tests use `test.context`, never a
  module-level handle.
- `about` is optional: `plugin.facts` derives one from the code, and every surface
  falls back to it. `inspect` is sections of `{ title, rows }`.
- Subscribe in `onLoad(context)`; the viewport exists only after `shell:ready`.
- Use engine time, random, and timers. A plugin must not break determinism.
- Editing a plugin reloads the page. Reconnect before testing it.
- Declare `match:` on the guide when it applies beyond its own plugin.

## The guide

- Keep authored rules in the guide. Read the generated interface in
  `<plugin>.agent/interface.generated.md`; do not edit it. The server refreshes
  it on plugin edits. Packet creation checks source and generator hashes and
  refreshes stale files before including them.
- Check command arguments and declared schemas in the interface. Follow detail
  links for usage and limits. If an interface is unavailable or a declaration
  is dynamic, read the named source before calling the command.
- `<plugin>.agent.md` is the **prose**: what it owns, what it refuses, when to
  reach for it. Keep it under **3000 characters**.
- `<plugin>.agent/<topic>.md` holds the **detail**: argument tables, worked
  examples, edge cases, troubleshooting. One file per topic.
- End the guide with a `## Detail` index naming each file and what it answers, so
  an agent opens only the one its task needs.
- `plugin.sizes` names every guide over the limit.

## Detail

Read only the file your task needs.

- `plugins/builtin/plugin-master.agent/which-folder.md` — builtin or the game's own, and how to promote one
- `plugins/builtin/plugin-master.agent/size.md` — the size limits, and how to split a plugin that is over
- `plugins/builtin/plugin-master.agent/descriptions.md` — generated interfaces and descriptions
