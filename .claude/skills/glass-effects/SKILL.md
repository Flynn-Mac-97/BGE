---
name: glass-effects
description: Generate a runtime visual effect — impact, spell, muzzle flash, explosion, trail, aura, beam — from the engine's own effect kinds, and prove it headless.
---
<!-- generated from agents/skills/effects/SKILL.md at server start; edits are lost -->

# Generating an effect

An effect is four to eight layers with overlapping lifetimes, each simple on its
own. The overlap is what makes it read as one event. Build the table first.

## 1. Name the layers

Write the table first. It decides everything after it.

```
layer     kind                  starts  lasts  why it is there
flash     particles, add        0.00    0.06   the frame the eye locks to
bolt      vfx.beams             0.00    0.35   the shape of the hit
debris    particles             0.02    0.90   weight
smoke     particles, blocks     0.05    1.40   the aftermath, outlives everything
scorch    decal                 0.03    -      what is left behind
punch     impact.hit            0.00    -      the freeze and the shake
```

- **Nothing ends when anything else ends.** Simultaneous endings read as a
  switch being thrown.
- **Fast layers must end early.** A flash that lasts reads as a lamp, not a hit.

## 2. Pick the kind per layer

| The layer is | Use | Not |
|---|---|---|
| A cloud of points — smoke, sparks, dust, blood, debris | `context.particles.burst` | one entity each |
| A line with a direction — bolt, laser, tracer, tether | `context.vfx.beams` | a row of particles, which breaks into dots as the camera turns |
| A mark left on the ground | `context.decals` | geometry |
| The freeze and the shake of a hit | `context.impact.hit({ weight })` | your own timers |
| A light that flashes | `context.lights` | a bright particle |
| Something the whole screen sees | `context.postProcessing` | a huge additive quad |

## 3. Write it where it belongs

- The **look** of a named effect belongs in `particles.define` and
  `vfx.beams.define` — the game's tuning door.
- **When** an effect fires belongs in Combat Effects for engine combat events,
  or in the game's own plugin for the game's own events.
- Never put a game's nouns or a game's tuned numbers in a builtin.

## 4. Obey determinism

- Draw from `context.drawing`, never `Math.random`, `Date.now`, or a wall
  clock. Both fields already do.
- Take one draw whatever the options say, or a visual change becomes a gameplay
  change.
- Use `context.after` and `context.every` for a delayed layer, never
  `setTimeout`.

## 5. Keep it affordable

Overlapping transparent pixels break a frame, not the triangle count.

## 6. Prove it

Effects exist only while a run plays. Bring the moment about, then read the
numbers — never a screenshot.

```sh
node bin/engine.mjs --headless run vfx.state
node bin/engine.mjs --headless run particles.recent
node bin/engine.mjs --headless run vfx.recent
```

Both fields record whether or not anything drew them, so a headless test proves
an effect with no browser. For the picture, use `run see.describe`.

## Detail

Read only the file your task needs.

- `agents/skills/effects/cost.md` — what a layer costs, and the caps
- `agents/skills/effects/new-kind.md` — when an effect needs a kind that does not exist yet
