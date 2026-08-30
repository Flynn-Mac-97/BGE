# Entities and behaviours

> One of the engine design docs — the index is [ARCHITECTURE.md](../ARCHITECTURE.md).

## An entity

Flat. No nesting, no `GetComponent`, nothing to walk.

```js
{
  id: 'coin-2', type: 'coin',
  x: 9.5, y: 4, z: 0, rotation: 0, scale: 1,
  properties: { value: 50, spin: 120 },
  overrides: ['value'],              // what THIS placement changed
  sprite: { image: 'coin.png', width: 0.5, height: 0.5 },
  collider: { circle: 0.22 },

  float: { speed: 2, amplitude: 0.3, base: 4 },   // one attached behaviour's bag
  behaviours: [ { name: 'float', definition, bag, own, overrides } ],

  _definition: <the module exported by types/coin.js>,
  _setByPlacement: { sprite: false, collider: false },   // did the placement set these?
  _detached: Set { },                             // type behaviours this one refuses
  _extraKeys: { }                                 // placement keys we do not model
}
```

`_definition` is a live pointer to the type file's export. That is why editing
`coin.js` changes every coin at once — and why hot reload has to re-point it, or
your edit silently does nothing.

`_extraKeys` exists so a save never narrows a file. Anything the placement carried
that the entity does not model is written straight back out.

### Which way a body is facing

Two names, and they are not a duplicate — they are the two places a facing comes
from. `rotation` is the editor's handle, in **degrees** about Y, because degrees
are what an author types into an inspector and reads back off a level file.
`yaw` is what game code sets while the world is running, in **radians**, because
radians are what every other angle in the engine is in: the camera's aim, a
raycast, the answer `Math.atan2` gives.

The renderer draws by `yaw` when there is one and falls back to `rotation`. So a
type that turns to face where it is running writes `entity.yaw` and nothing else.

### A body made of boxes

`mesh` takes one box, one quad, a loaded model — or `parts`, a list of boxes that
are drawn as one entity:

```js
mesh: {
  tint: '#e8a55c',
  parts: [
    { box: [0.42, 0.30, 0.54] },                                  // body, centred
    { box: [0.30, 0.28, 0.26], at: [0, 0.22, -0.31] },            // head, in front
    { name: 'legFrontLeft', box: [0.1, 0.16, 0.1], at: [-0.13, -0.145, -0.2] }
  ]
}
```

`at` is metres from the entity's centre, `rotation` is degrees about X, Y and Z,
and a part inherits every other key of the mesh. Forward is -Z, the direction the
camera faces at yaw 0. A **named** part is swung by `entity.pose`, exactly as a
named node of a loaded model is — `pose: { legFrontLeft: 0.4 }` is a run cycle
whether the body came out of a file or out of this list.

## Types and placements

A type says what a thing *is*. A level says where things *are*. Overrides stay
plain JSON in the level, so a diff is readable:

```json
{ "type": "coin", "at": [9.5, 4, 0], "properties": { "value": 50 } }
```

`properties` doubles as the inspector schema. Declared once, in code, with no
separate serialisation annotation and no editor metadata.

## Behaviours

The one form of composition, and the only concept added to the entity model
since the engine started. A behaviour is a file shaped exactly like a type,
minus the art:

```js
// project/behaviours/float.js
export default {
  about: 'bob up and down around where it started',
  properties: { speed: 2, amplitude: 0.3 },
  start(entity, context, self)           { self.base = entity.y },
  update(entity, seconds, context, self) {
    entity.y = self.base + Math.sin(context.time * self.speed) * self.amplitude
  }
}
```

Duplication costs more than composition: copying `float` into five type files
means five reads, five edits, and one of the five silently diverging when
somebody updates four. A shared file is read once and edited once.

Four rules keep this from becoming a component system:

1. **A behaviour is a type without art.** Same four hooks, same `properties`.
   There is nothing new to learn, and no second lifecycle.
2. **Each one gets its own bag**, `entity.float`, handed to its hooks as
   `self`. Declared properties start in it and running state stays in it, so
   two behaviours can never collide over a name and neither can collide with
   the type's properties. `float` and `spin` both have a `speed`; neither can
   see the other's.
3. **Attaching is plain JSON in a file.** `behaviours: ['float']` in the type,
   or `"behaviours": { "float": { "amplitude": 1.5 } }` on one placement.
   Nothing is wired in an editor and stored somewhere you cannot read.
4. **A behaviour cannot look up another behaviour.** There is no
   `getBehaviour`. Two that must agree do it by reading and writing plain
   fields on the entity. This is the rule that does the real work — it is what
   stops an execution-order settings screen from ever being needed.

Order is the order they are written, and the type's own hooks run **last**, so
a type always gets the final word on what it composed.

A level records only what the *placement* decided — what it added, what it
changed, what it took off with `"float": false` — never the list inherited from
the type. So a diff shows a decision instead of a copy. An attachment naming a
file that is not there is kept, reported, and healed the moment the file
appears; dropping it would delete the author's work over a typo.

## The runtime vocabulary

Four features, four declarations, all following the same rule: **data in the
type file, one flat key, a string when simple and an object when detailed.**

```js
// types/player.js
sprite: { sheet: 'player.png', size: [16, 16], width: 0.9, height: 0.9 },
animation:   { idle: 0, walk: { frames: [1, 2], framesPerSecond: 8 }, jump: { frames: [3], loop: false } },
sounds: { jump: 'jump.wav', hurt: 'hurt.wav' },
```

```js
// and in update():
e.animation = !e.grounded ? 'jump' : move ? 'walk' : 'idle'
e.flip = move < 0
e.play('jump')
context.camera.shake(0.35)
```

Animation is **assignment, not `play()`**. Setting the same value every frame
does nothing, so an update hook can say what the entity *is* doing without
tracking what it *was* doing — the bug every hand-rolled animation controller
has.

Camera and HUD are declared in the **level**, because following the player and
showing a score are properties of the level, not of the player:

```json
"camera": { "follow": "player", "lerp": 0.12, "lookAhead": 0.3, "bounds": [0,0,30,12] },
"hud": [
  { "text": "SCORE {score}", "at": [14, 12] },
  { "text": "{coins} COINS LEFT", "at": [-14, 12], "anchor": "top-right" }
]
```

`{name}` reads `world.state.name` — the same shared state game code already
writes to — so a HUD needs no wiring.

Two rules the HUD follows that are easy to get wrong:

- It is drawn into a canvas, not CSS. A DOM overlay would be a second renderer
  with its own coordinates, invisible to `snapshot()`, absent from a screenshot,
  and different again inside a sandboxed iframe.
- The game camera and the editor viewport are different things. The editor's
  view is saved on play and restored on stop, so pressing play never loses your
  place in the level.

Audio records every play whether or not it is audible, so a headless
`simulate()` still answers "did the coin make a noise" — `engine.run('audio.recent')`.
