# See plugin — finish-line contract

## Contract status

provisional — James holds an unenumerated backlog for See ("I am detecting
useful things", 2026-08-30); outcomes below cover every thread named so far.
Owner review of outcome list pending. All evaluators staffed.

## North star

An AI agent working on any game in this engine — headless or browser, any
provider, low effort tier included — answers every visual question through
See's cheapest sufficient authority, finds the plugin within its first few
calls without being told, and grounds vision reads in hull colours plus the
sidecar, never in floating text. Protected boundary: queries before pixels;
the frame is a database.

## Authority and protected intent

- USER: James, 2026-08-30 — discovery test is HARD-CAPPED at 30k tokens per
  round, measuring discovery only, from a fresh session.
- USER: marks must not float over game text; hull outlines, colour per type,
  legend packet. Reference/A-B art comparison is a SEPARATE future plugin.
- USER: pain ledger records engine friction only; fix pains during the loop.
- LOCAL: `plugins/builtin/see.agent.md:2` @ 1efa62a — guide ships as the
  `see-the-game` skill with routing triggers.

## Must-pass outcomes

1. **Discovery**: a fresh low-effort agent, told only "does the rat model
   look ok? the editor is open at localhost:5180", issues a valid `see.*` or
   `agent.context` call within its first 5 tool calls, under 30k tokens.
2. **Grounded vision reads**: on a busy live frame (≥10 creatures visible),
   a fresh agent given only the capture PNG and its sidecar answers binding
   questions (subject identity, count by colour, who-hides-whom) that match
   the query verbs' answers.
3. **Battery green and restore-safe**: the See tests pass in the browser
   Tests panel and headless; every image command's error path (blank tab,
   unknown subject, empty studio, held clock) leaves camera, entities,
   scene grade, and passes exactly as found.
4. **Marks spend where questions point**: creatures and named subjects take
   marks before scenery; `brief` describe of the 700-prop meadow stays under
   8KB. Expected first-binding threshold: the first-12-marks rule below —
   today 11 of the first 12 marks go to scenery (`agent-runs/see/v2-hulls.json`).

## Evidence map

| reference | tier/lane | scope | lesson | non-transfer | version | confidence |
|---|---|---|---|---|---|---|
| `plugins/builtin/see/describe.js:51` | LOCAL | mark assignment | marks go largest-first, so backdrop scenery eats them | none | 1efa62a | high |
| `agent-runs/see/v2-hulls.json` | LOCAL | live repro | first 11 marks on hills/banks with 80 rats in frame | one view, one seed | 2026-08-30 | high |
| `plugins/builtin/see.agent.md` | LOCAL | agent surface | skill + triggers are the discovery layer that flipped round 6 | listing is a session-start snapshot | 1efa62a | high |
| `kitten-survivors/tests/see-battery.js` | LOCAL | test asset | battery exists; must cover hulls, ui:false, aim | project-specific camera | 1efa62a | medium |
| Fresh-agent rounds 1–7, 2026-08-30 | LOCAL | discovery history | docs never changed the first move; skill listing did | haiku temperament post-discovery is not under test | session log | medium |

## Acceptance matrix

| pri | outcome | build check | acceptance check (evaluator) | pass | boundary | fail | provenance | feasibility/cost |
|---|---|---|---|---|---|---|---|---|
| 1 | Discovery | builder replays the probe prompt once against a fresh session | 3 independent haiku rounds, fresh sessions, probe prompt verbatim; count tool calls to first valid `see.*`/`agent.context`; transcripts kept (fresh subagent, STAFFED) | 3/3 rounds ≤5 calls, each ≤30k tokens | 2/3 | any round browser-first through 5 calls, or >30k | USER protocol; oracle independent of builder | medium |
| 2 | Grounded reads | builder runs the 4-question probe on one capture | fresh agent, pixels+sidecar only, 4 fixed binding questions; answers scored against `see.occlusion`/`see.find` output (query oracle, independent; inputs authored by loop critic, not the lane) (STAFFED) | 4/4 match | 3/4 | ≤2/4, or any answer grounded in floating text | LOCAL oracle: ID buffer | small |
| 3 | Battery green | `tests.run` headless + browser panel click-through | James clicks the See tests in the panel and sees frames render; error-path probe: run each image command's failure case, then `see.camera` + `snapshot` diff against pre-state (James + builder script, STAFFED) | all tests pass both modes; state diff empty after every error path | one flaky rerun | any red, any leaked state | LOCAL; supersedes nothing | medium |
| 4 | Mark priority | script counts types of first 12 marks on the kitten-swarm view | rerun on 2 fresh sims (different seeds) of the meadow at ≥10 creatures visible; count scenery marks in first 12; measure brief reply bytes (builder script + James eyeball of one frame, STAFFED) | ≤4 of first 12 marks scenery AND brief <8KB | 5 scenery | ≥6 scenery, or brief ≥8KB (today: 9127B, binds first) | LOCAL repro above | small |

## Anti-goals

- No reference-gathering or A/B art-comparison features inside See (separate
  plugin, USER decision).
- No screenshots or DOM reads of the editor page by any lane.
- No vision reads for computable facts; no second progress scale beside this
  matrix.
- No GLB instancing work (p124 — engine render lane, not See).
- No regenerated test framework (deleted deliberately; USER).

## Unknowns and assumptions

- UNKNOWN, blocking for `complete` status: James's own remaining item list.
- UNKNOWN, non-blocking: whether particles/decals should become nameable
  occluders this loop (documented limit today).
- ASSUMPTION: dev server HMR resets the world when See files change —
  lanes must re-simulate before reshooting (observed 3×, 2026-08-30).

## Optional builder suggestions

Mark priority: score entries by type rarity × nearness instead of raw area;
scenery is common and far, creatures rare and near. Not an acceptance term.

## Research appendix

- Capability: P1, local-only; no external claims made, none needed.
- Manifest: `plugins/builtin/see.js`, `see/describe.js`, `see/queries.js`,
  `see/id-buffer.js`, `see/views.js`, `see.agent.md`,
  `engine/frame-facts.js`, `engine/frame-sketch.js`,
  `kitten-survivors/tests/see-battery.js` — all @ 1efa62a.
- Exclusions: no web sources; VLM research already embedded in the guide is
  treated as design rationale, not cited fact.
- Falsification: any discovery round going browser-first despite the live
  skill listing; a grounded read scoring ≤2/4 against the query oracle; a
  green battery alongside a leaked-state diff; a reshaped mark rule still
  spending ≥6 of 12 marks on scenery.
