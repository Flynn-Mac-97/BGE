---
name: glass-project
description: Project Switcher — Says which project directory is open, and closes one by reloading the page. The project is a start-up parameter: `ENGINE_PROJECT=name npm run dev` for the editor, `--project name...
---
<!-- generated from plugins/builtin/project.agent.md at server start; edits are lost -->

# Project Switcher

- Says which project directory is open, and closes one by reloading the page.
- The project is a start-up parameter: `ENGINE_PROJECT=name npm run dev` for the
  editor, `--project name` for `--headless`. It must be a directory inside the
  checkout.
- `project.close` reloads. That is what closing means — a plugin cannot be
  un-loaded once its `onLoad` has run, so the old project's panels and context
  verbs would stay live over the new project's world.
- `project.open name` reloads only when the dev server already serves that
  project. Otherwise it remembers the name and returns the command to start one:
  a page cannot repoint the server that serves it.
- There is no save. `engine/files.js` writes straight through, so the files on
  disk are the project. Do not add a save button.
- The recent list is browser-local, like the dock sizes. It never enters a
  project file, and it is ordered by position — no clock is read.
- `GET /api/project` says which project the dev server serves. The page compares
  it with its own and reports a disagreement by name; without that, a server
  restarted onto another project leaves a tab silently reading two projects.
