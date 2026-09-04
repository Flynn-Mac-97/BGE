---
description: Which game the editor has open, and how to open, name or leave one. Use when starting a new game, switching between games, saving the untitled project under a name, or working out where a project lives on disk.
---

# Project Switcher

- A project is a directory anywhere on disk. `ENGINE_PROJECT=path npm run dev`
  for the editor, `--project path` for the CLI and `--headless`. The value is
  resolved against the checkout, so a bare name reaches a directory inside it —
  and no game lives there any more — while `../x` or an absolute path reaches
  one anywhere.
- Neither given opens the **untitled** project, at
  `<projects root>/.untitled`. The projects root is `../engine-projects` beside
  the checkout, or `ENGINE_PROJECTS_ROOT`.
- Unsaved means unnamed, not held in memory. The untitled project is a real
  directory and `project.saveAs <name>` renames it. There is no save button and
  no save-only copy: `engine/files.js` writes straight through.
- `project.list` — the project directories beside the open one.
- `project.open <name or path>` — repoints the dev server, then reloads the page.
  The reload is what drops the old project: a plugin cannot be un-loaded once
  its `onLoad` has run.
- `project.saveAs <name>` — one path segment, no leading dot, and refused if
  that directory exists. Writes the name as `game.json`'s title.
- `project.close` — opens a fresh untitled project, creating it if absent.
- `project.panel` — show or hide the panel.
- The page never learns where the project is. It fetches everything under the
  fixed URL `/project/`, which the dev server maps onto the served directory,
  and asks `GET /api/project` for the name to show.
- The untitled project is not watched for edits. Naming it is a rename, Windows
  refuses to rename a directory anything holds open, and the watcher does not
  let go in time. A named project is watched.
- The recent list is browser-local, like the dock sizes. It never enters a
  project file, and it is ordered by position — no clock is read.
