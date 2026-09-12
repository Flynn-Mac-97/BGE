# What Physics 3D costs

`run profile.steps` measures it, headless, and names the system. Numbers from
one machine with bodies resting on a floor of 4 m slabs. The shape is the
finding, not the milliseconds.

| dynamic bodies | step ms | of the 16.7 ms budget |
|---|---|---|
| 50 | 0.29 | 2% |
| 200 | 0.49 | 3% |
| 800 | 2.1 | 12% |
| 2000 | 6.4 | 38% |
| 4000 | 26.7 | over |

```sh
node bin/engine.mjs --headless --project <path> --level <name> run profile.steps
```

## Where the time goes

- **Solids are close to free.** 1681 solids with ten bodies costs 0.13 ms. The
  static grid is rebuilt only when a solid moves, so a map of walls is paid for
  once rather than every step.
- **Bodies are binned on the ground plane every step**, by the footprint each
  could reach, so a body is tested against the bodies near it rather than all of
  them. The cell is 4 m.
- **Bodies in one heap cost most.** 200 bodies inside one cell costs 2.9 ms.
  They really do all touch, so no binning helps; the count in one place is the
  number to keep down.
- **Triggers are cheap.** 200 trigger volumes, nothing dynamic, costs 0.09 ms —
  the contact pass alone.
- **Per body the cost is flat to about 2000**, then rises faster than the count.
  Treat 2000 bodies as the practical ceiling and measure past it.

## A raycast scans every 3D collider

About 0.16 µs per entity per ray, with no grid: the ray takes an entity list so
the same maths serves a bullet, a bot and a test with no hidden state.

| entities | µs per ray | rays in one frame |
|---|---|---|
| 219 | 29 | 579 |
| 1241 | 159 | 105 |
| 5225 | 844 | 20 |

Cast for a shot. A dozen bots each casting every step is the load that runs out
of budget first on a large map.
