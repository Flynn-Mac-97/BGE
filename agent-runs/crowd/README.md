# Lane crowd — the fight in the frame

The scripts that measured the spawn ring change. Run from the worktree root.

- `node agent-runs/crowd/report.mjs <label>` — enemies on screen at 0:30, 1:00
  and 1:30, through the level's own chase camera. Each mark is the mean of
  fifteen samples two seconds apart, one whole swarm cycle, because one instant
  swings by more than the effect.
- `node agent-runs/crowd/still.mjs` — the see-battery moment: a kitten that
  never moves, played to 0:30, then asked what is in frame.
- `node agent-runs/crowd/where.mjs` — which edge the off-screen enemies are past.
- `onscreen.mjs` is what `report.mjs` runs; call it directly for the raw JSON.

Measured, kiting arc, live enemies only (bodies linger and carry their family's
type, so they are counted apart):

| mark | before | after |
|---|---|---|
| 0:30 | 5.0 | 7.5 |
| 1:00 | 6.9 | 14.7 |
| 1:30 | 8.7 | 17.7 |

In the browser at 0:30, one instant: 9 of 41 alive before, 21 of 24 after.
Standing kitten at 0:30: 8 before, 28 after.
