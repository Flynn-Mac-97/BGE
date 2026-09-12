# Techniques that have actually worked

## Contents

- Reference-pixel space, numeric comparison
- Loft and revolve, boolean cutting, the plate-in-a-well unit
- Terrain as a function, unit-height generators, scatter, roll, instancing
- What a bevel-and-shade pass must do, and the three parts people drop
- Modifier table and physics

Every one of these was invented mid-build by an agent running this skill, on a
real subject, because nothing on the shelf fitted. They are described, not
supplied — write your own version against your own subject. Take what fits.

**Work in reference-pixel space.** Before placing anything, find the scale of
your reference: pick features whose real size you know, measure them in pixels,
and derive metres-per-pixel. Then read every coordinate straight off the image
and convert. One run derived 1 px = 3.6 mm from four agreeing anchors and called
it *"the highest-leverage thing in the run — it's why pass 1 was already
close."* Guessing proportions and correcting later costs passes; measuring costs
one calculation.

**Make the comparison numeric.** Do not just eyeball reference against render.
Resample the reference onto the render's world grid and print the silhouette
difference at intervals — every 50 mm worked well. *"This is what made the
passes converge, and it caught me chasing 80 mm of phantom error."* Match the
camera to the reference first: a closed-form solve for the camera roll and
framing beats two renders of guessing.

**Two operations cover nearly every form: loft and revolve.**
- **Revolve / lathe** — hand it a `(z, radius)` profile and get any turned part:
  collars, drums, thumbscrews, connectors, screws, buttons, wheels, domes,
  vases, chimney pots. Add a per-row flag for knurling and the teeth come free.
  One run built 50+ parts from a single such function.
- **Loft** — hand it a table of cross-sections along an axis and get any
  faceted or swept body: vehicle panels, hulls, fairings, ducts. Its real value
  is that a refinement pass becomes *editing a number in a table* rather than
  re-modelling. One run replaced fifteen primitives with one loft.

*"The general form of a primitive library is a loft and a revolve."* If you find
yourself asking for a new primitive, you probably want one of these two.

**Boolean cutting is the stage-1/stage-2 boundary.** A twelve-line helper that
subtracts one shape from another, used a dozen times, was described as *"the
whole difference between a blockout and a pile of boxes."* Openings, reveals,
damage, ruin breaks, ports, recesses — all removal, not addition. Apply cutters
**one at a time**: joining them into one mesh and subtracting once looks
efficient and silently drops overlapping cuts under the EXACT solver. Check the
result actually changed, because a dropped cut says nothing.

**The recurring hard-surface unit is a plate in a well with a reveal.** Rounded
rectangle, offset inward, extruded to a different depth. There is no primitive
for it and you will need it constantly, so build it once with a fixed vertex
count so offsets stay exact.

**Terrain should be a function you can query, not a mesh you inspect.** Define
the ground as an equation, build the mesh from it, and keep the function. Then
pads, worn paths, prop placement, road height and camera height all read from
the same source and agree with each other. One run queried its height field
14,000 times. *"The difference between 'displace a grid and hope' and a landform
you can query."*

**Build generators to unit height and scale per instance.** A tree built 1.0
tall can be scaled so its top lands exactly on a shared canopy plane over
uneven ground: `scale = roof_z + jitter − terrain(x, y)`. One run called this
*"the one idea the whole scene rests on."* The same trick fits any
constant-top-height constraint — fence rails, parapets, roof lines.

**Scatter with variation, not with a rubber stamp.** Array-along-a-curve repeats
one object identically and *"a rubber stamp reads as a fence."* Write your own
placement loop so each instance varies in scale, rotation and type. Vary
everything, always.

**Aiming an object leaves its roll free.** Point something at a target and it is
still free to spin about that axis — one run had every sail edge-on because of
it. Set roll explicitly.

**Share one mesh across many instances, override the material per instance.**
Seven hundred instances, one mesh, four value bands for depth. Cheap, and it is
how you get aerial perspective in greyscale.

**A bevel-and-shade pass has to do four things**, and three of them are the
ones people drop:

- **Bevel every edge.** Nothing physical has a zero-radius edge, and an
  unbevelled box reads as a rendering rather than an object. Size it to about
  1.5 px in the render so it stays visible without eating fine detail.
