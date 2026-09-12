## The shape of the work

**Stop, Limit, Compare** (JaviSkau), in that order.

- **Stop** - read the reference and design the place before modelling. Where
  the player comes in, where they go, what pulls them there, what the ground
  actually does. Most of the job, and it feels like delay.
- **Limit** - four greys only: `10 / 30 / 70 / 90`, ground 50, no mass at 50.
  Value is the strongest contrast (Blevins). Touching masses at one grey stop
  being two masses, and a level is mostly touching masses. Those numbers are
  *displayed* percentages: Blender's Base Color is linear, so convert before
  you assign, or every mass comes out near white and the first renders are
  porridge you cannot judge. One run lost three frames to it.
- **Compare** - the figure, from the first mass, forever.

**Keep it rough and loose** (Vaccaro, Naughty Dog). A level gets moved more
than any other asset, so a blockout that is easy to shove around beats one
that is precious. Build it so a wall can move 3 m in one edit.

### Tiers

| Tier | Contains | Test |
|---|---|---|
| primary | masses that block, frame or steer - ground, landform, hero building, main walls, the route's edges | you could walk the level from these alone |
| secondary | what sits on primaries - roofs, balconies, stairs, bridges, cover, big props | remove it and the space is plainer but still playable |
| tertiary | body-scale cues - doors, rails, kerbs, crates, signs, lamps, clutter | tells the eye how big everything else is |

**Every primary mass blocks, frames or steers. One that does none of the three
is standing in the player's way** - cut it or give it a job.

Blevins's proportions, broken only on purpose: split **70/30, never 50/50**,
because two equal routes give the player nowhere to commit; each tier ~30% the
size of the one above; vary sizes inside a tier or a row of identical
buildings reads as wallpaper; ~70% dense to 30% rest, so the busy places
register as busy.

### Passes - route first, then mass, then cut

| Pass | Establish | Then |
|---|---|---|
| pass-1 | ground, elevation, the route, the entry, the landmark | primary masses |
| pass-2 | openings, thresholds and reveals cut into the primaries | secondaries: stairs, bridges, cover, roofs |
| pass-3 | recesses and trim cut into the secondaries | tertiaries: body-scale cues everywhere the player walks |

Detail cut *into* a mass reads; detail placed beside it does not. A doorway is
a hole in a wall, not a frame stuck on one.

A primary in the wrong place drags every child with it. Wrong at six masses is
free, wrong at eighty is a rebuild.

### Gates - a tier does not land until it passes

Bevel and light before every render. An unpolished box catches no light on any
edge, so it reads as a diagram and the gate judges a lie. Finish the mesh
before the *first* frame, not before the hero shot - one run bevelled after
its orthos, so three of six gate frames were judged unbevelled for three
passes and nothing complained.

| Gate | Asks |
|---|---|
| pass-1 | scale right, route legible from the entry, landmark framed, ground is a real surface, nothing floats |
| pass-2 | openings read as holes, every level change has a named way up, cover heights legal, 70/30 holding, every gameplay frame has something in the middle of it, every primary and secondary at or below 0.80 on the silhouette test |
| pass-3 | body-scale cues everywhere the player goes and **on the walked surface, not only at the rim**, density matches the reference, every footprint contained, the walk and the gameplay frames still read |

Fix failures inside the pass. An error carried up a tier costs every mass above it.
