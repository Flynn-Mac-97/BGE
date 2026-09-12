---
description: The card item for Screen: a numbered, glyphed, ranked choice with one line. Use when a screen shows a row of options to pick from, such as a level-up or shop.
match: plugins/builtin/screen-card.js plugins/builtin/screen.js
---
# Screen Card

- Adds the `card` item to **Screen**: a number you can press, a glyph, a name,
  a rank and one line saying what it does.
- `{ card: { number, title, line, glyph, rank, tag, color }, at, size, anchor, selected }`.
- The selected card is ringed in its own colour. It is never moved or scaled —
  a row that jumps as you arrow along it is hard to read a sentence off.
- Long lines wrap to the card's width.
- Reads back through `screen.read` as `> 1. Whip` and its line indented, so a
  headless run can tell which card is highlighted.
- It is a separate plugin because a card is a separate job, and because it is
  the proof that Screen's vocabulary is open: it adds a kind through
  `screen.painter` and Screen knows nothing about cards.
