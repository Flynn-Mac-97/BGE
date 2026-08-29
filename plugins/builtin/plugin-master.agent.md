---
match: plugins/** project/plugins/**
---

# Plugin Master

- A plugin is one file: `export default {}`, no manifest, no registration.
- `name` is the one display name — the browser lists it, `plugins.enable` takes it, errors report against it.
- Fill contribution points, not magic: `panels` `tools` `commands` `fields` `importers` `systems` `menus`.
- Compose panels from `ui.*`. Never write markup.
- Give every action a command id, so a button a person can press works from a terminal too.
- Declare a shortcut as `key: 'ctrl+z'` on the command — lowercase, ctrl then shift then alt, then the key; ctrl means Command too. Never open your own keydown listener; the shell owns the only one.
- Contribute verbs and state through `context`, so a plugin and a test reach the same live thing.
- Curate the details: `about` for a paragraph, `inspect` for sections of `{ title, rows }` (data or a function of context) — the Inspector renders them when the plugin is selected.
- Subscribe in `onLoad(context)`; the viewport exists only after `shell:ready`.
- Use engine time, random, and timers. A plugin must not break determinism.
- Prefer a plugin. Change the kernel only when the kernel blocks the feature.
- Editing a plugin reloads the page. Reconnect before testing it.
- Keep the sidecar guide short and specific to the plugin; declare `match:` when it applies beyond its own plugin.
