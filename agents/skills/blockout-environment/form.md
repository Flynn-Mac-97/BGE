## What a building actually is

Two runs of this skill scored every row 7 to 9 and **form fidelity 4 and 7**.
Both wrote the same confession afterwards: the buildings stayed boxes. Route,
framing and scale are the easy wins; the shape of a mass is the row that never
moves unless you make it move, so decide it before you place anything.

Write the real form for each primary in one line before you build it, the way
a prop artist does: *what shape is this actually?* Then pick the operation.

| The thing | Its real form | Not |
|---|---|---|
| tower, silo, mill, drum house | a revolve, often tapered | a cylinder with a cone hat |
| castle or rampart wall | a frustum - it batters inward | a slab |
| vault, hangar, arcade, tunnel | an extruded profile, or a hole cut through a mass | a row of columns |
| pitched roof | a swept section with an overhang and a verge | a wedge sitting on a box |
| terraced hillside town | one landform with pads cut into it | boxes stacked on steps |
| cliff, outcrop, boulder field | displaced or metaball mass | a prism |
| road, quay, bridge deck | a swept section along a curve, crowned | a long thin cube |
| shopfront, gate, window bay | a recess cut into the wall | a plate stuck on it |

A doorway is a hole in a wall. An arcade is a run of holes in a wall, and the
columns are what is left over - build it the other way round and you have
made a colonnade, which is a different building.

**On grid and isometric maps, build the kit before the level.** Wall, corner,
door, window, floor, ramp, stair, edge-cap: eight pieces build most rooms, all
authored at one wall height so any piece meets any other. Getting the eight
right is where the form quality lives, because every one of them appears fifty
times. Writing per-building generators instead is the specific move that
produced the worst form-fidelity score in these runs - it makes each building
quickly and makes them all the same shape.

### The silhouette test - form fidelity as a number

Every other row in the score table can be checked against something. The route
is walked, human scale has a figure standing in it, playability prints metres.
Form fidelity has only ever been an opinion, and it shows: across four builds
it was the lowest row in its own run every single time, and it never moved
between passes. One build scored it 7 for four passes running, with two of the
reasoning lines written as nothing but an equals sign.

So measure it. For each primary and secondary mass, render its outline alone
from front, side and top, and divide the lit pixels by the area of the
outline's own bounding rectangle. A shape that exactly fills its box scores
1.000.

| Shape | mean of the three views |
|---|---|
| a plain box | 1.000 |
| a plain drum | 0.922 |
| a box with a hat - a roof or cap and nothing else | 0.879 |
| a box whose outline is broken: an oversailing edge, something past the top line, a lesser volume attached to one side, an element proud of a corner, a bite out of the plan | 0.725 |

Aim for **0.80 or below**, with **no single view reading 1.000**. A view at
1.000 has nothing at all breaking the outline on that axis, and the plan view
catches it most often - a perfectly rectangular footprint is the clearest tell
there is. Print the worst ten masses by name every pass, so the row names
something to fix instead of describing a mood.

**What moves the number, and what does not.** Detail *inside* the outline does
nothing: recesses, panel lines, window reveals, louvres, a dormer set into a
roof plane all fill an outline that is already there. Three things move it -
mass **outside** the bounding box, mass that **raises** the box while filling
little of it, and removal that makes the plan **non-rectangular**. That is why
this is cheap to fix: one small element in the right place beats a great deal
of detail in the wrong one.

Two exemptions, both real. **The tertiary tier does not take this test** - a
crate measures 0.952 and that is correct, a crate is a box and it has a written
reason. And **a genuinely round or drum-shaped mass reads 1.000 from the side**
without being wrong, so judge on the mean and treat a single 1.000 as a flag to
go and look, not an automatic failure.
