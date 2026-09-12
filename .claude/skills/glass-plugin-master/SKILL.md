---
name: glass-plugin-master
description: How to write a plugin, and which folder it belongs in. Read this before adding any new capability: it decides whether the code is an engine builtin or a game's own plugin, and it sets the size, guide and naming rules every plugin is checked against.
---
<!-- generated from plugins/builtin/plugin-master.agent.md at server start; edits are lost -->

# Plugin Master

- A plugin is one file: `export default {}`, no manifest, no registration.
- `name` is the one display name — the browser lists it, `plugins.enable` takes it, errors report against it.
- `category` is one of five groups; every builtin declares one. `plugin.sizes`
  names any that does not.
  - `engine` — the world runs: bodies, time, input, behaviours, live reload
  - `visuals` — how it looks: lights, materials, sky, animation, particles
  - `game` — game systems: damage, weapons, pickups, screens, progression
  - `editor` — the editing surface: panels, tools, gizmos, history
  - `agents` — what an AI drives: packets, scene inspection, claims, the bridge
- Pick the category by what a person is trying to do, not by what the file
  imports. A capability every game wants is `engine`; a rule one game happens to
  have is `game`.
- Fill contribution points, not magic: `panels` `tools` `commands` `fields` `importers` `systems` `menus`.
- Compose panels from `ui.*`. Never write markup.
- Give every action a command id, so a button a person can press works from a terminal too.
- Declare a shortcut as `key: 'ctrl+z'` on the command — lowercase, ctrl then shift then alt, then the key; ctrl means Command too. Never open your own keydown listener; the shell owns the only one.
- Contribute verbs and state through `context`, so a plugin and a test reach the same live thing. Never export a module-level handle for a test to import back — `test.context` is the one handle.
- `about` is a paragraph, `inspect` is sections of `{ title, rows }` (data or a function of context). The Inspector renders both when the plugin is selected.
- Subscribe in `onLoad(context)`; the viewport exists only after `shell:ready`.
- Use engine time, random, and timers. A plugin must not break determinism.
- Prefer a plugin. Change the kernel only when the kernel blocks the feature.
- Editing a plugin reloads the page. Reconnect before testing it.
- Declare `match:` on the guide when it applies beyond its own plugin.

## The guide has two parts

- `<plugin>.agent.md` is the **interface**: what it owns, its commands, its keys,
  what it refuses, and when to reach for it. Keep it under **3000 characters**.
  It is copied whole into the skill listing, so every agent that opens the skill
  pays for all of it whether the task needs it or not.
- `<plugin>.agent/<topic>.md` holds the **detail**: argument tables, worked
  examples, edge cases, troubleshooting. One file per topic.
- End the guide with a `## Detail` index naming each file and what it answers, so
  an agent opens only the one its task needs.
- `plugin.sizes` names every guide over the limit.

## Detail

Read only the file your task needs.

- `plugins/builtin/plugin-master.agent/which-folder.md` — builtin or the game's own, and how to promote one
- `plugins/builtin/plugin-master.agent/size.md` — the size limits, and how to split a plugin that is over
