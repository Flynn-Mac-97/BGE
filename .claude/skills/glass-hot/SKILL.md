---
name: glass-hot
description: Project file edits reach the running editor without a page reload. Use when an edit does not show up, when a broken file kept the last working version, or to re-import one type by hand.
---
<!-- generated from plugins/builtin/hot.agent.md at server start; edits are lost -->

Read the generated interface in `plugins/builtin/hot.agent/interface.generated.md`. Plugin edits refresh it while the server runs. This packet command also checks freshness:

```sh
node bin/engine.mjs agent.context '{"task":"…","files":["plugins/builtin/hot.js"]}'
```

# Live File Updates

- Write `project/types/coin.js` with ordinary file tools and the change is
  live, with the world still where it was: same entities, same positions, same
  selection. No page reload, so nothing you were about to inspect is lost.

| what changed | what happens |
|---|---|
| type | swapped in place; live entities move onto the new definition |
| behaviour | the same, and state in the behaviour's own bag survives |
| level | reloaded, but only the open one and only if nothing would be lost |
| test | the file index is refreshed; the next run picks it up |
| image, sound, model | the renderer forgets the file so it is fetched again |
| plugin | a full page reload — a plugin owns DOM and listeners |

- A plugin reload is announced first as `reload:before` on the bus. Listeners
  must be synchronous; the page goes on the next line. Anything keeping world
  state across reloads writes it down there.

## What it refuses, and says

- A level that is not the open one: `skipped: 'not the open level'`.
- A level while the world is simulated: `skipped: 'world is simulated — stop
  first'`. Reloading would throw away the run.
- A **broken file** is normal while writing one. The error is logged, the old
  definition keeps running, and the editor stays up.
- **Deleting** a project file reloads the page. That is Vite's behaviour, not
  this plugin's: it does not consult plugins on unlink. Editing, adding and
  breaking a file are all handled in place.

## Command

- `hot.reloadType <name>` — re-import one type from disk, for when a file
  changed outside the watcher.
