# Horde Schedule

- The difficulty of Kitten Survivors: four curves and one table, and nothing else.
  It never touches the world — it answers questions about a number of minutes.
- `run horde.curve [minutes]` prints the whole design without playing it: spawns a
  second, the live cap, health and speed multipliers, cluster sizes, swarm sizes,
  and which families are in the bag.
- Tune the game by editing the constants at the top of `horde-schedule.js`.
  `SCHEDULE` is weights, not probabilities, so one row is edited by changing one
  number.
- `MOST_ALIVE` is a hard ceiling of 600, and it is the **renderer's** limit, not the
  simulation's. Measured, packed shoulder to shoulder: 600 cost 1.4 ms of a 16.7 ms
  step, 1,600 cost 3.8 ms, 3,200 cost 8.0 ms, linear all the way; twenty minutes of
  the real game sits at 1.0 ms. Every moving entity is its own draw call, so raise
  it the day the renderer instances a crowd.
- `pickFamily(weights, aliveByType, living)` leans toward whatever there is too
  little of. Without that lean the crowd silts up: the fast families reach the
  kitten and die, the slow ones do not, and by minute twenty the cap is two
  thirds rats whatever the schedule says.
- `context.hordeSchedule` exposes every curve, so Horde and Horde Waves read the
  numbers rather than holding copies.
