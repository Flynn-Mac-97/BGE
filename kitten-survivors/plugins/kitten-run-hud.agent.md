# Kitten Run HUD

- Six things: the experience bar across the very top, the level, the clock large
  and centred, kills on the right, health at the bottom, and a row of glyphs for
  what the kitten has picked up.
- Draws through **Screen** as lists of items — nothing here paints, and
  `node bin/engine.mjs --headless run screen.read` answers with the same words
  the player is looking at.
- Only while playing or simulating. An always-on HUD would sit over the scene
  you are trying to edit.
- Puts up `kitten-result` on `run:ended`: how long you lasted, the level, the
  kills, what you carried, and `R to try again`.
- Asks to be put back on `level:loaded`, because Screen clears itself there.
- Command: `kitten.hud`.
