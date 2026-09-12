# Driving it

- `run skybox.look` — the resolved sky, `skyBox` (`none` `loading` `shown` `failed`
  `nothing is drawing`), `skySize`, the mapping, what the level `declared`, what
  changed this session, and notes. It waits for the level's block to be read off
  disk; reading `context.skybox.report()` directly may answer with the defaults.
- `run skybox.set '["skyTexture", "sky.png"]'`, or a whole block
  `'{"sky":"#6d7f96","skyTexture":"sky.png"}'`. `null` as the value drops the change
  back to what the level said.
- Changes are for this session only — nothing is written, and the next level load
  drops them.
- `world.look` and `world.set` answer for the whole block and route the two sky keys
  here, so either command works.
- Headless, the sky is resolved and reported but no image is loaded. Check a sky in a
  browser frame.
