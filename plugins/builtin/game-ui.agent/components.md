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
| `accordion(sections, { open, action })` | sections `{ value, title, content }`; headers raise `toggle` with the value. The height animates; controls in closed sections are disabled, and `read` still shows their text |
| `table(columns, rows, { action, selected, sortKey, sortDirection })` | columns `{ key, label, align, isSortable }`, rows `{ value, ...cells }`; a row raises `action`, a sortable header raises `sort` with its key, and you sort |
| `avatar({ image, name, size, status })` | a round picture or initials; `status`: `online away busy` |
| `keybind(label, code, { isListening })` | a label and a keycap; the keycap raises `rebind`. Then call `gameUi.captureKey` |
| `spellBar(spells, { label, radius })` | persistent mobile wheel; spells `{ label, action, remaining, total, isDisabled }`. Holds named input actions; cooldowns disable casting. Four spells at the default radius give 56px targets. Use `input.pressed(action)` for single casts. |
| `radial(items, { x, y, radius })` | items `{ label, value, glyph, isDisabled }` on a circle clockwise from the top. Use `gameUi.radial` |
| `log(lines, { height, max })` | a chat or combat log that stays at its newest line with no script; lines are text or `{ who, text, tone }`, and only the last `max` (200) are drawn |
| `virtualList(items, { rowHeight, height, top, overscan, pick })` | any number of rows, only those in view drawn. Keep `top` from the `scroll` action |
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

## Rebinding a key

In the `rebind` handler: `gameUi.captureKey(code => { ... })`. The next key press goes to the callback on the next fixed step (Esc gives `null`), and Game UI keeps that key from its own menu. Show `isListening: true` on the row meanwhile. A game can check `gameUi.isCapturing()` to ignore its own bindings while it waits. `gameUi.feedKey(code)` gives a key by hand, for tests. `keyName('KeyE')` is `E`.

## Weapon wheels

`gameUi.radial({ at, items, radius, onPick })` opens a wheel around `at` (`{ x, y }`, the viewport's middle by default), kept on screen. Pointer hover, arrows and a gamepad stick all move one focus, and a click or the confirm key picks. For a wheel held open by a key: open it on press and call `gameUi.pickFocused('ui:radial')` on release; it confirms whatever the pointer or stick is on. A background layer (`data-passive` on a control) is clickable but never focused, so a release with nothing chosen picks nothing.

## Tooltips

Any component takes `tip: 'text'`. For an item card, register HTML by key and point the component at it:

```js
gameUi.tips({ item: id => kit.stack([kit.heading(names[id], { level: 3 }), kit.text(lines[id])]) })
kit.slot({ glyph: '⚔', tipKey: 'item', tipValue: 'sword' })
```

- The box shows after 0.35 s over one element, beside the pointer on the side with room, and follows it. It never takes the pointer, and sits above every panel.
- A control that keys or a gamepad stick moved focus to explains itself under the element. Pointer movement anywhere hands it back to the pointer.
- Text is escaped; a provider's HTML is yours. A provider that answers nothing falls back to `tip`. `gameUi.tipHtml({ tip, tipKey, tipValue })` answers what the box would show, for a test. Style `.ui-tooltip-box`.
- `kit.tooltip(content, text)` is the CSS-only version, for a plain hover.

## Long lists

- **Any list, table or log:** rows out of view skip layout and paint (`content-visibility: auto`), so a few hundred rows cost little.
- **Thousands of rows:** use `virtualList`. Keep the scroll position in your state: the `scroll` action's value is `scrollTop` in pixels, and you pass it back as `top`. Rows are a fixed height, so the scroll bar is exact, and about 14 rows are in the page whatever the length. `pick: 'action'` makes rows clickable; `gameUi.controls(id)` lists only the rows drawn.
- **A log:** `log(lines)` needs no script. Append to your array; the newest line stays at the bottom, and a person who scrolls up is not pulled back down until they return.

`textArea(label, { action, value, placeholder, rows, isDisabled, isReadOnly })`
is a multiline text control. It reports `input` like `textInput`; live focus and
text selection survive normal panel updates. Read-only text remains selectable.
