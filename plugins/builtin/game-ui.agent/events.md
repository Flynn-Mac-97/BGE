# Events and focus

- A control's `action` is a name you choose. `on: { buy(value, event) }` runs on the next fixed step, never inside the DOM event.
- `event` is `{ id, action, value, kind, type, x, y, entity }`. `type` is the DOM event (`click`, `contextmenu`, `pointerover`...) or `key`. `x y` are the pointer's pixels. `entity` is what an anchor follows, else null.
- Key `on` by `action:type` to split one control by event: `'item:contextmenu'` runs for a right click, `item` for the rest.
- `triggers` on `button`, `slot`, `list` and `target` lists the DOM events that raise it: `click dblclick contextmenu pointerdown pointerup pointerover pointerout`. `pointerover` and `pointerout` fire on entering and leaving the control, not on its parts.
- Toggle, slider, select and text send their value on `change` or `input`; the rest send `data-value`.
- Menu keys act on the last panel with an enabled control that is `isInteractive` or `takesKeys` (the second leaves the mouse to the game). Up and down move focus, left and right also step a slider or select, `uiConfirm` presses, `uiBack` runs `on.back`. Focus is drawn as `[data-focus]`.
- Test: `gameUi.click(id, action, value, type)` queues the same event a person would; step once, then check state.

## Drag and drop

- Any component takes `drag: payload` (the element can be picked up) and `drop: action, dropValue: v` (it is a place to drop). A slot can be both: `slot({ drag: 'sword', drop: 'move', dropValue: 3 })`.
- Handlers: `'drag:dragstart'` and `'drag:dragend'` get the payload from the source's panel; `'move:drop'` (or `move`) gets `{ drag, drop }` from the zone's panel. Source and zone may be in different panels or anchors.
- It starts after 4 px of movement, so a click still clicks. The source gets `data-dragging`, the zone under the pointer `data-drop-hot`, and a copy of the source with class `ui-drag-ghost` follows the pointer. Style all three in `theme.css`.
- The game decides what a drop means: nothing moves until your handler moves it.
- It follows the mouse, not touch. It uses `mousedown`, so it works while a game plays.
- Test: `gameUi.drags(id)`, `gameUi.drops(id)`, and `gameUi.drop(id, action, payload, dropValue)`, then step once.

## Gamepad and touch

- **Gamepad:** each frame the pads' buttons and left stick become key codes through `input.press` and `input.release`, so a run records and replays them. Codes: `GamepadA B X Y LB RB Back Start Up Down Left Right`. A held direction repeats after 0.4 s, every 0.1 s. The menu actions are bound to them by default (`uiConfirm` is A, `uiBack` is B), and a game binds them like any key: `input.bind('jump', ['Space', 'GamepadA'])`.
- **Touch:** a tap is a `click`, so every control works. Drag and drop follows a finger too, and a dragged element is `touch-action: none`. Targets grow to 44 px on a coarse pointer (`@media (pointer: coarse)`).
- Mouse Look leaves Game UI pointer events alone. Use the mobile kit for held actions and gestures; see `mobile.md`.
