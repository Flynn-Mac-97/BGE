---
match: plugins/** project/plugins/**
description: How to write a plugin, and which folder it belongs in. Read this before adding any new capability: it decides whether the code is an engine builtin or a game's own plugin, and it sets the size, guide and naming rules every plugin is checked against.
category: core
---

# Plugin Master

- A plugin is one file: `export default {}`, no manifest, no registration.
- `name` is the display name; `plugins.enable` and errors use it.
- One folder category: `engine`, `visuals`, `game`, `editor` or `agents`.
- One skill category: `core`, `engine`, `gameplay`, `presentation`, `assets`, `authoring` or `harnesses`. `core` is listed for every agent; the rest register only where the checkout switches them on, so declare one and `check` stays quiet.
- Fill contribution points: `panels` `tools` `commands` `fields` `importers` `systems` `menus`.
- Compose panels from `ui.*`; never write markup. The kit is `engine/ui.js`:
  `stack` `row` `section` `fold` for layout; `text` `label` `meta` for words;
  `field` `select` (a labelled dropdown) `toggle` `slider` `textarea`
  `search` for input; `button` (`primary`, `small`, `confirm: 'Delete?'` for
  a two-click action); `list` `grid` `card` (a grid cell with a picture,
  title and action buttons) `tree`; `thumb` `preview` `picture` for images.
  A widget the kit lacks goes into the kit, not into a plugin.
- Give every action a command id; it works from a terminal too.
- `expandable: true` on a panel adds Expand to its header: it is drawn over the whole editor and its render gets `context.isExpanded`.
- Shortcut: `key: 'ctrl+z'` on the command; the shell owns keydown.
- Expose verbs and state through `context`; tests use `test.context`.
- Subscribe in `onLoad(context)`; the viewport exists after `shell:ready`.
- Keep the guide under 3000 characters; `plugin.sizes` names every guide over.

## Detail

- `plugins/builtin/plugin-master.agent/writing.md` — guide, about, determinism, reload
- `plugins/builtin/plugin-master.agent/which-folder.md` — builtin or the game's
- `plugins/builtin/plugin-master.agent/size.md` — limits and splitting
- `plugins/builtin/plugin-master.agent/descriptions.md` — generated interfaces
