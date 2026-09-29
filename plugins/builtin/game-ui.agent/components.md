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
| `element(children, { as, attributes })` | any tag: the way to markup the kit has no name for |
| `target(children, { action, value, triggers, as, attributes })` | any element that raises your event; `attributes` such as `data-hot` are for your CSS |

A control also carries `data-ui-control`, `data-action`, `data-value`, `data-label`. Those are what routing, focus and `gameui.controls` read.
