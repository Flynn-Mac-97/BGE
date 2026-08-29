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

## Size — the reader is an agent, and it pays per line

- The guide is the interface. It must answer "what is this for" and "how do I drive it" without opening the `.js`. Ten to twenty lines: what it owns, its commands, its keys, what it refuses.
- Keep a plugin under **400 lines**. Over that, finding one part of it costs more than the change is worth. `node bin/engine.mjs --headless run plugin.sizes` names every one that is over, and every one missing a guide.
- Split by what it owns, not by file length. `World Look` became Skybox, View 3D and Gizmo 3D because they were three jobs, and each is now readable on its own.
- Everything is a plugin, so splitting one costs nothing structural — a new file, a `name`, and `needs:` if it depends on another's `context` key.
- Big is not a bug to fix on sight. It is a signal the file holds more than one job. Split when you are already there for another reason.
