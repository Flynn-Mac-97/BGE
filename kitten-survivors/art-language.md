# The art language of Kitten Survivors

One meadow, one dusk, one cat about to be swarmed. Everything anyone makes for
this game has to belong to that picture. This is the whole of it: read it once,
build to it, and four people's work will look like one game.

The arena that this describes is `levels/meadow.json`, built by
`tools/make-kitten-survivors-meadow.mjs`, textured by
`tools/make-kitten-survivors-textures.mjs`. If a rule here and the meadow ever
disagree, the meadow is wrong and this is right.

---

## 1. The unit, and where the ground is

**One unit is one metre. The top of the ground is y = 0.**

`at` is the CENTRE of a box, so a thing of height *h* standing on the ground is
placed at `y = h / 2`. A mesh may instead declare `anchor: 'feet'`, and then its
`y` is the ground it stands on — but the anchor moves what is drawn and NOT the
collider, so anything solid is placed by its centre.

The cat is the ruler. It is 0.8 m long, 0.5 m wide and 0.45 m tall, and moves at
5 m/s. Read every other size against it:

| | metres |
|---|---|
| a flower head | 0.3 |
| a grass tuft | 0.26 – 0.5 |
| **the cat** | **0.45 tall** |
| a rock | 0.2 – 0.5 |
| the field's ceiling — see rule 2 | **0.5** |
| a fence post | 1.4 |
| the boundary bank | 1.5 |
| a hedge | 3.0 |
| a tree | 6 – 12 |
| the barn | 8.8 |

The play field is **90 m square**, centred on the origin, bounded by a solid bank
at ±46.5. Nothing spawns within **7 m of the origin** — the player starts there
and has to read it clean.

---

## 2. The silhouette rule, which outranks everything else here

**Inside the fence, nothing the arena draws is taller than 0.5 m.**

The camera looks down at about 60 degrees, so a thing of height *h* hides roughly
*2h* of ground behind it. Half a metre hides one metre, which is less than one
enemy. A fence post at 1.4 m hides nearly three metres — three enemies the player
never saw coming, in a game whose entire skill is reading the crowd. So the field
gets tufts and the fence gets posts, and every metre of height in this level is
outside the boundary where nothing the player has to fight can stand behind it.

The level generator **fails its own build** if a prop inside the fence breaks
this. Do not raise the ceiling; put the tall thing outside.

Two consequences worth stating on their own:

- **Landmarks are drawn in the floor.** A survivor's player must know where they
  are while looking at a hundred enemies, and the usual answer — a tower, a
  statue, a great rock — is the one thing this camera cannot afford. So the
  meadow's landmarks have no height at all: a mown clearing, a ring of set
  stones, a cart track. They read from anywhere and hide nothing. Anything you
  add for orientation should be flat too.
- **Nothing in the field collides.** Scenery has no collider. Every solid thing
  inside an arena is somewhere the crowd can pin the player, so the meadow's only
  colliders are the ground, four boundary banks and two gates. Keep it that way.

---

## 3. The palette

Fourteen surfaces, and they are the whole world. Reference a texture by its bare
name: `meadow/grass.png` resolves to `kitten-survivors/assets/meadow/grass.png`.

**The ground** — the quiet half, and never allowed to compete.

| surface | average | for |
|---|---|---|
| `meadow/grass.png` | `#3d7e37` | the field, everywhere |
| `meadow/grass-mown.png` | `#519942` | cut grass, the light end |
| `meadow/grass-dry.png` | `#8a964b` | gone over, the warm end |
| `meadow/earth.png` | `#684f35` | the cart track, the pond edge |
| `meadow/moss.png` | `#355f3c` | shade under the hedge |
| `meadow/pond.png` | `#465475` | still water |

**The structure** — what stands up.

| surface | average | for |
|---|---|---|
| `meadow/leaf.png` | `#2e6434` | hedge, canopy, dark tufts |
| `meadow/stone.png` | `#625f72` | rocks, set stones |
| `meadow/timber.png` | `#6a553f` | posts, rails, gates |
| `meadow/bark.png` | `#3b2b20` | trunks, fallen wood |

**Outside the fence only** — the three warm surfaces, and they are far away and
half eaten by fog.

| surface | average | for |
|---|---|---|
| `meadow/barn-board.png` | `#90362b` | the barn, the one red in the world |
| `meadow/roof-shingle.png` | `#363546` | roofs, the silo |
| `meadow/hay.png` | `#b09145` | bales |

**Four flat colours**, for things too small to be worth a texture:
`#5ea84a` light tuft · `#d8c250` gold flower · `#d9d4bd` cream flower ·
`#a86f9c` mauve flower.

### The rule that keeps the game readable

**The arena owns green, earth and violet-grey. Warm saturated colour belongs to
the game.**

Enemies, pickups, damage numbers, XP gems and weapon effects are the only things
allowed to be bright and warm. Everything the arena draws inside the fence sits
under about 55 % value and 45 % saturation — quiet enough that one red enemy on
it is the brightest thing on screen. The first version of the ground broke this
with untinted straw and untinted earth, and from above it read as sheets of
yellow and red paper thrown on a lawn.

A tint **multiplies** its texture, so it can only ever darken or shift a hue —
a surface lighter than the field has to come from a lighter texture, not a
lighter tint. `#ffffff` means "as painted".

---

## 4. The light

Declared in `meadow.json`. Do not add lights without a reason, and never a second
shadow — the engine draws exactly one.

