# How AI level blockouts fail

The eight, with the evidence behind each. `SKILL.md` carries the one-line
index and repeats each rule where it bites; this file is why the rule is on
the list at all. Ordered by damage.

## 1. Everything is a box with a hat

A castle wall batters inward, so it is a frustum; a cliff is not a prism; a
road bends and crowns; a roof has a pitch and an overhang. Ask of every mass:
what shape is the real thing?

A cube needs a written reason. A crate is a cube. A shipping container is a
cube. Almost nothing else is. Builds that were mostly cubes were scored 0.4
and 3.9 out of 10 by a working artist. One run built an arcade - a run of
arches - as a row of columns, which is the same failure: the arch is a hole
cut in a wall, and the columns are what is left over, not the thing itself.

It is first on this list because of what happened when it was fifth. Two runs
of this skill - a competitive cyberpunk map and a floating solarpunk island -
scored themselves 7 to 9 on route, framing, human scale and place, and **4 and
7 on form fidelity**. Both wrote the same confession unprompted: the buildings
stayed boxes. The island run named the cause exactly - it wrote per-building
generators instead of a modular tile kit, which makes each building fast and
makes them all the same shape. Route and scale are the easy wins in a level.
The shape of a mass is the row that only moves if you decide it before you
place anything.

## 2. The tray

Everything sits on one rectangular ground slab with straight edges. It reads
as a museum model on a base, and no amount of building detail rescues it,
because the boundary of the world is a rectangle and the eye finds it
immediately.

The fix is structural, not cosmetic: overlap several ground masses at
different heights, and break the boundary so the edge of the level is a
cliff, a shoreline, a treeline or a fog line rather than a cut.

## 3. Wedding-cake terrain

Landform built as stacked slabs, tilted or not. It reads as a diagram of a
hill rather than a hill, and every building on it looks bolted to a shelf.

Three things fix it and all three are needed: make the main landform thick -
several times a player's height, not a plate; step the tops to clearly
different heights rather than evenly; and push each mass out past its
neighbour **on one side only**. That asymmetry is the mechanism. Rotating the
slabs is the finish, and on its own it does nothing.

One run built a village on stilts because it placed buildings at guessed
heights over a displaced grid. Terrain kept as a function you can query, with
everything shrinkwrapped onto it, removes the whole class of error.

## 4. A route in doubt

The player walks in and every direction looks equally plausible, so they stand
still. This is the failure that separates a level from a diorama, and it is
invisible in every still render - which is exactly why it survives.

The evidence is a village A/B run on the same reference and the same model.
The version driven by placement data produced a diorama: boxes on a spread map
with no river and no paths. The version driven only by the craft questions -
where is the river, where do the paths run, where does the player enter, what
stands on the mound - produced a place, with a route from the gate to the hero
building. Same picture, same model; the difference was entirely in what the
skill asked for.

Walk it at eye height, five frames along the route you intend, and ask the
question out loud.

## 5. Clump and void

Dense within a few metres of the hero, bare everywhere else. It happens
because the hero is the interesting part and attention runs out.

Every metre the player crosses earns its screen space. If a stretch has
nothing in it, either put something there or make the level smaller.

## 6. Floating, sunk, interpenetrating

A house inside its own wall survived five passes and a full rubric on one
village run, because no render shows it. Footpaths above the terrain, a stair
detached from its landing, a bridge ending in air - all of them look fine.

The quiet member of this family is the **overhang**: a mass that touches what
it stands on but hangs off the edge of it. A plinth with a corner over its
terrace, a bench half off its deck, a lantern base out over a stair nose.
Every contact check passes it, an overview render hides it, and at gameplay
distance it reads as a modelling error and pulls the eye off the whole frame.
Test that the *whole* footprint is contained, sample it on a grid rather than
at four corners, and keep a declared list of the overhangs you meant - a
balcony, a jetty, a cantilevered bridge - so the check flags only accidents.

Check numbers, not pictures. And prove the check bites: move one mass into
another deliberately and confirm it complains. Every hand-written audit in
these runs passed its first deliberate break.

## 7. Review images that show nothing

A camera jammed against a near wall renders a clean, useless picture and will
not say so. Interiors are worst: the plan view of a room is a photograph of
the ceiling unless the ceiling slab **and** the joists, ducts, lights, signs
and cables are hidden first.

If you cannot name what a frame shows, the camera is wrong, not the level.

## 8. Trusting your own score

Three builds scored by the model, then blind by a working artist: 6.3 vs 0.4,
7.6 vs 6.1, 6.6 vs 3.9. The order was right every time; the numbers were 1.5
to 6 points high. Score to rank this pass against the last, never as a pass
mark.

## The cost evidence behind the build rules

One parameterised script re-run every pass costs 76 tokens of context per
part. Patching a live scene object by object costs 681. Every turn re-reads
the whole context, so the real cost is turns times context - which is why
`SKILL.md` asks for one script rewritten whole per pass, one Blender run per
pass, and one review sheet per pass rather than every render.

## The builds that skipped Stop

Builds made from memory rather than from the reference in front of them
scored 0.4, 3.9 and 6.1 out of 10. The two disasters failed on things the
picture answers for free.
