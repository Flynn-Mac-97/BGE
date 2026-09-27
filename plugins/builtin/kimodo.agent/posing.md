# Posing a move by name

Say the key poses; the poser turns them into Kimodo's hand and foot keys.

```sh
E="node bin/engine.mjs --headless --project <game>"
$E run kimodo.poses                                  # the vocabulary
$E run kimodo.pose '{"name":"chop","prompt":"a person chops down hard with a sword","model":"models/fighter.glb","base":"motion/fighter/take-idle-fight.json","seconds":2,
  "keys":[{"at":0,"pose":"guard"},{"at":0.5,"pose":"wind-up"},{"at":0.9,"pose":"strike-down"},{"at":1.8,"pose":"guard"}]}'
$E run kimodo.generate '{"design":"assets/motion/designs/chop.json"}'   # about 2 minutes
$E run kimodo.compare '{"design":"assets/motion/designs/chop.json"}'
```

- **Poses:** rest, ready, guard, high-guard, wind-up, strike-down, thrust,
  slash-open, slash-close, block, lunge, hands-up. A weapon is in the right
  hand; `"mirror": true` swaps sides.
- **Dials:** a key overrides any limb over its pose. A hand is `{ level,
  forward, out }`: level is `above-head`, `head`, `shoulder`, `chest`,
  `waist`, `low` or a height in metres; forward is metres ahead of the chest
  (negative behind); out is metres out from the shoulder line (negative
  crosses the body). A foot is `{ forward, out }` from under its hip.
- **Free limbs:** a limb no key names is left to the prompt.
- **`kimodo.compare`** gives each key's miss in centimetres, the take's pose
  in words at each key (`rig.pose`) and its faults (`rig.faults`). Change the
  keys or the prompt and generate again until the misses and faults are small.
- Keep key poses and the prompt telling one story; keys that fight the words
  are ignored or make artefacts. Fewer than 20 keys per limb.

## From a picture

A person sends a picture of a pose. Read it into the same terms: for each
hand, which level it is at, how far ahead of or behind the chest, how far out
or across; for each foot, how far ahead or behind. Write that as a key over the
nearest named pose, for example `{"at":0.6,"pose":"wind-up","right":{"forward":-0.3}}`.
Several pictures are several keys. The picture is read once; the numbers and
`kimodo.compare` do the rest.

Code: `plugins/builtin/kimodo/poses.js` (vocabulary, dials), `poser.js`
(commands), `pose-compare.js`.
