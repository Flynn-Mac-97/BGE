# See finish line — the evaluator probes

The acceptance matrix in `see-finish-contract.md` names four checks. Three of
them are judged by a fresh agent rather than by a number a script prints, and
a fresh agent judges nothing consistently unless the words it is given are
fixed in advance. These are those words. They are authored by the loop, not by
the lane whose work they grade, and they do not change between rounds — a probe
rewritten to suit the build has stopped measuring anything.

## Row 1 — Discovery

One prompt, given to a fresh session with nothing else said. No file is named,
no plugin is named, and the word "see" never appears.

```text
does the rat model look ok? the editor is open at localhost:5180
```

Measured: the number of tool calls before the first valid `see.*` or
`agent.context` call, and the tokens spent reaching it. Three independent
rounds on the low-effort tier, each from a fresh session.

- pass: 3 of 3 rounds reach it within 5 calls, each under 30k tokens
- boundary: 2 of 3
- fail: any round still driving a browser at its fifth call, or any round
  over 30k tokens

Nothing may be added to the prompt. A hint is the thing under test.

## Row 2 — Grounded vision reads

The evaluator is given exactly two things: one `see.capture` PNG of a busy
live frame with at least ten creatures in it, and that capture's `.json`
sidecar. No query output, no entity list, no level file, and no further
questions answered. It answers these four, in this order, and each answer must
name the evidence it used.

1. The player is one of the outlined things in this frame. What type is it,
   and which colour in `palette` names that type?
2. How many creatures of the most common creature type are outlined in this
   frame? Count by hull colour, not by counting bodies.
3. Name one outlined thing that is partly hidden by another outlined thing,
   and say which of the two is nearer the camera.
4. Is the frame's marked subject in the left third, the middle third, or the
   right third of the screen?

Scored against the query verbs run on the same frame: `see.describe` for the
palette, the marked list and the regions, `see.occlusion` for who hides whom,
`see.find` for the count by type. An answer is correct when it matches what
the query says.

- pass: 4 of 4 match
- boundary: 3 of 4
- fail: 2 or fewer, or any answer grounded in text drawn by the game rather
  than in a hull colour and the sidecar

The fourth question exists to catch a reader answering from the picture's feel
rather than from the sidecar's `at` numbers. The second exists to catch a
reader counting bodies, which is the thing vision models measurably get wrong
and the whole reason the hulls carry one colour per type.

## Row 3 — Battery green and restore-safe

Two parts, both required.

- Every See test passes headless (`run tests.run`) and in the browser Tests
  panel, with frames rendering on screen.
- Each image command's failure case runs, and a `snapshot` plus `see.camera`
  taken afterwards is identical to one taken before: same camera, same
  entities, same scene grade, same passes. The failure cases are a blank tab,
  an unknown subject, an empty studio, and a held clock.

- pass: green in both modes and an empty diff after every failure case
- boundary: one flaky test that passes on a rerun
- fail: any red, or any leaked state

## Row 4 — Marks spend where questions point

A script counts the types of the first twelve marks on a meadow view with at
least ten creatures visible, on two fresh simulations with different seeds,
and measures the bytes of a `brief` describe reply on the same view.

- pass: at most 4 of the first 12 marks are scenery, on both seeds, and the
  brief reply is under 8192 bytes
- boundary: 5 scenery marks
- fail: 6 or more scenery marks, or a brief reply of 8192 bytes or more

Scenery means a type that is backdrop rather than a thing a question is about
— ground, hills, banks, props placed for dressing. Creatures and named
subjects are what a question points at.

Baseline before this loop, from `agent-runs/see/v2-hulls.json`: 11 of the
first 12 marks were scenery with 80 rats in frame, and a brief reply of the
meadow was 9127 bytes.
