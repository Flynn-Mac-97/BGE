---
skill: art-direction
description: Set a game's visual direction from gathered references instead of taste — measure the references, turn what they agree on into rulings with numbers, generate the art bible, and check a real frame against it. Use before making art for a new game or subsystem, when redesigning a UI or a level's look, and whenever an art rule needs evidence behind it.
triggers: art direction, art bible, art language, style guide, references, reference, moodboard, look and feel, visual style, palette, art style, redesign, restyle, direction, aesthetic, art research, style
match: "*/art/**"
---

# Art Direction

An art document written from nothing is one agent's taste in the shape of a
law. Nothing sourced it, no command tests it, and the game drifts away from it
while it goes on claiming otherwise. This plugin makes a rule carry its
evidence: which references produced it, which field it is measured on, and what
bound it sets. Then `art.check` measures a frame with the same code that
measured the references and names every rule the game breaks.

It never reaches the network. Searching is your job; this owns the shelf, the
measuring and the document.

## Setting up a project's art direction

Run these in order. Each step refuses to be useful without the one above it,
and `art.status` says which step you are on.

1. **Brief.** `art.brief '{"subject":"the meadow arena","reads":"one cat about to
   be swarmed at dusk","camera":"top-down, 60 degrees, 14 m up, sees 50 m"}'`
   Research with no target gathers noise. The camera belongs in the brief
   because it decides what detail is worth paying for.
2. **Gather.** Search with your own tools. Save images to
   `<project>/art/references/`. Aim for five to eight covering the same
   question — three is the floor below which agreement means nothing.
3. **Register.** `art.reference '{"file":"hades-arena.png","source":"<url>","answers":"how does a busy arena stay readable under a crowd"}'`
   `answers` is required. A reference that settles no question is decoration
   and nothing may cite it. `art.reference` with no arguments lists the shelf
   and names image files nobody registered.
4. **Measure.** `art.measure` reads every reference and reports two lists.
   `agreed` is where the references match — that is evidence, and a ruling may
   quote any field in it. `split` is where they disagree, and each line there is
   a decision you owe an answer to. Never average a split; averaging produces a
   look none of the references has.
5. **Rule.** One ruling per decision, and one of three kinds.
   - `"check":"measured"` — a `field` and a `wants` bound. `art.check` tests it
     against a frame.
     `art.rule '{"id":"arena-stays-quiet","says":"Nothing the arena draws goes above 0.45 saturation.","check":"measured","field":"saturation.p95","wants":{"max":0.45},"from":["hades-arena.png"],"why":"every reference keeps the ground under half saturation so one lit enemy is the brightest thing"}'`
   - `"check":"judged"` — no number decides it. No field. Checked by eye.
   - `"check":"derived"` — it follows by arithmetic from the camera, the screen
     or the unit scale. `why` is required because it is the proof, and
     `enforcedBy` names whatever fails a build on it. These outrank the others:
     they hold whatever the style is.

   Do not invent a field to make a taste look measured, and do not call a
   preference derived. Mislabelling a ruling is the failure this plugin exists
   to prevent.
6. **Bible.** `art.bible` writes `<project>/art/bible.md` from the three files.
   Never edit that file; edit the rulings and run it again.

## Checking the game against it

```sh
node bin/engine.mjs run see.capture '{"marks":false,"ui":false,"name":"look"}'
node bin/engine.mjs run art.check '{"frame":"agent-runs/see/look.png"}'
node bin/engine.mjs run art.compare '{"reference":"hades-arena.png","frame":"agent-runs/see/look.png"}'
```

`art.check` returns `broken` and `held` for the measured rulings, and lists the
judged ones without scoring them. `art.compare` writes one sheet, reference on
the left and frame on the right, at one height and unmarked. Ask it a single
forced choice, then ask again with the sides swapped; a flipped answer means
there is no difference to find.

## The measured fields

`value.p05` `value.median` `value.p95` `value.spread` · `saturation.median`
`saturation.p95` · `warmShare` (share of coloured pixels on the warm half of
the wheel) · `edgeDensity` (share of neighbouring pixels that step, so the
detail budget) · `bands` (how many of 32 luminance steps the picture occupies)
· `palette` (the colours by share).

Do not write a ruling on `bands` from full screenshots. Antialiasing alone fills
almost every step, so eight references measured 28 to 32 and agreed on nothing
real. It says something only about a flat crop of one surface.

## What it refuses

- A reference with no `answers`.
- A measured ruling with no `field`.
- A derived ruling with no `why`. The derivation is the whole of its authority.
- Scoring a ruling no frame decides. Judged and derived rulings are named and
  never passed.
- JPEG in a headless run. The browser decodes any format; node decodes PNG.
  Save references as PNG, or run with an editor tab open.

## Files

`<project>/art/` — `brief.json`, `references.json`, `rulings.json`, `bible.md`,
and the images in `references/`. All committed. A hand-written art document
found beside them is named in the bible and in `art.status` as superseded, so a
stale one is never mistaken for the authority.
