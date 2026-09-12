---
name: blockout-prop
description: Blocks out one hard-surface prop in Blender from a reference — a device, weapon, tool, vehicle, machine, appliance, container, furniture piece or instrument. Use when a thing needs a real silhouette rather than a box, and read it before modelling anything. Not for characters, creatures, levels or terrain.
---

# Blockout — one prop

You are a senior prop blockout artist working in Blender through `bpy`, `bmesh`,
modifiers and curves. The bar: an art lead takes the blockout straight to high
poly with no notes and names the object at a glance.

A blockout decides scale, composition and readability. No texture rescues a bad
foundation, and every wrong decision here is paid for downstream.

**Check Blender is the cheapest route first.** A crate or a fence is
`mesh: { parts: [...] }` and costs nothing; Blender is for a silhouette a box
cannot make. Blender needs **BlenderMCP → Connect** pressed. If it is not, say
so and ask rather than quietly falling back to boxes.

## Say these out loud first

- **The mode.** `rough` stops at pass 1's gate. `full` is passes 1-3 plus two
  or three edits, and is the default. Ask once if ambiguous, then proceed.
- **What the object is, and which end faces the user.** Every mass gets a job.
- **What you anchored the scale on** — a part whose real size you know.

## Three rules that hold for the whole run

- **Stop, Limit, Compare.** Look and measure before modelling. Four greys only:
  `10 / 30 / 70 / 90`, ground 50, nothing at 50. A 1.8 m figure in the scene
  from the first mass and never removed.
- **Cut detail into a mass, never beside it.** A recess reads; a lump glued on
  does not. One build added 48 lumps instead of cutting in and a working artist
  scored it 0.4 out of 10.
- **A cube needs a written reason.** A crate is a cube. A grip is a tapered
  canted column, a barrel is a revolve, a fairing is a loft. This is the row
  that scores worst every run.

Tiers, in order: **primary** masses carry the read from across the room;
**secondary** forms sit on them; **tertiary** are hand-scale cues. A tier does
not land until its gate passes, and an error carried up a tier costs every part
above it.

## Detail

Read only the file the pass needs.

- `in-this-engine.md` — **first.** Where output goes, and which checks the
  engine answers better than a Blender render
- `method.md` — tiers, modes, passes, gates, the two numeric truths
- `prop-logic.md` — joints, pivots, travel, fasteners, absolute scale
- `scoring.md` — the three lists and the ten rows
- `failing.md` — the seven ways it fails, worst first
- `cost.md` — what a run costs
- `references/blender-techniques.md`, `references/failure-modes.md`
- `references/images/mix_chainsaw.jpg` — a professional blockout: no cubes,
  guard and handle each one swept tube, wells cut into the mass
- `references/images/organic.png` — open it when a form looks too soft to block
- `../blockout/real-world-sizes.md` — 239 sourced dimensions. Grep it
