# Checking a character

## `rig.check '{"model":"models/hero.glb","clips":["run"]}'`

Numbers, no picture, every clip of the model when `clips` is left out. `ok` is
true when there are no findings.

| finding | cause | fix |
|---|---|---|
| skeleton is N m tall | import scale | `blender.inspect` gives `scaleForPerson`; set it with `blender.settings`, import again, retarget again |
| feet never reach the floor | the hips are placed too high | check the root entry in the map; a root that is not the hips |
| feet go below the floor | the model's rest floor is not its lowest foot | check `anchor: 'feet'` and the model's origin |
| bones must turn over 100° | a map entry names the wrong joint, or left and right are swapped | fix those entries in `assets/motion/maps/<model>.json` |
| on the wrong side of the body | left and right swapped | same |
| X is N% of body height from where the capture puts it | a wrong bone for that joint | same |
| deforming bones never move | bones outside the map and not near any mapped bone | add them to the map |
| the loop jumps N° | the stored motion has no clean cycle | generate a longer motion (`--frames 200`) |

Also reported: `floor.lowest` and `floor.highest` in metres, `joints.worstShareOfHeight`, `loop.seamDegrees`.
A proportion gap of up to about 0.15 is normal: the capture's joints are not
where a rig puts its bones.

## `rig.compare '{"model":"models/hero.glb","clip":"run","frames":[0,6,12]}'`

Needs the `.blend` beside the `.glb` and Blender. Writes
`agent-runs/rig-compare/<model>-<clip>/sheet.png`: the top row is front, the
bottom row is side, one column per frame. Grey is the model posed by the clip
with constraints muted and B-bone segments at 1, which is what the engine can
draw; orange is the capture, scaled to the skeleton's height.

- Grey limb points somewhere orange does not: the map entry for that limb.
- A piece of the grey body stays still while the rest moves: a deforming bone left out.
- Grey and orange agree, and the game looks wrong: the engine, not the clip. Capture the game with `see.capture` at the same frame.
- Read one sheet per question; it is about 1300 tokens.
