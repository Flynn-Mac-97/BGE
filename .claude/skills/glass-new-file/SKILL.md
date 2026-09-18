---
name: glass-new-file
description: Creates a project file of a known kind — type, behaviour, level, test or plugin — with a template that shows the whole shape. Use to start a new file from the editor or a terminal so it appears in the project tree at once.
---
<!-- generated from plugins/builtin/new-file.agent.md at server start; edits are lost -->

Read the generated interface in `plugins/builtin/new-file.agent/interface.generated.md`. Plugin edits refresh it while the server runs. This packet command also checks freshness:

```sh
node bin/engine.mjs agent.context '{"task":"…","files":["plugins/builtin/new-file.js"]}'
```

# New File

- Five kinds, each with a fixed folder and extension:

| kind | written to |
|---|---|
| `type` | `types/<name>.js` |
| `behaviour` | `behaviours/<name>.js` |
| `level` | `levels/<name>.json` |
| `test` | `tests/<name>.js` |
| `plugin` | `plugins/<name>.js` |

- The **templates** are the point. A new type shows the whole shape — the four
  hooks, commented, and the three description fields — so the first file
  someone opens teaches what a type is.
- The name is slugged to what an import can hold: lower case, digits, hyphens.
  Spaces and underscores become hyphens, everything else is dropped.
- After writing, the file index is refreshed and a `.js` file is opened in the
  editor, because reading what you just made is the next thing you want.

## What it refuses

- **A name that slugs to nothing** throws `needs a name`.
- **A path that already exists** throws `<path> already exists`. Nothing in
  this engine overwrites a file. Checked against disk rather than the index,
  because a plugin has no index entry.

The panel shows a refusal in place and the command throws. Same function, so
neither caller has to guess whether it worked.

## Command

- `new.file '["type", "enemy"]'` — write it now and return `{ created: path }`.
- `new.file type` — no name given, so the New panel opens instead of guessing
  one. Returns `{ opened, kind }`.

## Panel

Docked left, titled **New**, and only visible while a creation is in progress.
It offers the kind, the name, the path it will write, and any refusal.
