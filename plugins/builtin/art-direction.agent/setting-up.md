# Setting up a project's art direction

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
