# See — the next loop's backlog

Open items, newest first. Written 2026-08-30, after the finish-line loop.
Each says what the problem is, what already exists, and how it would be
judged. Nothing here is implemented.

## 0. How the next loop must test — binding

USER, 2026-08-30, after finding the plugin's tests measured the wrong thing.

The finish-line loop scored itself on four fixed questions with known answers,
and an independent critic then answered all four with a script that never
opened the picture. Every question was a field read. The loop passed a row
called "grounded vision reads" without any vision happening.

The test that actually worked was one the owner asked by hand, unplanned:

> what is floating in the scene now?

That probe is the model for the next loop, and it is worth saying exactly why
it was good. It named no verb and no file. It was phrased the way a person
speaks, not the way an engine is driven. It was open — the answer was not in
the question, and there was no list to choose from. It was asked against a
live scene holding a real defect nobody had planted. And it was diagnostic:
the answer was a fault, not a fact.

### What the next loop must do

**Many probes, not four.** A dozen or more, in a person's words, each with a
true answer established independently before any agent is asked. Vary the
shape: identify a thing, find a fault, judge whether something looks right,
answer that nothing is wrong.

Probes of the right kind, as a starting set — extend it:

- what is floating in the scene?
- what are those two blue blocks?
- does the rat model look ok?
- why does the level look wrong?
- is anything sunk into the floor?
- what is the big thing blocking the middle of the screen?
- is the lighting broken or is it meant to look like that?
- how many enemies can the player actually see right now?
- is anything on screen that should not be there?
- does this look finished, or does it look like programmer art?
- what is the player standing on?
- is anything hidden behind something else?

At least two probes must have the honest answer "nothing is wrong". An
evaluation where every probe hides a fault teaches an agent to invent one.

**Weak models, on purpose.** Run the probes on the cheapest tier. See exists
so a cheap agent answers correctly; a plugin only the flagship can drive has
failed. Watch two things separately: whether it used See at all, and whether
using it produced a true answer. Those come apart — this loop had an agent
use `see.capture` correctly and then report a colour that was not in the
picture.

**A control, and this is the part that cannot be skipped.** Ask half the
agents the same probe with no See guide and no skill listing — let them solve
it however they like. Then compare truth rate, tool calls and tokens. Without
a control there is no evidence See helps, only evidence it was used.

That gap is real today. The floating meadow was found with
`snapshot --entities` and arithmetic, not with See. See vetoed a wrong
conclusion and made the answer legible in one frame, which is worth
something — but the diagnosis came from outside the plugin, and no number in
this repo says the plugin is faster or truer than the plain route. Get that
number.

**Fixtures with known answers.** Plant defects deliberately so ground truth
is certain: a texture that fails to load, a prop scaled ten times too large,
an entity under the floor, an enemy hidden inside a wall, a light removed.
Restore every fixture in a `finally`. Never leave a planted defect in a level.

**Score what matters.** Correct answer, yes or no. Calls to reach it. Tokens.
Whether the reply named its evidence or asserted. Whether a wrong answer was
given confidently — that is the worst outcome and must be scored worse than
"I could not tell", because an agent that knows it does not know keeps
looking.

This replaces the four-question probe as the way row 2 is judged. Changing
the matrix row is the owner's call; running better probes alongside it is not.

## 1. Ask the camera, not the entity list — a ray verb

USER, 2026-08-30. The strongest item on this list.

**The problem.** Every See query is camera-relative in SCREEN space and
entity-driven in world space. `see.find` takes `region`, `sizeOver/Under`,
`depthOver/Under`, `cutUnder`, `occludedOver/Under`, `within` — all
projections. So a structural fault in world space is invisible unless the
caller happens to aim a camera that reveals it, and the only way to find one
is to dump every entity and do arithmetic outside the plugin.

That is what happened. Asked "what is floating in the scene", the answer took
a full `snapshot --entities` of 900 entities, a filter on y, a grouping by id
prefix and two captures. The defect — the meadow scenery authored around
y = 0 while the collision floor sits at y = -6.5, so the whole meadow floats
six metres above the play surface — is arithmetic on world positions. No See
verb could ask it.

**The proposal.** Cast rays from the camera and report what they pass
through, in order. A question asked from a view is answered from that view.

- `see.ray '{"at":[62,40]}'` — one screen point, as percent. Answers every
  entity the ray passes through, nearest first, with distance. Not just the
  first hit: the ordered list is what makes it useful.
- `see.ray '{"grid":[8,5]}'` — a grid of rays over the frame. Forty rays
  instead of nine hundred entities, and the reply is only what is really in
  front of the camera. This is the literal answer to "what is this scene I am
  looking at".
- `see.ray '{"from":"you","direction":"down"}'` — a support test. What is
  under this thing, and how far. The floating meadow falls straight out of it:
  a ray down from the kitten hits the floor at six metres with nothing between,
  and a ray down from a patch hits nothing at all.

**Why it beats dumping the scene.** The dump is proportional to the whole
level and blind to the camera; rays are proportional to the ray count and true
to the view. The reply is small, which is the plugin's whole thesis. And it
answers in the frame of reference the agent actually has — a view and a
screen position — rather than making it translate into entity ids first.

**It also answers the blue blocks.** A ray at a screen point gives the entity
id; `description` then says what the author says it is. That is the whole
pixel-to-identity path in two calls, and it needs no new concept.

