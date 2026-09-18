---
description: First-person pointer look: pointer lock, sensitivity, yaw and pitch, and the first-person key bindings. Use for any first-person or aimed camera driven by the mouse, and when pointer capture or sensitivity is wrong.
category: gameplay
---

# Mouse Look

- Extends `context.input` rather than replacing it. Two input plugins would
  mean two answers to `held('jump')`, and the one that lost would be the one
  being read. Needs Keyboard Input; without it nothing here registers and the
  reason is logged.
- Three things: pointer lock, the look accumulator, and the first-person
  bindings every other file then uses by name.

## The accumulator

A mouse reports movement whenever it likes, two hundred times a second. The
simulation runs at exactly sixty. Movement is added into an accumulator and
drained once per fixed step, so the two never have to agree on a rate.

| verb | does |
|---|---|
| `input.look()` | radians turned since the last call, `{ yaw, pitch }`, and clears them |
| `input.lookBy(yaw, pitch)` | aim by hand, in radians. The mouse itself comes in this way |
| `input.mouseWheel()` | wheel **notches** since the last call, and clears them |
| `input.sensitivity` | read or set. Positive numbers only |
| `input.locked` | whether the pointer is captured. A plain flag, so headless answers it too |

A test or a bot aims through `lookBy`, the same path the mouse uses, so there
is no second input route to disagree with the first.

## Bindings it adds

`forward` `back` `strafeLeft` `strafeRight` `jump` `crouch` `walk` `attack`
`attack2` `reload` `use` `buy` `drop` `score` `inspect`, and `slot1` upward.

Mouse buttons are named for what they are: `MouseLeft` `MouseMiddle`
`MouseRight` `MouseBack` `MouseForward`. Never write `Mouse1` — the DOM numbers
the middle button 1, so a binding written that way fires on the wrong button
and says nothing.

## What it refuses, and says

- A sensitivity that is not a positive finite number is **ignored** and the old
  one kept. Zero is refused with the rest: it is a dead mouse that still
  arithmetics.
- The accumulator is emptied on `play:started` and `play:stopped`. A stale half
  turn would whip the view round on the first step.
- No canvas means no pointer capture, logged once. `look()` and `lookBy()` keep
  working, so a bot or a test still aims.
- A browser that refuses pointer lock is reported with its own reason.

## Command

- `mouse.sensitivity` — read it with no argument, set it with one. Returns the
  sensitivity with its degrees and radians per mouse count. A bad value throws
  and changes nothing.
