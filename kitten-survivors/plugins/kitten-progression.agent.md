# Kitten Progression

- The wiring: something dies, it drops a gem, the gem flies in, the bar fills,
  the world stops and you choose. Nothing here fights.
- **Tell it about a kill**: emit `enemy:died` with the entity (or
  `enemy:killed`, `entity:died`, `damage:died`, `damage:killed`), or call
  `context.progression.enemyDied(entity)`. It counts the kill and drops a gem
  worth `entity.properties.experience`, defaulting to 1.
- **What other lanes should read** — never guess at upgrades:
  - `context.progression.stats()` → `{ damage, area, cooldown, speed, pickupRadius, maxHealth, health }`
  - on the kitten: `properties.damageScale`, `areaScale`, `cooldownScale`,
    seeded at 1 and multiplied by passives. `properties.speed`, `maxHealth` and
    `pickupRadius` are changed in place.
- The curve: 5 points for level 2, five more each level to twenty, then +12.
  A gem is worth 1, so the first level-up is five kills.
- The kitten is `you`, then the first `kitten`, then whoever the camera follows.
- `R` restarts once the run is over — it reloads the level, and every plugin
  here empties itself on `level:loaded`. It goes straight back into the run
  rather than to the title card.
- **It draws the level-up.** Choice Screen keeps the queue, the hold on the
  world and the keys; its own card row is hidden on `choice:offered` and
  `kitten-level-up` shown instead, so the cards match the rest of the interface
  per `kitten-survivors/art/interface/bible.md`. `choice.pick` and the number
  keys work exactly as before.
- Adds the `kittenCard` item kind to Screen: a fat panel, a coloured head band
  with the glyph, a number badge a thumb presses, then the name, the rank and
  one line. `run screen.read` reads the cards and marks the chosen one.
- Commands: `kitten.progress`, `kitten.drop <worth>` (a gem beside the kitten,
  for trying the magnet with no enemies in the world).
