# Kitten Run HUD

- Every screen the player sees except the level-up: the run HUD, the marks over
  the actors, and the title, pause and result cards.
- The look is `kitten-survivors/art/interface/bible.md` — fat rounded shapes, a
  heavy near-black edge on every one, big bold numbers, strong colour never
  grey, icons and numbers never sentences. The middle of the screen stays empty
  because that is where the kitten is.
- **HUD**: the experience bar bleeds across the very top, the level on the left,
  the clock large and centred, kills on the right, health at the bottom left,
  and what was picked up as tiles at the bottom right.
- **Marks**: every actor with a name wears it over a green health bar above its
  head and a coloured ring on the floor under it. The kitten reads `YOU` in
  cyan; anything else needs `properties.nameplate`. This is how a player finds
  their own cat in a crowd of a hundred.
- **Title**: shown on `play:started`, and it holds the world under
  `kitten-title` — but only in a browser, because a headless run has nobody to
  press a key. Any key, or `kitten.start`, starts the run.
- **Pause**: `P` or `Escape` holds the world under `kitten-paused`. Refused
  while the title, a level-up choice or the result is up.
- **Result**: on `run:ended` — how long you lasted, the level, the kills, the
  tiles you carried, and `R` to play again.
- Adds three item kinds to Screen: `plate` (a tile with a big number or glyph,
  a small cap above and a badge in the corner), `meter` (a bar with its label
  inside), `mark` (name, health bar and ground ring, in screen coordinates).
  Kitten Progression draws its cards on `plate`.
- Draws through **Screen** only. `run screen.read` answers with the same words
  the player is looking at, so a headless run checks every screen.
- Commands: `kitten.hud`, `kitten.title`, `kitten.start`, `kitten.pause`.
