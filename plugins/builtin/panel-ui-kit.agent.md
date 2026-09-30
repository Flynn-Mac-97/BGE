---
skill: ui-kit-panel
description: Browse every Game UI kit element in the editor, change its options and edit its CSS live, and save that CSS into the game's theme. Use to pick, restyle or check a kit component before a game calls it.
triggers: ui kit, kit component, component browser, restyle button, edit element css, element css, theme element, uikit
match: plugins/builtin/panel-ui-kit.js, plugins/builtin/ui-kit/*.js
category: presentation
---

# UI Kit panel

The right dock's **UI kit** panel lists every element of the Game UI kit. Open
one to see it drawn with the game's theme, change its options (label, kind,
value), and edit its CSS. The preview follows each keystroke; **Save** writes
the CSS, **Reset** removes it.

## Where the CSS goes

Saved CSS is in the game's `assets/ui/theme.css` between two marks:

```css
/* ui-kit:button */
.ui-button { border-radius: 0 }
/* /ui-kit:button */
```

A game carries the rules of the elements it edited and no others. It calls the
component (`kit.button(...)`) and the theme styles it. The text box starts from
the kit's own rules for that element, so an edit begins from what is drawn.

## Commands

- `uikit.list` — every element: `id`, `title`, and the kit classes it is styled by.
- `uikit.css '{"element":"button"}'` — `{ element, isSaved, css }`: the saved block, else the kit's rules.
- `uikit.set '{"element":"button","css":"..."}'` — save one element's CSS. Empty `css` removes the block.

Game UI reads the theme again when the file changes, so a running game shows a
save at once.

## Adding an element

One entry in `ui-kit/elements.js`: an `id`, a `title`, the kit `classes` that
style it, its `options`, and a `sample(kit, values)` that returns its HTML.
`test/ui-kit-panel.test.mjs` renders every entry and fails if one names no kit
class it draws.

## Detail

- `plugins/builtin/game-ui.agent/theme.md` — tokens, hooks, and how the theme file is read
- `plugins/builtin/game-ui.agent/components.md` — every kit call and its options