- **Harden normals.** A bevel without it leaves the *flat* faces pinched —
  measured at 10.6° of corner-normal deviation, which shows as fine striping
  across every flat panel. The most visible of the four.
- **Apply object scale first.** A bevel modifier works in local space, so an
  object left with a scale gets a bevel that varies with it: one cube measured
  70.7 mm to 255 mm of bevel on the *same object*.
- **Smooth by angle at 40°, not blanket smoothing**, so box corners stay crisp
  while cylinders read as pipes. Keep a way to mark parts sharp: a deliberate
  chine, a lofted facet or a knurl tooth melts at 40° and it cost one run a
  whole pass.

One run hand-rolled a bevel that skipped the other three — harden_normals 0/131
parts, mitre 0/131, smooth-by-angle 0/131 — and got striping on every flat face.
Never call `bpy.ops.object.shade_smooth()` afterwards; it deletes the
Smooth-by-Angle modifier. Do not bevel as you go.

## Modifier table and physics

Kept here as well as in SKILL.md, so this file stands alone.

**Modifiers are geometry generators, not finishing touches:**

| Reach for | When you need |
|---|---|
| Screw | anything turned — column, baluster, wheel, dome, chimney pot, vase |
| Array + Curve | crenellations, fences, balustrades, sleepers, window bays along a path |
| Boolean | openings, damage, **ruin breaks** — a ruin needs geometry removed, not added |
| Solidify | walls and shells with real thickness, from a surface |
| Displace + noise texture | terrain, erosion, rock faces, worn ground |
| Skin | a truss, pylon or branch grown from an edge skeleton |
| Wireframe | scaffolding, frames, rigging, cages |
| Remesh (blocks) | unify a kitbash into one readable mass |
| Shrinkwrap | settle props and paths onto terrain, instead of guessing heights |
| Simple Deform | bend, taper or twist a whole form at once |
| Cast | push a mass toward a sphere or cube |
| Metaballs | organic rock and landform massing that merges naturally |
| Ocean | water surface |
| bmesh inset / extrude | reveals, recesses, panel lines, hatches — the cutting half of a pass |

**Simulation. Let physics place things.** Both verified in this build:

- **Cloth** — tarps, banners, awnings, sails, draped covers, hanging sheets,
  cabling. A grid with a Cloth modifier over a Collision object settles in about
  thirty frames. Hand-modelled drapery always looks hand-modelled.
- **Rigid body** — rubble, debris, spill, scattered stock, a stack of crates
  that leans the way a real stack leans. Fourteen pieces dropped and settled in
  sixty frames. This is the fix for boulders that look placed.

**Organic and terrain forms — cliffs, ground, rock, anything not man-made.**
Do not stack slabs. Generate the surface:

- **Displace on a subdivided grid.** The modifier drives off a texture, and all
  of these are available: `CLOUDS`, `MUSGRAVE`, `VORONOI`, `DISTORTED_NOISE`,
  `NOISE`, `MARBLE`, `STUCCI`, `BLEND`, and `IMAGE`.
- **Height maps.** Write pixels into a `bpy.data.images` image, point an `IMAGE`
  texture at it, displace with `texture_coords="UV"`. Verified: a 96×96 grid
  from a generated height map gives real relief across 9,409 verts. This is how
  you author terrain deliberately rather than accepting whatever noise gives you.
- **Metaballs** for landform massing that merges into one continuous body
  instead of reading as separate lumps.
- **Geometry nodes** with a noise field, when you want it parametric.

Then **Shrinkwrap** everything that stands on it, rather than guessing heights.
(The A.N.T. Landscape add-on is not in this build. It is not needed.)

**Geometry nodes** work from Python — build the tree, link the sockets, assign
it as a NODES modifier. Distribute Points on Faces plus Instance on Points is
scatter; use it wherever you would otherwise write a placement loop.

**Generate geometry, do not place it by hand.** Twelve boulders positioned one
at a time will look positioned. Scattered on a surface and dropped by physics,
they look found. Whenever there is a procedural route, take it — it is faster
and it is the difference between a mock-up that reads and a pile of cubes.
