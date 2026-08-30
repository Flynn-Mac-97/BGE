# Horde Schedule

- The difficulty of Kitten Survivors: the length of a run, four curves and one
  table, and nothing else. It never touches the world — it answers questions
  about a number of minutes.
- **A run is `RUN_SECONDS`, 180.** Horde Waves spends that on `runClock.limit`,
  so the kitten can win by lasting. Every curve below is read in minutes and
  tuned against that length; change it without the others and the run climbs to
  nothing.
- `run horde.curve [minutes]` prints the whole design without playing it, in half
  minutes: spawns a second, the live cap, health and speed multipliers, cluster
  sizes, swarm sizes, and which families are in the bag.
- Tune the game by editing the constants at the top of `horde-schedule.js`.
  `SCHEDULE` is weights, not probabilities, so one row is edited by changing one
  number.
- The arc, and why each number is where it is:
  - a **row every half minute** and a **swarm every half minute** between them,
    so an escalation always lands inside the thirty seconds after a card
  - **crows open the run.** The ring is twenty-two metres out and a rat walks at
    1.95, so a rat-only opening leaves eleven seconds with nothing in range.
    Measured: first blood at 3.5s with crows in the bag
  - **wasps at 1:00** outrun the kitten, **hounds at 1:30** cannot be shot down
    on the way in, **boars at 2:00** kill in one hit if the charge is not dodged
  - the cap ends at 136, not 400. Measured: at 22 + 55/min the kitten died at
    1:21 whatever it picked, which is a run with no second half
- Measured with `kitten.arc`: a kitten picking blind lasts about ninety seconds;
  one handed a full build survives all three minutes with 913 kills. Both are
  headless and repeatable — `kitten-survivors/tests/wave-arc.js` and
  `survivable-peak.js` assert them.
- The rate's one job is to outpace the weapons, so the crowd is shaped by the
  alive cap and not by the kill rate.
- `MOST_ALIVE` is a hard ceiling of 600 for a run that overruns, and it is a
  deliberately conservative cap rather than a wall. Measured, not guessed:
  - simulation, packed shoulder to shoulder — 600 cost 1.4 ms of a 16.7 ms step,
    1,600 cost 3.8 ms, 3,200 cost 8.0 ms, linear all the way
  - renderer in Chrome — 602 entities cost 1.1 ms a frame through sync and draw
  So the whole game at that ceiling is about 13% of a 60 Hz frame. Every moving
  entity is still its own draw call; nothing amortises with the crowd.
- `pickFamily(weights, aliveByType, living)` leans toward whatever there is too
  little of. Without that lean the crowd silts up: the fast families reach the
  kitten and die, the slow ones do not, and the cap fills with rats whatever the
  schedule says.
- `context.hordeSchedule` exposes every curve, so Horde and Horde Waves read the
  numbers rather than holding copies.
