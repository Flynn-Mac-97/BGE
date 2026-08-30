# Horde Schedule

- The difficulty of Kitten Survivors: four curves and one table, and nothing else.
  It never touches the world — it answers questions about a number of minutes.
- `run horde.curve [minutes]` prints the whole design without playing it: spawns a
  second, the live cap, health and speed multipliers, cluster sizes, swarm sizes,
  and which families are in the bag.
- Tune the game by editing the constants at the top of `horde-schedule.js`.
  `SCHEDULE` is weights, not probabilities, so one row is edited by changing one
  number.
- The rate's one job is to outpace the weapons, so the crowd is shaped by the
  alive cap and not by the kill rate. Measured with the real four weapons taking
  a card at every level (`agent-runs/horde/measure-density.mjs`): the crowd now
  rides 100% of its cap for a whole twenty-minute run — 115 at 1:00, 335 at
  5:00, 600 at 10:00 — at a worst step of 1.6 ms. At the old 2.2 + 1.5/min it
  sagged to 60% of cap while the drip fell behind the kill rate.
- `MOST_ALIVE` is a hard ceiling of 600, and it is a deliberately conservative cap
  rather than a wall. Measured, not guessed:
  - simulation, packed shoulder to shoulder — 600 cost 1.4 ms of a 16.7 ms step,
    1,600 cost 3.8 ms, 3,200 cost 8.0 ms, linear all the way
  - twenty minutes of the real game, player moving, weapon killing — 1.0 ms
  - renderer in Chrome — 602 entities cost 1.1 ms a frame through sync and draw
  So the whole game at the cap is about 13% of a 60 Hz frame. Every moving entity
  is still its own draw call; nothing amortises with the crowd.
- `pickFamily(weights, aliveByType, living)` leans toward whatever there is too
  little of. Without that lean the crowd silts up: the fast families reach the
  kitten and die, the slow ones do not, and by minute twenty the cap is two
  thirds rats whatever the schedule says.
- `context.hordeSchedule` exposes every curve, so Horde and Horde Waves read the
  numbers rather than holding copies.
