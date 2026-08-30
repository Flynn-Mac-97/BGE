# Kitten Run HUD

- Every screen the player sees except the level-up: the run HUD, the marks over
  the actors, and the title, pause and result cards. It lays them out; **Kitten
  Screen Look** paints them and owns the palette.
- **HUD**: the experience bar bleeds across the very top, the level on the left,
  the clock large and centred, kills on the right, health at the bottom left,
  and what was picked up as tiles at the bottom right. Each tile shows the
  upgrade's drawn picture, not a character.
- **Marks**: every actor with a name wears it over a green health bar above its
  head and a coloured ring on the floor under it. The kitten reads `YOU` in
  cyan; anything else needs `properties.nameplate`. This is how a player finds
  their own cat in a crowd of a hundred.
- **Title**: shown on `play:started`, and it holds the world under
  `kitten-title` from that moment — `play:started` is emitted before the loop
  starts, so the hold is unconditional or the run plays under the card. Any
  key, or `kitten.start`, takes it down and starts the run. Not shown headless:
  nobody is there to press a key, and a held clock would make every simulation
  a still.
- **One screen at a time.** The title may not stand over a world it is not
  holding: if the hold goes, the run has begun and the card comes down on the
  next fixed step. Prove it with `screen.read` — the title's words and the HUD's
  numbers are never both in the answer.
- **Pause**: `P` or `Escape` holds the world under `kitten-paused`. Refused
  while the title, a level-up choice or the result is up.
- **Result**: on `run:ended` — how long you lasted as the headline, then the
  level and the kills, the tiles you carried, and `R` to play again. The clock
  is not repeated as a chip under its own headline.
- **Keyboard, and it says so.** Every screen ends with one green action plate
  whose cap names the key: `ANY KEY`, `P`, `R`, `1 2 3`. The game has one input
  path and it is a keyboard.
- Behind every card the world is frosted, never blacked out — `frost()` in
  Kitten Screen Look.
- The result row of carried tiles is smaller and one line long, so ten upgrades
  fit inside the panel without reaching the AGAIN button.
- Draws through **Screen** only. `run screen.read` answers with the same words
  the player is looking at, so a headless run checks every screen.
- Commands: `kitten.hud`, `kitten.title`, `kitten.start`, `kitten.pause`.
