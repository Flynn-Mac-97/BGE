# Kitten Practice

- Straw kittens to hit, and the two commands that prove a run works with no dev
  server and no screen. Nothing here runs on its own; every verb is a command.
- `kitten.dummies 8` stands a ring of targets around the player; `kitten.clear`
  takes them away.
- `kitten.proof '[10, 8]'` stands eight targets up, arms every weapon, runs ten
  seconds, and answers with what died, which weapon did it, how much damage each
  dealt, and how many numbers and impacts came out. A third argument upgrades
  the build first: `'[10, 8, {"claw dart": {"count": "+2"}}]'`.
- `kitten.arc '[180, 15]'` plays a whole run: it takes a card every time the
  world stops for one, kites the kitten away from the crowd, and reports the
  clock, the level, the kills, the crowd and the health at every mark, plus
  `lowestHealth` and how the run ended. A third argument drafts a build first:
  `'[180, 30, ["yarn ball", "sharp-teeth"]]'`.
- **Use `kitten.arc`, not `simulate`, for anything longer than a level-up.** A
  choice screen holds the world, and a held step moves no clock at all, so a
  plain `simulate(60)` stops dead at the first card and every reading after it
  is the same reading.
- The arc gives up rather than spins: `MOST_STILL_SLICES` slices that move no
  clock end the run and `heldBy` names what is holding it. Ask for a run past
  the end of one and that is the answer you get.
- The arc's kitten is a stand-in for a player and deliberately a plain one: it
  runs from whatever is within nine metres, across the crowd rather than
  straight back, and turns toward the middle at the edge. It measures the
  schedule, so it must be neither good enough to hide a wall nor bad enough to
  die to an empty meadow.
- Kills are counted off the bus, not by comparing entity lists, because a body
  lingers before it is removed and would otherwise be counted as a survivor.
- Run either with no screen:
  `node bin/engine.mjs --headless --project kitten-survivors run kitten.arc '[180, 30]'`
- Delete this file and the game is unchanged.
