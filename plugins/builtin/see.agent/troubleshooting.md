# Troubleshooting — route the symptom

- Screen looks wrong (blank, giant colour blocks, one flat colour):
  `see.camera` first. It answers whose box the eye is inside, what sits
  nearer than half a metre in front of the lens, and whether the followed
  entity is behind the camera or contains the eye.
- Thing should be visible but is not: `see.occlusion '{"of":"<id>"}'` —
  `visibleFraction` and `blockedBy` name the hider. Zero blockers? Run
  `see.isolate` on it: `hidden`, `onScreen: false`, or an off-frame world
  position is the answer.
- Something is on screen and you do not know what it is: take `see.capture`,
  read the mark number off the outline, look the mark up in the sidecar's
  `marks` to get the id, then `run description '{"of":"<id>"}'`. That answers
  what the author says it is, what a correct one looks like, and — the case
  that costs the most time — what a BROKEN one looks like. A big featureless
  block of flat colour is usually a `looksWrongWhen`, not a thing you have
  failed to recognise. The sidecar's `about` names every marked type;
  `undescribed` names the marked types nobody has written yet, so silence is
  never mistaken for "nothing to know". `appearance` is deliberately absent
  from the sidecar: a vision model handed a description of a thing will report
  seeing it, so ask the picture the positive question first and compare it
  against `description` yourself.
- Did it move, spawn, or die correctly: `see.diff '{"steps":30}'`.
- Inspect one thing: `see.isolate '{"subject":"<id>"}'` — the full dossier
  in one call.
- Only after these: an image, for judgement a number cannot carry.