```
key      light entity "key-light", directional, #ffe0bc, intensity 1.35
         direction [-0.78, -0.56, -0.28], range 96, shadow: true
fill     world.sun, #9fb0dd, intensity 0.28, direction [0.55, -0.45, 0.7]
ambient  #8b93cc, intensity 0.55
fog      exponential, density 0.011, #4a3d68 — half washed out at 76 m
sky      meadow/sky-dusk.png, a panorama, sun bloom at u = 0.375
```

Three things about it that are decisions rather than numbers:

**Dusk is a colour decision, not a sun-angle one.** A real evening sun sits a few
degrees off the horizon and throws shadows twenty metres long, and twenty metres
of shadow across a field full of enemies is twenty metres the player cannot read.
The key sits at about 60 degrees — short shadows — and every bit of the evening
comes from its colour, from the cool violet ambient it is set against, and from
the sky behind it. It started at 34, and at 34 the hedge and trees just past the
east fence raked their shadows metres into the play field; anything outside the
fence is taller than anything inside it, so the fence line sets the floor on how
steep the key must be.

**The key comes from the right, not from behind the camera.** Aimed away down the
view axis it lit every face the player sees and threw every shadow directly
behind the thing that cast it: a full extra render per frame and not one visible
shadow. From the side, each shadow lies across the ground beside its prop, which
is the only thing that says a tuft is standing up and an earth patch is lying
flat — and it puts the cat's own shadow beside it, so the cat reads as being ON
the field rather than drawn over it.

**The key is nearly white.** A strongly coloured key at high intensity pushes
every surface's hue apart instead of holding the picture together; at `#ffc078`
and 1.85 the straw patches came back orange and the earth came back red. The
warmth belongs to the sky and the fog.

Warm point lights are for places worth walking to, and there are three: the barn
window, the campfire outside the south gate, and the glow-worms by the pond. Any
you add should be small, warm, and attached to something visible.

---

## 5. The material, and how a thing is made

Every surface in the meadow is the same material, and that is deliberate:

```json
"mesh": { "box": [w, h, d], "material": "toon", "steps": 4, "outline": 0.22,
          "texture": "meadow/grass.png", "tiling": 1 }
```

Four bands of banded light with a light rim. The screen will be full of enemies,
and a surface with a smooth gradient on it is a surface the eye keeps checking;
four bands and it is read once and dismissed. `tiling` is a **density** — one
repeat per metre — so the same texture reads at the same scale on a 150 m field
and on a 3 m patch.

**Everything is boxes.** The renderer draws `box`, `quad` and loaded `.glb` models
and nothing else — no cylinder, no cone, no sphere. And an entity can only be
turned about **Y**, in degrees; there is no pitch and no roll anywhere in the
level format. So:

- A tree is a trunk box and three canopy boxes, stepped up and offset. Three
  rather than one because one box is a hedge, and the only thing a silhouette can
  have here is a change of width up its height.
- The barn's roof is a stair of five boxes, because a slope cannot be authored.
- An irregular edge is made by **overlapping** rectangles until no single outline
  is visible. It is the only tool this renderer gives you, so use it hard.
- Turn every prop to a random angle. A field of axis-aligned boxes reads as a
  spreadsheet; the same boxes at random yaw read as a place.

If you add a `.glb`, it must match this: chunky, flat, few faces, and painted in
the palette above. A smooth, softly-shaded model will look like it wandered in
from another game.

**Never put a `tint` on a type.** A placement's `mesh` merges into the type's key
by key, so a default tint is not a fallback — it multiplies into every textured
placement that did not override it. One placeholder purple on the scenery type
turned the entire meadow into a violet night.

---

## 6. What each lane owes this document

- **The cat.** 0.45 m tall, warm sand `#e8c88a`, and the ONE thing on screen
  allowed to be both light and warm. It must stay legible against `#3d7e37` grass
  from directly above. Give it a silhouette that survives being one of a hundred
  moving things: ears, a tail, a shape that is not a box.
- **The camera.** Looks down at about 60 degrees from roughly 14 m, seeing about
  50 m across. Everything above is calculated from that; if the pitch or the
  height changes a lot, the 0.5 m ceiling has to be recalculated with it. Note
  that the game camera currently sits AT the followed entity rather than behind
  it, so play opens at grass level — that is a camera bug, not an arena one.
- **The horde.** Enemies own warm saturated colour. Keep them 0.4 – 0.8 m tall so
  a crowd reads as a crowd and not as a wall, and let them be the brightest thing
  on the field. Spawn them outside the 7 m start circle. The field is flat and
  free of colliders on purpose: pathing never needs to avoid scenery.
- **Weapons and effects.** Use `material: 'additive'` for anything that is light —
  the campfire and the glow-worms already do, and the level's bloom is set to a
  threshold of 0.95 so that only genuinely bright things bloom. Do not raise it:
  at 0.78 it caught the lit grass and the whole field came back orange.
- **XP and upgrades.** Pickups are the other thing allowed to be bright. Cool and
  bright — cyan, white-gold — so they never read as an enemy at a glance.

---

## 7. Changing the arena

Edit `tools/make-kitten-survivors-meadow.mjs` and re-run it. The level file is
generated: it is ordinary placements the editor can select and drag, but the next
run of the tool overwrites whatever was saved there. Textures are the same story
in `tools/make-kitten-survivors-textures.mjs` — both are seeded, so a re-run with
nothing changed rewrites the same bytes.
