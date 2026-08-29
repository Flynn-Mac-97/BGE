# Kitten Upgrades

- The game's own list: six weapons, six passives, and the saucer of milk that is
  offered when everything else is maxed. One line each, and that line is what a
  player reads more often than anything else in the game.
- `context.kittenUpgrades.offer(3)` returns cards for Choice Screen — different
  every time, never the same card twice in one row.
- `apply(id, entity)` takes one: a passive becomes a `Modifiers` source named
  `upgrade:<id>`, a weapon is handed to the weapons lane and recorded.
- Ranks go to 5. A weapon and its upgrades are the **same card** — taking it
  again makes it stronger.
- Reads: `taken()` `rankOf(id)` `available()` `catalogue()`.
- The three multipliers a weapon should read off the kitten:
  `properties.damageScale`, `properties.areaScale`, `properties.cooldownScale`.
  Kitten Progression seeds them at 1.
- Weapons are never imported. Whatever `context.weapons` offers —
  `upgrade`/`levelUp`/`grant`/`give` — is called; with none of them the rank is
  still recorded on `entity.arsenal` and announced as `kitten:upgraded`.
- Commands: `kitten.upgrades`, `kitten.offer`.
