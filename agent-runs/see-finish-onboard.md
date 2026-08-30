# Onboard — finish the See plugin (gauntlet loop)

Run a gauntlet loop to finish the See plugin in this engine. Engine work,
not a game. Max 6 agents per loop. Judge and fix pain points as lanes land.

## Design licence

The orchestrator may expand and improve See's architecture and design. The
owner's assumptions about how vision is gathered and delivered — hull marks,
the sidecar's shape, mark priority, the studio, what a sketch draws — are
open to challenge and replacement where a lane can show the replacement
grounds an agent better. Two things are protected: the query-first ladder
(queries before pixels), and the acceptance matrix in the contract — a
redesign must still pass it. A change that would alter the ladder or a
matrix row is a question for the owner, not a lane's call.

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

## Every round, without being asked

- Run the discovery probe with a FRESH LOW-POWER model, in a human's words,
  not an engineer's. See exists so a cheap agent can answer a visual question
  correctly; a plugin only the flagship can drive has failed. The probe
  prompt and its scale live in `agent-runs/see-finish-evaluators.md`. One
  round per loop, and the result is reported whether it improved or not.
- Watch each lane's direction and its spend. A lane reading widely instead
  of measuring, or re-deriving what its packet already told it, is a brief
  that pointed badly — fix the brief, and log the friction as a pain.
- Vision research feeds the next round's briefs. What models are measurably
  bad at (counting, depth order, small subjects) is what See must answer
  with a query; what they are good at (art, light, style, A/B judgement) is
  what an image is for. Findings land in `agent-runs/see-vision-research.md`
  and change the plugin's instruction sheet, not just this file.

## Traps — work around them, then FIX them

Each trap below is engine friction paid for repeatedly. Log each as a pain
and fix it during the loop; the workaround is only for lanes that hit it
before the fix lands.

- Editing any plugin file under a running dev server HMR-RESETS the world
  silently — a simulated moment vanishes and the next frame shows a
  different world with no warning. Workaround: re-simulate before
  reshooting. FIX: preserve or restore world state across a plugin
  hot-reload, or at least surface "the world was reset by a reload" in
  snapshot and in the next command's reply.
- A failed plugin import loses ALL of that plugin's commands silently —
  the only symptom is `no command "see.capture"`. Workaround: prove one
  command answers after every edit. FIX: the loader must surface a failed
  plugin import loudly — in `snapshot.errors`, in `engine.mjs check`, and
  in the "no command" reply itself (name the plugin that failed to load
  and why).
- Lanes start dev servers and browser tabs that nothing tracks or stops —
  stale hidden tabs answer captures with blank frames, rogue servers serve
  the wrong project. Workaround: kill every server and tab a lane starts,
  every loop. FIX: give the engine a way to list and stop what it started
  (server + attached tabs), so cleanup is one command instead of a hunt.
- Skill listings are session-start snapshots (harness-side, NOT fixable in
  the engine): the discovery test (matrix row 1) only counts from a fresh
  session. Hard cap 30k tokens a round; measure discovery only.
- Never screenshot or read the editor page. See answers visual questions.

## Do not

- Build reference-gathering or A/B art comparison into See — that is a
  separate future plugin (owner decision).
- Touch GLB instancing (p124) — engine render lane, out of scope.
- Regenerate a test framework — deleted deliberately.
- Lower the query-first ladder: queries before pixels, always.
