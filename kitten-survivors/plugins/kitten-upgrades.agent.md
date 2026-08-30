# Kitten Upgrades

- The game's own list: the four weapons, six passives, and the saucer of milk
  offered when everything else is maxed. One line each, and that line is what a
  player reads more often than anything else in the game.
- **A weapon's id IS its Auto Weapons name** — `claw dart`, `yarn ball`,
  `purr wave`, `hairball`. An id that names no defined weapon is a card that
  does nothing, which is what this file used to be full of.
- `apply(id, entity)` takes one, and returns the stats or properties it changed.
  Rank one of a weapon arms the kitten with it; every rank after folds that
  rank's `changes` into `weapon.stats` through `context.autoWeapons.levelUp`.
- A passive becomes a `Modifiers` source named `upgrade:<id>`. Quick Claws,
  Sharp Teeth and Fluffy Tail also fold one `weaponStep` into every weapon
  carried, and once per rank into any weapon picked later — Auto Weapons fires
  from `weapon.stats` and reads nothing off the owner.
- Ranks go to 5. A weapon and its upgrades are the **same card**.
- The kitten starts armed, so `begin()` reads the starting ranks back off what
  Auto Weapons says it is carrying. `needs` lists Kitten Weapons for that
  ordering.
- `offer(3)` returns cards for Choice Screen — never the same card twice in one
  row, and a saucer of milk fills any gap.
- Card colours follow `kitten-survivors/art/interface/bible.md` — vivid gold for
  a weapon, vivid green for a passive, vivid blue for the milk refill — and
  match the glyph colour Kitten Run HUD draws for the same pick.
- Reads: `taken()` `rankOf(id)` `available()` `catalogue()`. `reset()` puts the
  ranks back to what the kitten is holding.
- Commands: `kitten.upgrades`, `kitten.offer`, `kitten.take '"sharp-teeth"'` —
  the last one answers with the number it changed.
- Proved by `kitten-survivors/tests/upgrades.js`: every rank of every card, read
  either side of the pick.