This supersedes the `see.whatIsThis` sketch from earlier the same day. One
primitive answering several questions beats a bespoke verb for each.

**What already exists — do not rebuild it.**
- `rayBox(origin, direction, box)` — `engine/scene-query.js:20`. The
  primitive, already written and already used.
- `occlusionGrid(eye, subject, others, rows, columns)` —
  `engine/scene-query.js:56`. Casts a grid of rays from the eye, but only
  TOWARDS a subject that is already known. The missing half is casting through
  the frame with no subject in mind.
- `makeProjector(view, viewport)` — `engine/camera-project.js`. Screen percent
  to a world direction is its inverse, and the renderer derives its camera
  from the same view fields.
- `idMap(context).at(x, y)` — `plugins/builtin/see/id-buffer.js:321`. Returns
  the entity id drawn at a pixel. Exported, correct, and called by nothing.
  In the browser it is truth and should seed the first hit; rays answer the
  rest, and answer everything headless.

**Known limits to state in the reply, not to hide.** Rays hit collider and
mesh BOXES, not drawn silhouettes, so a ray can miss a thin model or hit empty
space inside a box. The ID buffer is exact where a renderer answers; rays are
an approximation where one does not. Say which answered, in `method`, as every
other verb already does. Particles, decals and HUD overlays are not entities
and no ray can name them — say that too, rather than answering `null`.

**Judged by.** Ask "what is floating" and "what is at this spot" on the
meadow, with no prior knowledge, and get a true answer in one call each.
Compare the reply's bytes against the `snapshot --entities` route: it should
be smaller by an order of magnitude.

## 2. The invariant nobody checks

The meadow defect was mechanically detectable from the level file alone, with
no agent, no camera and no image, and `check` said `{"ok":true,"problems":[]}`
while it sat committed.

`kitten-survivors/types/ground.js` states its own rule in its doc comment: the
top face is y = 0 when the slab is placed at y = -height/2. `floor` is placed
at y = -6.5 with height 1. A check reading the type's declared invariant
against the placement would have failed at HEAD.

Worth deciding: can a type declare an invariant that `check` enforces, rather
than writing it in a comment for a human? That is a bigger idea than one rule
about the ground, and it is the same shape as the description work — a fact
the author knows, written where a machine can read it.

## 3. Descriptions go stale and nothing notices

Three independent designers raised this and it is unsolved. `about`,
`appearance` and `looksWrongWhen` are authored prose sitting beside measured
facts, indistinguishable from them at read time. Change `mesh.tint` and
`appearance` stays confidently wrong forever.

The mitigation shipped is a sentence on every reply saying the text is
authored, not measured, and the suggestion to compare it against a capture.
That is a workflow, not a check. Nothing yet detects the drift.

Worth trying: `check` warns when a type's `mesh.tint`, model path or box
changed in a commit that did not touch its `appearance`.

## 4. Runtime-only types have no description

`projectile` spawns during play, is on screen, and has no `about`. Those are
exactly the objects an agent meets mid-run and cannot name — far more than a
crate placed in a level. `description.missing` reads the type index, so it
cannot see a type that only exists once something spawns it.

Also unresolved: things on screen that are not entities at all — particles,
decals, damage numbers. An honest "this is a particle effect, not an entity,
and nothing can name it" is a useful answer. Silence is not.

## 5. The capture sidecar is over budget

9,829 bytes with `brief` on the meadow at 0:30, against an 8,192 target. The
cause is hull points: 8.7 per marked entity, with duplicate vertices, and a
rat one percent of the frame wide carrying a fourteen-point polygon. Simplify
the polygon in proportion to the entity's screen size and drop repeated
points.

A brief `describe` reply is 7,684 and passes. The sidecar is the artifact that
actually reaches a vision reader, so it is the one that matters.

## 6. Two acceptance rows measure the wrong thing

Both need an owner decision; neither is a lane's call.

**Row 2** is a JSON-parsing test. A script that never opens the PNG scores 4
of 4 on both frames, because every question is a direct field read —
`palette[type]`, a count of `mark`, `occlusions[0]`, `at[0]`. A build whose
renderer drew a black rectangle would pass. It needs at least one question the
sidecar cannot answer: whether a hull follows the model or its box, whether a
marked thing is clipping through the ground.

**Row 3's browser half** names a human clicking the Tests panel, and that
cannot be evidenced by any artifact, so it will always be settled by
substitution. `test.frame` in `plugins/builtin/tests.js` pushes `ok: true`
unconditionally — a blank frame passes, a black frame passes. The only pixel
assertion anywhere is a range check that both extremes satisfy. Make it
machine-checkable and the panel click becomes confirmation rather than the
whole term.

## 7. Engine friction still open

- p154 — the generated skill file regenerates only at dev-server start, so the
  listing a fresh agent reads drifted four commits behind its source while
  `check` passed.
- p155 — `see.capture` and `see.moment` refuse on their first line headless,
  so the most state-mutating code in the plugin has no automated coverage
  anywhere a lane can run.
- p157 — the CLI test suite spawns `_probe_<pid>` entities into whichever
  editor answers and never removes them, so running the tests edits an
  authored level.
- p158 — a restored world cannot rebuild the membership lists plugins keep, so
  a restore is held still rather than run. Remove the hold when this lands.
- p159 — nothing can add a field to `snapshot()` from outside `inspect.js`.
  Patched for the reload note; still true in general.
