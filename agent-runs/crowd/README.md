# Lane crowd — the fight in the frame

The scripts that measured the spawn ring change. Run from the repository root.
Every number below was measured on the merged build.

- `node agent-runs/crowd/still.mjs` — a kitten that never moves, played to 0:30
  and 0:33. The harshest fairness test: it never dodges.
- `node agent-runs/crowd/report.mjs <label>` — a kiting run, enemies on screen at
  0:30, 1:00 and 1:30. Each mark is the mean of fifteen samples two seconds
  apart, one whole swarm cycle, because one instant swings by more than the
  effect.
- `node agent-runs/crowd/aspect-probe.mjs [wide]` — the same standing reading at
  1280x720 and 1920x855, to show the ring and the frame grow together.
- `node agent-runs/crowd/where.mjs` — which edge the off-screen enemies are past.

## Count through the camera the rule describes, never through `meadow-play`

`meadow-play` is a saved FIXED camera. The level's camera is a chase camera, so
the two agree only while the kitten stands where the view was saved. It frames a
kitten at the origin **12.75% from the top of the picture**, so most of a ring
drawn round the kitten is above the frame. Standing at 0:30 it reads 7 where the
played camera reads 14. Rebuild the camera from `context.camera.rule` and the
kitten's position; `still.mjs` shows how.

## Measured, standing, at 1280x720

| | circle ring | frame-edge ring |
|---|---|---|
| 0:30 in frame | 9 of 34 (26%) | 14 of 25 (56%) |
| 0:33 in frame | 15 of 35 (43%) | 24 of 24 (100%) |
| health at 0:30 | 62 | 44 |

A swarm lands exactly on 0:30, so part of it is still on the ring at that
instant. 0:33 is the crowd the ring holds.

## Measured, kiting

| | circle ring | frame-edge ring |
|---|---|---|
| 0:30 | 8.4 on screen, 23.5 alive | 7.0 on screen, 12.3 alive |
| 1:00 | 14.3 on screen, 43 alive | 9.2 on screen, 16.7 alive |
| 1:30 | run died at 1:08 | 16.3 on screen, 28.6 alive |
| blind survival | 1:08 | 2:01 |

The crowd is smaller because a ring at the edge of the frame puts everything in
weapon range: 257 kills by 1:00 against 195. The share in frame is far higher
and the run lasts much longer, but the absolute count at 1:00 is lower.

## The window shape does not change the share

The ring is a multiple of the frame's own edge, so both grow together. At
1920x855 the side edge is 10.88 m and the side ring 11.4-12.9; at 1280x720 they
are 8.61 m and 9.0-10.5. Standing at 0:30 the share reads 0.76 wide and 0.56
narrow. The COUNT does change with the window, so a count bar must be set for
the narrowest case and the share is the assertion that travels.
