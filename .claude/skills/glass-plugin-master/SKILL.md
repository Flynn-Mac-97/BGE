---
name: glass-plugin-master
description: How to write a plugin, and which folder it belongs in. Read this before adding any new capability: it decides whether the code is an engine builtin or a game's own plugin, and it sets the size, guide and naming rules every plugin is checked against.
---
<!-- generated from plugins/builtin/plugin-master.agent.md at server start; edits are lost -->

Read the generated interface in `plugins/builtin/plugin-master.agent/interface.generated.md`. Plugin edits refresh it while the server runs. This packet command also checks freshness:

```sh
node bin/engine.mjs agent.context '{"task":"…","files":["plugins/builtin/plugin-master.js"]}'
```

match: plugins/** project/plugins/**
description: How to write a plugin, and which folder it belongs in.
---

# Plugin Master

- A plugin is one file: `export default {}`, no manifest, no registration.
- `name` is the display name; `plugins.enable` and errors use it.
- One category: `engine`, `visuals`, `game`, `editor` or `agents`.
- Fill contribution points: `panels` `tools` `commands` `fields` `importers` `systems` `menus`.
- Compose panels from `ui.*`; never write markup.
- Give every action a command id; it works from a terminal too.
- Shortcut: `key: 'ctrl+z'` on the command; the shell owns keydown.
- Expose verbs and state through `context`; tests use `test.context`.
- Subscribe in `onLoad(context)`; the viewport exists after `shell:ready`.
- Keep the guide under 3000 characters; `plugin.sizes` names every guide over.

## Detail

- `plugins/builtin/plugin-master.agent/writing.md` â€” guide, about, determinism, reload
- `plugins/builtin/plugin-master.agent/which-folder.md` â€” builtin or the game's
- `plugins/builtin/plugin-master.agent/size.md` â€” limits and splitting
- `plugins/builtin/plugin-master.agent/descriptions.md` â€” generated interfaces
