# Techniques that have actually worked

## Contents

- Terrain as a function you keep
- Booleans: the opening is the hole, not the frame
- Modular kits, unit-height generators, scatter, instancing
- Physics for rubble, cloth and stacks
- Checking a level in code: contact, clash, capsule sweep, sightlines
- The bevel-and-shade pass, and the three parts people drop
- Review cameras that show something
- Modifier table

Every technique here was invented mid-build by an agent running a blockout
skill on a real subject, because nothing on the shelf fitted. They are
described, not supplied - write your own version against your own level.

## Terrain as a function you keep

**Define the ground as something you can query, not a mesh you inspect.**
Write the height as a function of x and y, build the mesh from it, and keep
the function. Then building pads, worn paths, prop placement, road height,
water level and camera height all read the same source and agree with each
other. One run queried its height field 14,000 times and called it *"the
difference between 'displace a grid and hope' and a landform you can query."*

How to author it deliberately rather than accepting whatever noise gives you:

- **Height maps.** Write pixels into a `bpy.data.images` image, point an
  `IMAGE` texture at it, displace with `texture_coords="UV"`. Verified: a 96x96
  grid from a generated height map gives real relief across 9,409 verts. This
  is how you draw the landform you designed instead of rolling for one.
- **Displace on a subdivided grid** for the noise layer on top. The modifier
  drives off a texture: `CLOUDS`, `MUSGRAVE`, `VORONOI`, `DISTORTED_NOISE`,
  `NOISE`, `MARBLE`, `STUCCI`, `BLEND`, `IMAGE`.
- **Metaballs** for landform massing that merges into one continuous body
  rather than reading as separate lumps. Good for cliffs and outcrops.
- **Geometry nodes** with a noise field when you want it parametric.

Then **Shrinkwrap** everything that stands on it, instead of guessing heights.
This is the single fix for the village-on-stilts failure.

A path is **cut into** the terrain - subtract a swept channel, or flatten the
height function along a curve - not laid on top as a strip. A road on top of a
hill reads as a decal; a road cut into it reads as a road.

## Booleans: the opening is the hole, not the frame

Boolean removal is the line between a pile of boxes and a blockout. A doorway
is a hole in a wall. An arcade is a run of holes in a wall, and the columns are
what is left over - build it the other way round and you get a colonnade, which
is a different building.

Everything is removal: windows, arches, ruin breaks, tunnel mouths, stair
wells, wall reveals, recessed doorways, embrasures, vents.

Apply cutters **one at a time**. Joining them into one mesh and subtracting
once looks efficient and silently drops overlapping cuts under the EXACT
solver. Check the result actually changed, because a dropped cut says nothing
and a silent no-op is indistinguishable from success.

## Modular kits, unit-height generators, scatter, instancing

**Build the kit, then the level** for grid and isometric maps. Wall, corner,
door, window, floor, ramp, stair, edge-cap: eight pieces build most rooms.
Author every piece at the same wall height so any piece interchanges with any
other. If you find yourself hand-modelling a ninth variant, ask whether the
eight were the wrong eight.

**Build generators to unit height and scale per instance.** A tree or a roof
built 1.0 tall can be scaled so its top lands exactly on a shared plane over
uneven ground: `scale = target_z + jitter - terrain(x, y)`. One run called this
*"the one idea the whole scene rests on."* It fits any constant-top constraint:
fence rails, parapets, roof lines, canopy, city skyline.

**Scatter with variation, not with a rubber stamp.** Array-along-a-curve
repeats one object identically and *"a rubber stamp reads as a fence."* Write
your own placement loop so every instance varies in scale, rotation and type.
Clusters and gaps, never an even spread - an even spread is what makes a
sprinkled field.

**Share one mesh across many instances and override the material per
instance.** Seven hundred instances, one mesh, four grey bands for depth.
Cheap, and it is how you get aerial perspective in greyscale for free.

**Aiming an object leaves its roll free.** Point something at a target and it
can still spin about that axis - one run had every sail edge-on because of it.
Set roll explicitly.

**Geometry nodes work from Python** - build the tree, link the sockets, assign
it as a NODES modifier. Distribute Points on Faces plus Instance on Points is
scatter; use it wherever you would otherwise write a placement loop.

## Physics for rubble, cloth and stacks

Let physics place things; hand-placed rubble always looks hand-placed.

- **Rigid body** - rubble, debris, spilled stock, a crate stack that leans the
  way a real stack leans. Fourteen pieces dropped and settled in sixty frames.
  This is the fix for boulders that look positioned.
- **Cloth** - tarps, banners, awnings, sails, draped covers, hanging cable. A
  grid with a Cloth modifier over a Collision object settles in about thirty
  frames.

## Checking a level in code: contact, clash, capsule sweep, sightlines

None of these is visible in a render, and all of them are cheap.

**Contact, and containment.** For every mass, is there something directly
beneath it - terrain, another mass, a carrier you can name? Raycast down from
the footprint corners and the centre.

Then check the harder half: is the **whole** footprint inside the outline of
what it stands on? A centre ray hits, the corner rays miss, and you have a
plinth with a corner out over the edge of its terrace or a bench half off its
deck. Contact-only checks pass all of these. They are invisible in an overview
render and obvious at gameplay distance, where they read as a modelling
mistake and pull the eye off everything the frame is meant to say.

