## The kit is files, and the scene is a placement list

One script that builds everything works until it does not. A level of a few
hundred masses reaches a size where rewriting the script whole each pass costs
more than the pass is worth, and worse, editing one lamp means opening a file
that holds the whole world. Split it the way the rest of the industry does.

```
<output>/
  kit/
    _common.py        helpers the parts share: revolve, sweep, arch, finish, save
    <part>.py         builds one part, and only that part
    <part>.blend      the result: one collection, named for the part
  checks.py           the audits, and the cameras and gate renders
  build.py            the scene: terrain, links the kit, places instances
```

**One part per file.** Each kit script builds its part and saves a `.blend`
containing a single collection with the part's name. Keep the name of the
script, the collection and the file the same, so one string addresses all
three.

**Link, never append.** `bpy.data.libraries.load(path, link=True)` points the
scene at the collection instead of copying it:

```python
with bpy.data.libraries.load(kit_path, link=True) as (src, dst):
    dst.collections = ["pillar_broken"]
```

Append copies and cuts the cord; link keeps it. Because you rebuild the scene
from an empty file every pass, the link is re-read on every run - so editing
`pillar_broken.py`, re-running it, and re-running the scene is the whole update
loop. The scene script does not change at all.

**The scene script becomes a placement list**: name, position, rotation, scale,
variant, one row per instance. That is what you rewrite whole each pass, and it
is small enough that rewriting it stays cheap no matter how big the level gets.
Placement is also the thing you actually iterate on - the kit settles early,
the layout keeps moving.

**Move the audits and the cameras out too.** They are the other half of what
makes a build script huge, and unlike placement they barely change once
written. One run split its kit properly and still reached 46 KB, because the
checks, the terrain function and the scene-only generators had nowhere else to
go; by its own account the rewrite-whole rule stopped being true at about
20 KB. Keep `build.py` to the terrain, the links and the placement list, and
put the audits, the cameras and the gate renders in `checks.py` beside it. If
either file grows past roughly 20 KB, something in it wants its own file.

**An auto-placed part can grow; a hand-placed one cannot.** A generator that
derives spacing from each part's own bounding box absorbs a part getting bigger
without a single edit to the placement list - one run improved seven kit parts
and not one coordinate, rotation or scale changed for over seventy instances. A
hand-typed position silently encodes an assumption about that part's extent,
and the assumption only breaks when you improve the part: on that same run the
one hand-placed building grew into a square and the capsule sweep reported 21
blocked samples. Keep hand placement for the few things that need it, and when
you change one of those parts, treat its old envelope as frozen and do the
outline work inside it.

**Library overrides for the one that must differ.** When a single instance
needs to be broken, collapsed or opened, override that instance rather than
forking a second kit file. A fork stops receiving your improvements to the
part; an override keeps them.

### What earns a kit slot

Promote a part to the kit when any of these is true, and leave everything else
in the scene script:

- it appears three or more times;
- you expect to keep working on it - the hero building, the landmark, the piece
  the whole read depends on;
- it is one of the archetype's kit pieces, on a grid or isometric map.

A thing that appears once and is finished does not need a file of its own, and
neither does a five-line prop you will never open again, however often it
appears - the count is a hint, not the rule. What you are really promoting is
anything you expect to *edit*. One run promoted seventeen parts and said two of
them were wasted files, written once and never touched.
Over-splitting costs you the same way the monolith did, in a different currency.

### Four traps

- **Finish inside the part file, and apply it.** Bevel, harden normals and
  smooth-by-angle belong to the kit script, at unit scale - finish in the scene
  instead and every scaled instance gets a different bevel width, the
  local-space problem that measured 70.7 mm to 255 mm on one object. But
  **modifiers live on the object, not on the mesh**: a part saved with its
  bevel still unapplied keeps it only for whoever uses the whole object. Reuse
  its mesh datablock and the bevel silently vanishes. Apply the modifiers
  before you save the part. One run lost a whole kit rebuild to this.
- **An instance has no bounds of its own.** A linked collection is placed
  through an empty, so your contact, containment, clash and capsule checks must
  read the *evaluated* geometry from the dependency graph. Measuring the empty
  gives you a point, passes everything, and means nothing.
- **A collection instance cannot take a per-instance material.** The empty has
  no material slots, so the grey each copy renders at is the grey baked into
  the part. That collides with the depth trick of one mesh at several greys, so
  pick your route deliberately: author the part once per grey band as separate
  variants (simplest, and variants are good for silhouette anyway); or link the
  part's **mesh** datablock into local objects you own and set the material per
  object - which gives you the greys but drops the collection's internal
  structure, so use it for single-mesh props, not for a building; or use a
  library override on the instance when you need one copy to differ in more
  than colour.
- **Author each part on its own anchor.** Origin at the point the part is
  placed by: the base centre for something that stands, the meeting face for
  something that butts onto another piece. A part whose origin is wherever the
  modelling happened to leave it makes every placement a guess.
