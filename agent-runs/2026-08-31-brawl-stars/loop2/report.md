# Loop 2 — Kitten Survivors against Brawl Stars

Five lanes, all merged. Build is 7 of 7 game tests, 44 of 44 engine tests,
`check` clean. The blind critic picked the shipped game again and moved the
grades barely at all.

## Grades, loop 1 against loop 2

| | loop 1 | loop 2 |
|---|---|---|
| player readability | 2 | 3 |
| enemy readability | 3 | 4 |
| ground | 2 | 2 |
| props | — | 2 |
| colour and light | 3 | 3 |
| composition | 2 | 2 |

Five lanes of real work moved two numbers by one point each. That is the finding
of this loop, and the reason is below.

## What the lanes actually did

- A constant screen-space keyline and a contact shadow on everything that moves,
  for +30 draw calls and one instanced draw. `edgeDensity` fell.
- Six creature silhouettes, each making a claim no other family makes, and the
  horde held under 0.38 luminance against a 0.92 cat.
- A painted ground texture guarded at build time, decals, and a generator that
  now fails its own build if a placement leaves the value band.
- The title screen torn down, menus blurred instead of crushed, eleven upgrade
  glyphs redrawn.
- The muzzle flash cut from covering 20.3% of the player to 4.2%.

## Two errors of method, both mine

**The critic never saw the ground rings or the nameplates.** They are drawn on
the 2D screen layer, and I captured the judgement frames with `ui:false`, which
strips that layer. So the critic's first finding — that no actor wears the
reference's three-part kit of keyline, ground ring and nameplate — is partly a
description of my capture, not of the game. This is the second loop running that
a critic verdict has been shaped by what I left out of the frame.

The fix is not to remember harder. A ground ring under an actor is a world
object, not interface, and it should be drawn in the scene where `ui:false` and
a stated size cannot remove it.

**I predicted the keyline would close `real-tonal-range` and it did not.**
`value.spread` went 0.243 to 0.153, worse. The reason is the crowd: at 0:32 the
horde holds 39 alive and about 5 are in frame, so the picture is nearly all
mid-tone ground with no dark end. The broken ruling and the off-screen crowd are
one problem, not two.

## What the critic got right, checked against the engine

- Props are untextured cuboids at arbitrary rotations. True. They are inside
  their value band and still read as boxes, because a band is a value contract
  and says nothing about material or silhouette.
- Ground and props share a hue family. True, and the reference does the
  opposite: one warm neutral floor, and not one actor or crate in that family.
- The keyline cannot separate the horde. 93 keylines render every frame — the
  critic was wrong that there are none — but the line is near-black and the
  horde is 0.14 to 0.33, so a dark line on a dark body adds nothing. The
  reference puts near-black outlines on **mid-value saturated** bodies. Loop 2
  pushed the horde dark to clear the bright ground; that decision and the
  keyline work against each other.
- Nothing reads as grounded except what the contact shadow reaches. Gems, which
  now settle, do; props, which never move, do not.

## The three-way allocation, restated

The reference separates figure from field with an outline and a ring, not with a
value gap. Ours currently spends the whole value range on separation and has
none left for tone:

- ground 0.62 to 0.72, props 0.46 to 0.70 — overlapping
- horde 0.14 to 0.33, cat 0.92

Props sitting inside the ground's band is the error the critic named first.

## Engine faults fixed during the loop

Nine, on top of loop 1's twelve. The ones that were changing measurements
without saying so:

- Particles drew from the **simulation's** random stream, so adding a dot to a
  burst moved where enemies spawned. A visual change was a gameplay change.
- A reply carrying an `error` field exited 0, so a script ran its next step
  against whatever the last one left on disk — a capture that wrote nothing was
  measured as though it had.
- `servers.stop` with no port stopped every parallel lane's server.
- `kitten.arc '{"seconds":30}'` silently played 120 seconds.
- Every bridge error named port 5180 whatever port was asked for.