Sample the footprint on a grid, not just at the corners, so a round or swept
base is measured as the shape it is. Report the fraction of samples that miss,
and keep a declared list of intended overhangs - a balcony, a cantilevered
bridge, a jetty, a cornice, a diving board - so the check flags only the
accidents. A build with fifty props on terraces will have several.

**Clash.** Do two groups share volume? Test on the real rotated footprints, not
axis-aligned boxes. One run's containment test used closest-point-plus-normal,
which is only valid on convex bodies - after ninety-six booleans nothing is
convex, and it reported a clash that did not exist. **Ray parity** - count the
crossings of a ray from the point - is the version that survives booleans.

**Capsule sweep.** March the player's capsule along the route you intend and
test it against everything. This is the check that only levels need, and the
one that catches the corridor that is 0.2 m too narrow, the door frame that
eats the opening, and the stair with a beam over it.

**Sightlines.** Raycast between the points you care about - spawn to spawn,
entry to landmark, cover to cover - and record the distance and what blocked
it. This turns "is the landmark visible from the gate" from an opinion into a
number, and it is how you find the accidental sniper lane.

**Measure the shape, not its bounding box.** A round gatehouse audited by its
square footprint reported a gate the player could walk through as blocked, and
the run spent a pass widening something that was already legal. If a mass is a
cylinder, a revolve or a swept curve, test it as one - or test against its
actual mesh - before you believe a clearance failure.

**Prove every check bites.** Move one mass 1 m into another, or into the path,
and confirm it complains. Every audit written in these runs passed its first
deliberate break, silently.

## The bevel-and-shade pass, and the three parts people drop

Four things, and three of them are the ones people miss:

- **Bevel every edge.** Nothing physical has a zero-radius edge, and an
  unbevelled box reads as a rendering rather than an object. Size it to about
  1.5 px in the render.
- **Harden normals.** A bevel without it leaves the *flat* faces pinched -
  measured at 10.6 degrees of corner-normal deviation, which shows as fine
  striping across every flat wall. The most visible of the four.
- **Apply object scale first.** A bevel modifier works in local space, so an
  object left with a scale gets a bevel that varies with it: one cube measured
  70.7 mm to 255 mm of bevel on the *same object*. Levels are full of scaled
  instances, so this bites here more than anywhere.
- **Smooth by angle at 40 degrees**, not blanket smoothing, so wall corners
  stay crisp while pipes and columns read as round. Keep a way to mark parts
  sharp: a deliberate chine or a chamfer melts at 40 and it cost one run a
  whole pass.

Never call `bpy.ops.object.shade_smooth()` afterwards; it deletes the
Smooth-by-Angle modifier. Do not bevel as you go - do it once, in the finish
step, **before the first frame of the pass renders**, not before the hero shot.

**The greys are linear, not sRGB.** `10 / 30 / 70 / 90` are the values you want
to *see*; Base Color takes linear. Assign the displayed numbers directly and
every mass lands near white, the whole scene reads as porridge, and the gate
judges a picture with no value separation in it at all - which is the one thing
the four-grey rule exists to prevent. One run lost three frames to this before
noticing. Convert, then check one render actually has four distinct greys in it.

## Review cameras that show something

- **Plan view.** Orthographic, from above, ceilings and everything above head
  height hidden. For an interior that means the slab *and* the joists, ducts,
  lights, signs and cables.
- **The walk.** Five frames at eye height along the intended route, figure
  visible. The only test that answers "can a player tell where to go".
- **Depth-layer render.** The whole scene from the hero viewpoint, near/middle/
  far in their own greys.
- **Landmark alone.** The hero silhouetted against its close neighbours only.
  A whole-scene silhouette is a black rectangle; do not render one, except on
  an isometric map where the fixed camera makes the outline the read.
- **Squint.** Render small, or blur hard. This is the fastest test in the set
  and the one that catches porridge.

Light it so surfaces read. A close key at about three times the fill, plus a
sky fill, separates masses; flat ambient light makes every corner identical.

## Modifier table

| Reach for | When you need |
|---|---|
| Boolean | openings, windows, arches, tunnels, **ruin breaks** - a ruin needs geometry removed, not added |
| Solidify | walls and shells with real thickness, from a surface |
| Displace + noise texture | terrain, erosion, rock faces, worn ground |
| Shrinkwrap | settle buildings, props and paths onto terrain, instead of guessing heights |
| Array + Curve | crenellations, fences, balustrades, sleepers, window bays, street lights along a path |
| Screw | anything turned - column, baluster, dome, chimney pot, silo |
| Skin | a truss, pylon, gantry or branch grown from an edge skeleton |
| Wireframe | scaffolding, frames, rigging, cages |
| Remesh (blocks) | unify a kitbash into one readable mass |
| Simple Deform | bend, taper or twist a whole form at once |
| Cast | push a mass toward a sphere or a cube |
| Metaballs | organic rock and landform massing that merges naturally |
| Ocean | water surface |
| bmesh inset / extrude | reveals, recesses, panel lines, thresholds - the cutting half of a pass |

**Generate geometry, do not place it by hand.** Twelve boulders positioned one
at a time will look positioned. Scattered on a surface and dropped by physics,
they look found. Wherever a procedural route exists, take it - it is faster,
and it is the difference between a level that reads and a pile of cubes.
