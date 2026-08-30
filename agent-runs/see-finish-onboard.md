# Onboard — finish the See plugin (gauntlet loop)

Run a gauntlet loop to finish the See plugin in this engine. Engine work,
not a game. Max 6 agents per loop. Judge and fix pain points as lanes land.

## Read first, in this order

1. `agent-runs/see-finish-contract.md` — the finish line. The acceptance
   matrix IS the critic's scale; do not invent a second one. Report progress
   as per-row build-check and acceptance-check verdicts, per loop.
2. `node bin/engine.mjs agent.context '{"task":"finish the See plugin"}'` —
   your packet. Read one lane's real packet before fanning out.
3. `plugins/builtin/see.agent.md` — what the plugin already claims. Keep it
   true as you change things; instructions state the rule, never the
   mistake's history.

## Loop shape

- Every lane gets a DISTINCT file claim; See is multi-file
  (`plugins/builtin/see.js` + `plugins/builtin/see/*` +
  `engine/frame-facts.js` + `engine/frame-sketch.js`) so split by file, not
  by feature.
- Commit lane pain writes before merging; pains are ENGINE friction only,
  game defects go in reports.
- After each loop: run the matrix's build checks, fix every pain raised,
  and check whether the packets or instructions caused the friction.

## Known traps

- Editing any See file under a running dev server HMR-RESETS the world:
  re-simulate (`simulate 40`, `choice.pick 1`) before reshooting frames.
- The discovery test (matrix row 1) only counts from a FRESH session —
  skill listings are session-start snapshots. Hard cap 30k tokens a round;
  measure discovery only, never how the agent solves the question after.
- A failed plugin import loses all its commands silently — after editing
  `see.js`, prove one command answers before moving on.
- Never screenshot or read the editor page. See answers visual questions.
- Kill every dev server and browser tab a lane starts, every loop.

## Do not

- Build reference-gathering or A/B art comparison into See — that is a
  separate future plugin (owner decision).
- Touch GLB instancing (p124) — engine render lane, out of scope.
- Regenerate a test framework — deleted deliberately.
- Lower the query-first ladder: queries before pixels, always.
