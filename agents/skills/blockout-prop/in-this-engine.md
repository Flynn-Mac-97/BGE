# Blocking out a prop for this engine

The skill is written for Blender and a generic output folder. This says where
that output goes here, what the engine does with it, and which of the skill's
own checks the engine already answers better than a Blender render can.

## Is Blender the right route at all

`agents/art.md` holds the table and it is read top down. The rows that matter
here:

| the prop is | build it as | costs |
|---|---|---|
| a crate, a fence, a stack of slabs, a barrier | `mesh: { parts: [...] }` — boxes with local `at` and `rotation` | nothing, and it stays editable in the level |
| a thing with a silhouette a box cannot make | Blender, exported as GLB | high, and the only thing that reads as a model |

**A blockout that a `parts` list could have made is a blockout that should not
have opened Blender.** The skill's own worst failure is everything being a cube;
so is spending a Blender run to produce cubes. If the answer is boxes, the
engine is the faster tool and the result stays something the editor can drag.

Blender needs its GUI open and **BlenderMCP → Connect** pressed. If it is not
connected, say so and ask. Do not silently fall back to boxes — that is a
different deliverable and the person asking has to know.

## Where the output goes

| what | where |
|---|---|
| `build.py`, the gate renders, `iterations.md`, `friction-log.md` | `agent-runs/<date>-<subject>/` |
| the exported mesh | `<project>/assets/<name>.glb` |
| the type that uses it | `<project>/types/<name>.json`, made with `run new.file` |

`agent-runs/` is swept after a week and nothing in it is committed, which is
what it is for. Never write a build script at the checkout root, and never add
a markdown file outside the run folder: the findings that must outlive the run
go in the pain ledger, the insight ledger, or this guide.

## Handing it to the engine

- **Metres, and the exporter's Y-up conversion left on.** The engine is metres
  too, so the skill's numbers carry over unchanged. Check the thing arrives
  standing rather than lying down.
- **Apply scale before export.** An unapplied scale makes every bevel and every
  measurement in the engine a different number from the one you checked.
- **Say where the origin is.** An entity's `y` is its centre, which is what a
  box wants. A prop authored standing on the floor, or a weapon authored on its
  grip, must declare it:

```json
"mesh": { "model": "lantern.glb", "anchor": "feet" }
```

  Without that the model floats by half its own height, which reads as a scale
  bug and is not one.
- **Write down what it is meant to be.** `run description '{"type":"lantern"}'`
  reads back what the author said a thing is; the Object Descriptions plugin is
  where the blockout's intent survives the run. Record it, and
  `description.record` freezes the tint, model and box it was written against so
  a later change is caught as drift. This is the engine's version of the three
  lists: without it, the next agent judges the mesh against nothing.

## Checks the engine answers better

Run these once the prop is in a level. They are cheaper than a Blender render
and they measure the thing the player will actually see.

- **The silhouette test, without Blender.** `run see.capture` writes a JSON
  sidecar, and every marked entity's `hull` in it is the **drawn** silhouette,
  traced from an ID pass rather than guessed from a box. Divide that hull's area
  by the area of its own bounding rectangle and you have the skill's form
  fidelity number, measured at the camera the game ships with. One limit: a hull
  is convex, so a C-shape reads as filled. A low score is proof the outline is
  broken up; a score of 1.000 is proof it is a box.
- **Is it the size you think.** `run see.isolate '{"subject":"<id>"}'` gives the
  world box, the screen box and how much of the frame it takes. A prop reading
  as furniture shows up here as a number.
- **Is it hidden.** `run see.occlusion '{"of":"<id>"}'` says how many pixels
  survive and who blocked the rest. A prop nobody can see is not finished.
- **Can it be afforded.** `run profile.frames` twice — the first run measures
  the scene settling. A blockout that cannot be drawn at the count the game
  needs is not a blockout, it is a sculpture.

## What does not carry over

- The skill's 640 px orthos and 64 px thumbnail stay a Blender job. The engine
  cannot frame an asset that is not in a level yet.
- The four-grey rule is a Blender presentation rule. In the engine, greys come
  from `tint` and the material, and `agents/art.md` and the project's art
  language decide the palette. Do not ship a level painted `10/30/70/90`.
