# UI sounds

The theme file names the sounds, so one file sets how the UI looks and sounds:

```css
:root {
  --ui-sound-click: ui/sounds/click.wav;   /* under assets/ */
  --ui-sound-hover: ui/sounds/hover.wav;
  --ui-sound-volume: 0.7;
}
```

| sound | plays when |
|---|---|
| `click` | a button, slot, row, tab or target is pressed (by mouse or the confirm key) |
| `toggle` `tab` `select` | that control is used; each falls back to `click` |
| `slide` | a slider changes; no fallback, so it is silent unless you set it |
| `hover` | the pointer enters an element with `data-ui` (every kit control has one) |
| `focus` | keyboard focus moves |
| `open` `close` | an interactive panel is shown or hidden; Esc plays `close` |
| `pickup` `drop` | a drag starts, and a drop lands (they fall back to `click`) |
| `notify` | a notification shows; `notify-good` `notify-danger` `notify-accent` fall back to it |

- A name with no file is silent. `gameUi.sounds({ click: 'mine.wav' })` sets files in code, over the theme's.
- `gameUi.playSound('click')` plays one by hand.
- They play through `context.play` on the fixed step. The same sound waits 0.05 s, and a game time that goes back (a reload, a rewind) does not hold one up.
- `node tools/make-sounds.mjs --ui <directory>` makes a set of short blips to start from.
