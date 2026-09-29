# Kit components

`const kit = context.gameUi.kit`. Each is a function from values to an HTML string. Plain-text arguments are escaped; children are HTML strings from other kit calls. **Every component takes `class` and `style` in its options**, added to its first tag (yours wins).

| call | notes |
|---|---|
| `stack(children, { gap, align })` `row(...)` | flex column / row. `gap` is a multiple of `--ui-space` |
| `grid(children, { columns, gap })` `scroll(children, { height })` | |
| `panel(children, { title })` `modal(children, { title })` | modal fills the viewport with a scrim |
| `divider()` `spacer(size)` | |
| `heading(text, { level })` `text(text, { tone })` | tone: `quiet accent good danger` |
| `icon(glyph)` `portrait(assetName, { size })` `keyHint('E', 'Open')` | |
| `badge(text, { tone })` `toast(text, { tone })` `tooltip(children, text)` | |
| `bar(value, { max, label, kind, trail })` | kind: `health good` or the accent. The fill eases; the `.ui-bar-trail` lags a drop (`trail: false` removes it) |
| `button(label, { action, value, kind, icon, isDisabled, triggers })` | kind: `primary danger quiet` |
| `toggle(label, { action, isOn })` | sends a boolean |
| `slider(label, { action, value, min, max, step })` | sends a number |
| `select(label, { action, value, options })` `textInput(label, { action, value, placeholder })` | send text |
| `tabs(items, { action, value })` `list(items, { action })` | items `{ label, value, detail, isSelected }` |
| `slot({ glyph, image, count, action, value, isSelected })` | an inventory cell |
| `ring(value, { max, size, label, kind })` | circular progress; the value eases (`kind`: `health good`) |
| `cooldown(content, { remaining, total })` | wraps content: a dark wedge sweeps away clockwise while `remaining > 0`, with the seconds in the middle. Disable the content yourself while cooling |
| `pips(value, { max, glyph, emptyGlyph })` | hearts, ammo: `value` full of `max` |
| `typewriter(text, { chars })` | text shown to `chars` characters; the rest is laid out but hidden, so the box never grows |
| `dialogue({ speaker, text, chars, portrait, choices, advance, choose })` | a box that raises `advance` (click or Enter) and, once the text is complete, choice buttons that raise `choose` |
| `contextMenu(items, { x, y })` | a menu at a point over an outside layer that dismisses it; rows are `{ label, value, isDisabled, kind }` or `{ isDivider: true }`. Use `gameUi.menu` |
| `element(children, { as, attributes })` | any tag: the way to markup the kit has no name for |
| `target(children, { action, value, triggers, as, attributes })` | any element that raises your event; `attributes` such as `data-hot` are for your CSS |

A control also carries `data-ui-control`, `data-action`, `data-value`, `data-label`. Those are what routing, focus and `gameui.controls` read.

## Typing a line

`const line = gameUi.typewriter(text, { speed: 30 })` starts a line now, in game time, so a replay types the same. `dialogue({ text: line.text, chars: line.chars() })` in a panel's `html` function shows it. `line.skip()` shows all, `line.isDone()`, `line.restart(next)` starts another. Full stops and `!` `?` pause a little, commas less. A common `advance` handler: skip while typing, next line when done. Style `.ui-caret` (the blinking cursor), `.ui-typed`, `.ui-dialogue-box`.

## Cooldowns

Read `remaining` from engine time so the sweep pauses with the game: `remaining = Math.max(0, readyAt - context.time)`. Set `readyAt = context.time + seconds` in the handler, and pass `isDisabled: remaining > 0` to the control inside. Rings and bars ease because `--fraction` is registered as a number in the page (draw.js); a ring drawn without the Game UI plugin jumps instead.

## Notifications and menus

- `gameUi.notify(text, { tone, life })` adds a message to one stack (bottom right). It slides in, fades over its last 0.3 s, and goes after `life` seconds (default 3) of game time; a click dismisses it. Six at most; the oldest goes first. Style `.ui-notifications` and the toast in `theme.css`. Answers the id.
- `gameUi.menu({ at, items, onPick })` opens a menu at `at` (`{ x, y }`; a pointer event has both, so `at: event` works), kept inside the viewport. It takes the pointer and the menu keys: arrows, Enter and Esc work, and a click outside dismisses it. `onPick(value)` runs on the next fixed step. One menu at a time. Panel ids `ui:notifications` and `ui:menu` are for tests: `gameUi.click('ui:menu', 'pick', value)`.
