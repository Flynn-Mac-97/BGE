---
name: glass-plugin-master
description: Plugin Master — A plugin is one file: `export default {}`, no manifest, no registration. `name` is the one display name — the browser lists it, `plugins.enable` takes it, errors report against it. ...
---
<!-- generated from plugins/builtin/plugin-master.agent.md at server start; edits are lost -->

# Plugin Master

- A plugin is one file: `export default {}`, no manifest, no registration.
- `name` is the one display name — the browser lists it, `plugins.enable` takes it, errors report against it.
- Fill contribution points, not magic: `panels` `tools` `commands` `fields` `importers` `systems` `menus`.
- Compose panels from `ui.*`. Never write markup.
- Give every action a command id, so a button a person can press works from a terminal too.
- Declare a shortcut as `key: 'ctrl+z'` on the command — lowercase, ctrl then shift then alt, then the key; ctrl means Command too. Never open your own keydown listener; the shell owns the only one.
- Contribute verbs and state through `context`, so a plugin and a test reach the same live thing. Never export a module-level handle for a test to import back — a test gets `test.context`, and a second handle is a second copy waiting to disagree.
- Curate the details: `about` for a paragraph, `inspect` for sections of `{ title, rows }` (data or a function of context) — the Inspector renders them when the plugin is selected.
- Subscribe in `onLoad(context)`; the viewport exists only after `shell:ready`.
- Use engine time, random, and timers. A plugin must not break determinism.
- Prefer a plugin. Change the kernel only when the kernel blocks the feature.
- Editing a plugin reloads the page. Reconnect before testing it.
- Keep the sidecar guide short and specific to the plugin; declare `match:` when it applies beyond its own plugin.

## Which folder — capability is the engine's, rules are the game's

Building a game and need something the engine does not have — a 2D trigger,
damage, a minimap, pathfinding? **Write it as a builtin, not as game code.** The
next game needs it too, and a capability written inside one game has to be found
and rebranded before anyone else can use it.

- `plugins/builtin/` — anything another game would want. `<project>/plugins/` — this game's rules.
- The test: *would a second game want this, and would you have to rename it first?* If yes, it is a builtin.
- **A project plugin SHOULD be game-branded.** Call it `Buy Menu`, `Bomb`, `Radar`; say bombsite, terrorist, headshot. It speaks its game's language, and stripping that out would make it worse. Only a builtin has to stay neutral.
- Do not promote a project plugin just because it sounds generic. `Damage` and `Bot Navigation` read generic and are full of one game's rules; the cost of pulling those apart is real and the benefit is not. Promote when a second game actually needs it.
- Check the known gaps in `docs/design.md` before writing. If it is listed there, it is engine work you happen to be doing from a game.
- Name it for what it does: `Damage`, `Trigger Volume`, `Minimap`. Never for the game.
- No game nouns in a builtin — no team, weapon, map or character names, and no number tuned to one game. Those come from the level or the type.
- Behaviour is the engine's, data is the game's. A builtin reads its numbers; it does not hold them.
- Writing the game's name inside a builtin means one of two things: wrong folder, or a game-specific part that has to come out as configuration.
- Promoting a project plugin: move the `.js` and its `.agent.md`, strip the game nouns, turn its constants into properties, and leave the game's own tuning behind in the project.

## Size — the reader is an agent, and it pays per line

- The guide is the interface. It must answer "what is this for" and "how do I drive it" without opening the `.js`. Ten to twenty lines: what it owns, its commands, its keys, what it refuses.
- Keep a plugin under **400 lines**. Over that, finding one part of it costs more than the change is worth.
- `node bin/engine.mjs --headless run plugin.sizes` names every plugin that is over, every one missing a guide, and every builtin whose **code** mentions the game's own title. Comments may name the game; code naming it means it is in the wrong folder.
- Split by what it owns, not by file length. `World Look` became Skybox, View 3D and Gizmo 3D because they were three jobs, and each is now readable on its own.
- Everything is a plugin, so splitting one costs nothing structural — a new file, a `name`, and `needs:` if it depends on another's `context` key.
- Big is not a bug to fix on sight. It is a signal the file holds more than one job. Split when you are already there for another reason.
