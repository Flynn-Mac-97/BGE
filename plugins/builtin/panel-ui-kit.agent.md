---
skill: ui-kit-panel
description: Every Game UI component, the kit's and the game's own, in one live gallery and as JSON commands. Use to find, design, restyle or check a UI component, to make a new one, or to get the exact line that shows one.
triggers: ui kit, ui component, component gallery, design a component, new component, restyle button, element css, theme element, uikit, accessibility, contrast
match: plugins/builtin/panel-ui-kit.js, plugins/builtin/ui-kit/*.js, **/assets/ui/components/*.html
category: presentation
---

# UI Kit

Two doors to the same components. A person uses the **UI kit** panel; an
agent uses the commands and edits files. Both read and write the same files,
so neither has a copy the other cannot see.

## For an agent

Run with `node bin/engine.mjs --headless --project <game> run <command>`.

- `uikit.list` — every component: `id`, `kind` (`kit` or `game`), `group`, `about`, `file`, and its props with defaults.
- `uikit.get '{"id":"quest-card","props":{"tier":"urgent"}}'` — one component: `code` (the line a game writes), `html`, `css`, `source` (a game file's whole text) and accessibility `findings`.
- `uikit.new '{"id":"loot-card","about":"One sentence."}'` — writes `assets/ui/components/loot-card.html` from a working template. Then edit that file.
- `uikit.set '{"id":"button","css":"..."}'` — a kit element's CSS, kept in `assets/ui/theme.css` between `/* ui-kit:button */` marks. Empty CSS removes it. A game component's CSS is in its own file.
- `uikit.audit` — theme contrast (WCAG AA) and every component's findings; `ok` is true when there are none. `'{"backdrop":"#ffffff"}'` checks against a light world.

The file format of a game component: `game-ui.agent/game-components.md`.

## For a person

The **UI kit** panel is in the right dock. **Expand** draws it over the
whole editor (`uikit.expand`, Esc docks it). The gallery draws every
component live with the game's theme, the game's own first. Pick one to
change its props, copy its code, read its findings, and edit its CSS or its
file. Edits show as they are typed; **Save** writes the file.

## Adding a kit element to the gallery

One entry in `ui-kit/elements.js`: `id`, `title`, `group`, the kit `classes`
that style it, `props`, and `call(values)` returning `[kitFunction, ...args]`.
The gallery draws the call and prints it as code, so the two always agree.
`test/ui-kit-panel.test.mjs` fails an entry that draws none of its classes or
has an accessibility finding.

## Detail

- `plugins/builtin/game-ui.agent/game-components.md` — a component file, its props, actions and CSS
- `plugins/builtin/game-ui.agent/theme.md` — tokens, hooks, and how the theme file is read
- `plugins/builtin/game-ui.agent/components.md` — every kit call and its options
