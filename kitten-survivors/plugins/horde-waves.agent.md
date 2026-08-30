# Horde Waves

- The spawn clock. Nothing hostile is placed in `meadow.json` and nothing should
  be — a survivor's crowd arrives on a clock, off the edge of the screen.
- Three things happen here:
  - **the drip** — spawns owed are accumulated and paid out as clusters, one family
    on one bearing, so eight crows arrive as a flock rather than as eight birds
  - **the swarm** — every half minute, one family from one bearing, all at once,
    biased hard toward where the kitten is running. It is meant to be run from,
    and it is the beat the player feels the run escalate on.
  - **the recycle** — at the cap, the furthest enemies the camera cannot see are
    taken away so new ones can arrive. Over-represented families go first.
- The drip pays its debt down by what actually arrived, never by what it asked
  for. A full meadow banks the rest — up to `OWED_SECONDS` of the current rate —
  and rests for `REST_WHEN_FULL` before asking again. Subtracting the whole
  cluster when the cap refused part of it is the bug that once held the crowd
  at 60% of its own cap.
- Nothing in view is ever removed. A vanishing enemy is worse than a stale crowd.
- Spawn bearings lean toward the kitten's direction of travel (`AHEAD`), which is
  what makes the horde feel like it is cutting you off rather than trailing.
- `run horde.spawn '["hound", 12]'` sends a batch by hand. A hand batch answers to
  the hard ceiling only, not to the minute's cap.
- It also sets the length of a run: `context.runClock.limit(schedule.runSeconds)`
  on every `level:loaded`. Last it and the run ends `survived` rather than only
  ever ending `died`. The number is Horde Schedule's, because how many minutes
  there are is part of the difficulty curve.
- Numbers here are about arrival — bearings, spreads, how far behind counts as
  lost. Everything about difficulty is in Horde Schedule.
