# Judging a clip

Read a motion as numbers and words before looking at a picture of it. Both
commands run headless, from the clip and skeleton files.

```sh
node bin/engine.mjs --headless --project <game> run rig.faults '{"type":"player","clip":"stab"}'
node bin/engine.mjs --headless --project <game> run rig.faults '{"file":"motion/fighter/take-stab-a.json","skeleton":"motion/fighter.skeleton.json"}'
node bin/engine.mjs --headless --project <game> run rig.pose '{"type":"player","clip":"stab","at":0.4}'
```

- `rig.pose` gives one moment: each elbow's and knee's bend (0 straight),
  where each hand is (above the head, at the shoulder, at the chest, at the
  waist, low) and how far ahead of the chest, the spine's lean, how far the
  hips crouch, which feet are planted, and where the weight is. `words` says it
  in one line: compare it with what the move should be.
- `rig.faults` lists what is wrong, each with the seconds, the number, the
  limit and the usual fix, and the words of the first, middle and last frames.
  `isClean` is true with none.

| fault | means |
|---|---|
| `hover` | the whole take stands above its floor |
| `slide` | a planted foot moves over the floor (Kimodo skates feet; NVIDIA says so) |
| `float` | both feet off the floor while the body stands |
| `through` | a hand or elbow inside the torso |
| `jitter` | a hand, elbow or the head zigzags frame to frame |
| `balance` | the hips outside the planted feet while standing |
| `pop` | a loop's last frame does not meet its first |

Limits are for a 1.7 m body and scale with the rest pose. A foot is planted
against the take's own floor, its lowest foot, so a take that hovers still
reads its steps. Code: `rig-animation/clip-reading.js` (joints by role, any
humanoid rig), `pose-facts.js`, `motion-faults.js`, `motion-review.js`.

Judge every Kimodo take this way before `kimodo.use`: keep the take with the
fewest faults, and fix the rest with constraints (Kimodo guide).
