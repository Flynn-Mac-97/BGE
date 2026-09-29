# Events and focus

- A control's `action` is a name you choose. `on: { buy(value, event) }` runs on the next fixed step, never inside the DOM event.
- `event` is `{ id, action, value, kind, type, x, y, entity }`. `type` is the DOM event (`click`, `contextmenu`, `pointerover`...) or `key`. `x y` are the pointer's pixels. `entity` is what an anchor follows, else null.
- Key `on` by `action:type` to split one control by event: `'item:contextmenu'` runs for a right click, `item` for the rest.
- `triggers` on `button`, `slot`, `list` and `target` lists the DOM events that raise it: `click dblclick contextmenu pointerdown pointerup pointerover pointerout`. While a game runs, Mouse Look stops `pointerdown` before the overlay sees it, so use `click` for a press. `pointerover` and `pointerout` fire on entering and leaving the control, not on its parts.
- Toggle, slider, select and text send their value on `change` or `input`; the rest send `data-value`.
- Menu keys act on the last panel with an enabled control that is `isInteractive` or `takesKeys` (the second leaves the mouse to the game). Up and down move focus, left and right also step a slider or select, `uiConfirm` presses, `uiBack` runs `on.back`. Focus is drawn as `[data-focus]`.
- Test: `gameUi.click(id, action, value, type)` queues the same event a person would; step once, then check state.
