# Map archetypes

Three ways a level is put together. They are not styles, they are different
crafts: the same courtyard is designed, measured and judged differently in
each. Pick one in the first minute, say why, and read only that section.

## Contents

- [Choosing](#choosing)
- [Grid](#grid) - CS, Valorant, competitive shooters
- [Free-form](#free-form) - Skyrim, Elden Ring, open exploration
- [Modular-isometric](#modular-isometric) - Diablo, Hades, XCOM, builders
- [Two other shapes](#two-other-shapes) - side-scroller lanes, hub seams

## Choosing

| Ask | grid | free-form | modular-isometric |
|---|---|---|---|
| Does the player fight other players here? | usually | rarely | sometimes |
| Is the space read from inside it? | yes | yes | no, from above |
| Does the same wall piece appear fifty times? | yes | no | yes |
| Does elevation carry the layout, or fights? | fights | layout | both |
| Would a 3 degree rotation break something? | yes | no | yes |

If two apply, the level is a hub: name the seam - a gate, a tunnel mouth, a
shoreline - and build each side by its own law. Averaging two archetypes gives
you a grid that does not snap and terrain that does not flow.

---

## Grid

Competitive and modular levels are built on a unit, and every mass snaps to
it. The reason is not tidiness. It is that a designer must be able to shove a
whole building one unit sideways at 2 a.m. and have every wall, floor and door
still meet, and that an artist must be able to build one wall piece and use it
in ninety places.

### Pick the unit, and say it

Work in a power-of-two ladder so pieces subdivide cleanly. In metres:
`0.25 / 0.5 / 1 / 2 / 4 / 8`. Structure lands on 1 m or larger; trim lands on
0.25 m. In engine units, common ladders are:

| Engine | Unit | Ladder designers actually use |
|---|---|---|
| Source / Hammer (CS, TF2) | 1 unit = 1.905 cm (16 units = 1 foot) | 16 / 32 / 64 / 128 / 256 |
| Unreal | 1 uu = 1 cm | 10 / 50 / 100 / 500 |
| Unity | 1 unit = 1 m by convention | 0.25 / 0.5 / 1 / 2 / 4 |

Build in metres in Blender and state the conversion once. Confirm the numbers
against the engine you are actually shipping to; treat these as the starting
ladder, not gospel.

### The rotation law

**Structure rotates in 90 degree steps. Nothing else.** A 7 degree wall means
no kit piece fits it, every neighbour needs a custom filler, and the whole
advantage is gone.

45 degrees is the one allowed exception and it is a design decision, not a
convenience: a diagonal cuts a lane, opens a crossfire angle, and breaks the
box-maze look. Use it deliberately, in whole 45s, and keep its footprint on
the grid. Props, clutter and vegetation rotate freely - they are the thing
that stops a snapped level looking snapped.

### Design the empty space first

A competitive level is the volume the player moves through; the walls are what
is left over. So block the rooms and lanes as volumes, check they play, and
only then wrap them in geometry. Building walls first gives you rooms that are
whatever shape the walls left behind.

Wall thickness is a whole unit and it is not decoration: it is what makes a
doorway a threshold rather than a hole in paper, and it is where the peeker's
angle comes from. 0.5 m is a thin partition, 1 m a solid structural wall.

### The work that is specific to grid maps

- **Lanes.** The default competitive skeleton is three routes from each spawn
  that converge - two flanks and a mid. Name yours. A level with one route is
  a corridor; with five it is noise.
- **Sightlines.** Measure the longest one and write the number. Anything over
  about 40 m is a sniper lane, which is a decision, not an accident. Every long
  sightline needs a break: a jog, a piece of cover, a drop, a doorway.
- **Timings beat looks.** Distance divided by run speed is the real design
  unit. A CS-speed player covers roughly 4.8 m/s; Unreal's default is about
  6 m/s. State the seconds from each spawn to the first place the teams can
  meet, and make them close to equal, or deliberately not.
- **Symmetry.** Say which you are using: mirrored, rotationally symmetric, or
  asymmetric-and-balanced. Mirrored is fairest and reads as artificial;
  asymmetric needs the timings above to prove it is fair.
- **Cover on the ladder.** Crouch cover 1 m, waist 1.25 m, full 2 m - all whole
  units. A 1.6 m block is neither cover nor wall and plays badly.
- **Elevation in whole units.** A 2 m ledge with a 1 m crate to climb it is
  readable. A 1.7 m ledge is a wall you can nearly get on, which is the worst
  thing a level can be.

### The failure this archetype invites

**The box maze.** Everything snaps, everything is orthogonal, nothing has a
landmark, and every corner looks like every other corner. The player cannot
say where they are, which is the one thing a competitive map must do.

The fixes, in order of power: elevation change in whole units, so rooms differ
vertically; one hero mass - a tower, a hangar, a wrecked truck - allowed off
the orthogonal at 45 degrees and visible from most of the map; prop clusters
and vegetation rotated freely against the snapped shell; and different room
*shapes*, not just different room contents.

---

## Free-form

Open, explorable space. The terrain is the level. Buildings sit on the land
rather than the land being a floor under buildings, and the player is steered
by what they can see and where they can walk, not by walls.

### Terrain first, and keep it as a function

Define the ground as something you can query - a height function, a height
map you authored, a metaball landform - and build the mesh from it. Then the
road height, the building pads, the worn paths, the prop placement and the
camera all read the same source and agree. One run queried its height field
14,000 times and called it the difference between "displace a grid and hope"
and a landform you can work with.

Shrinkwrap everything that stands on the land. Guessing z is how you get a
village on stilts.

### Rotations are free, but never random

Every rotation answers to something: a house squares to its road, a jetty to
the water, a shrine to the view, a fallen tree to the slope it fell down. A
random yaw on every building looks exactly as wrong as no yaw at all, in the
opposite direction.

### The work that is specific to free-form maps

- **The landmark chain.** From any point the player should be able to see the
  next thing worth walking to. That chain *is* the level's navigation; there
  are no corridors to do it for you.
- **Gate with terrain, not fences.** Walkable slope in most engines runs to
  about 35-45 degrees; steeper is a wall. A cliff, a river or a scree slope is
  an invisible wall the player never resents. An actual invisible wall is the
  one thing players always notice.
- **Elevation is the layout.** Decide the high ground, the low ground and the
  route between them before any building exists. Height tells the player what
  matters, what is dangerous, and where they have been.
- **Build the overlook.** A view earned by a climb is the highest-value thing
  in an exploration level. Place it, then compose what it looks at.
- **Layer the depth.** Something to frame the shot in the near ground, the
  content in the middle, a silhouette on the horizon. This is the matte
  painter's job and it happens at blockout or not at all.
- **Compress the distances.** Real distances play as empty. At about 5 m/s a
  five minute walk is 1.5 km of nothing. Put something worth reaching every
  100-200 m and let the spaces between be short.
- **Paths are worn ground.** Valleys, ridges and shorelines lead the player far
  better than a road texture. Cut the path into the terrain rather than laying
  a strip on top of it.

### The failure this archetype invites

**Wedding-cake terrain**, and its twin, **the sprinkled field**.

Wedding cake is landform as stacked slabs, tilted or not - it reads as a
diagram of a hill. Make the main landform thick (several times a player's
height, not a plate), step the tops to clearly different heights, and push
each mass out past its neighbour on one side only. That asymmetry is the
mechanism; rotating the slabs is only the finish.

The sprinkled field is a flat plane with props scattered evenly on it. If a
player can see everything from the entry, there is no exploration - only
walking. The fix is always the same: relief, and something hidden behind it.

---

## Modular-isometric

A fixed camera looking down at a floor made of tiles. Diablo, Hades, XCOM,
Bastion, most builders and most tactics games. Two things follow from the
fixed camera, and they change everything.

### One: you author to one angle only

Set the camera first and never move it. True isometric is a 45 degree yaw with
a 35.264 degree pitch; most games use a 45 degree yaw with a steeper pitch,
often 50-60 degrees, because it shows more floor. Pick yours, write it down,
and judge every frame from it.

Because the angle is fixed, **two of a building's four faces are never seen.**
Do not build them, and put the geometry budget into the two that face the
camera. This is not laziness, it is where the archetype gets its density.

### Two: occlusion is the enemy

Anything between the camera and the play area hides the player, and a hidden
player is an unplayable game. So:

- **The near walls come off.** Build only the two far walls of a room. This is
  the doll's-house convention and players read it instantly.
- **Tall masses go to the far side.** Towers, trees and cliffs belong at the
  back of the frame, behind the play space, not in front of it.
- **Height budget.** Fix a maximum height for anything inside the play area -
  often one or two tile steps - and put everything taller outside it.
- **Test by occlusion, not by beauty.** Put the figure at ten points across the
  level and render from the fixed camera. Any frame where you cannot see the
  figure is a bug.

### The tile kit

The ground is tiles of one footprint. Pick it - 1 m, 2 m or 4 m are all
common - and make it the unit for everything.

- **Heights are whole steps**, usually half the footprint or the footprint
  itself. A 2 m tile with 1 m steps gives clean stairs and readable ledges.
- **Every kit piece is authored at the same wall height** so any piece
  interchanges with any other. That is what "modular" buys you.
- **Everything snaps to tile edges**, and structure rotates in 90s, same as the
  grid archetype. Props rotate freely.
- **Build the kit, then the level.** Wall, corner, door, window, floor, ramp,
  stair, edge-cap. Eight pieces build most rooms. If you are hand-modelling a
  ninth variant, ask whether the eight were the wrong eight.

### The read is the silhouette, unusually

Everywhere else in this skill you are told not to judge a level by its
outline. Isometric is the exception: the camera never moves, so the shape a
building cuts against the floor *is* what the player learns to recognise. Vary
the footprints, step the rooflines, and make the hero building a shape nothing
else in the kit can make.

### The failure this archetype invites

**The chessboard.** A flat tile field with props placed evenly on it, all one
height, everything at 90 degrees, no landmark. It is what you get when the kit
is used as a tiling texture instead of as a set of parts.

The fixes: height variation in whole steps, so the floor is not one plane;
clusters and gaps rather than an even spread; one off-kit hero mass; and
rotated, varied props against the snapped shell.

---

## Two other shapes

**Side-scroller.** One readable plane. Everything the player interacts with
lives on it; everything else is parallax decoration, and mixing the two is the
whole failure mode. Silhouette every interactive mass against the background -
if a ledge is not obviously a ledge in black-and-white, it does not exist.
Vertical space is the design space: jump height and reach set your entire
grammar, so fix them before the first platform.

**Hub seams.** When two archetypes meet, put a real object at the join - a
gate, a bridge, a tunnel mouth, a shoreline, a lift. The seam should read as a
place, because it is the one moment the player feels the rules change. Each
side keeps its own law right up to the seam; neither bleeds into the other.
