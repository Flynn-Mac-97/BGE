---
description: HTML and CSS panels a game shows over its picture — an inventory, a character sheet, a shop. Use when a game screen is easier to lay out as a page than as Screen's canvas items.
triggers: game ui, html ui, css ui, inventory screen, character sheet, paper doll, shop screen, gameui.read, context.gameUi
category: presentation
---
# Game UI

- `context.gameUi.show(id, { html, css, isInteractive })` puts a panel over the game; `hide(id)` takes it down.
- `html` is a string or a function asked every drawn frame. The DOM is written only when the string changes.
- `css` is scoped to the panel (a shadow root): it cannot style the editor, and the editor cannot style it.
- A panel fills the viewport and lets clicks through unless `isInteractive` is true.
- `context.gameUi.asset('ui/portrait.png')` is the URL for an `<img src>`; a name is under `assets/`.
- `gameui.read '"id"'` (or no id: all) answers with a panel's text. It works headless, so a test checks a panel with it.
- `gameui.list` — the panels showing.
- Cleared on `level:loaded` and `play:stopped`, like Screen.
- Mounts into the kernel's `overlay` region through `context.ui.mount`. Screen draws a canvas under it; use Screen for title, pause and result cards.
