---
category: gameplay
description: Data-authored actors, enemy loadout recipes and bounded deterministic combat measurements.
triggers: npc, enemy loadout, simulation, power estimate, npc.search
---
# Black Bell NPC Lab

Uses the shared Black Bell Grid resolver, never a second combat implementation. Does not replace the playable room encounters or difficulty curve.

- `npc-lab/definitions.js`: actors, provisional authoring costs, required placements/links and optional item pools.
- Actors may reference shared abilities by catalog key. Actor-local `inventory` isolates equipment geometry and storage from other actors.
- `npc.generate {recipe,budget,seed}` creates a reproducible legal kit. `npc.validate <loadout>` reports placement/link errors and target warnings. Mandatory combos are validated before optional equipment.
- `npc.simulate {first,second,options}` uses up to100cycles, default30. `options.firstActor` is first/second; `replay:true` includes full snapshots only for an inspected fight.
- Simulations use compiled whole-fight execution. `reference:true` uses the cycle resolver for parity checks. `createEvaluator(references,options)` reuses validated opponents across candidates.
- `npc.evaluate {candidate,references,options}` tests both initiatives against 1–16 references. Reports observed damage/healing/guard/statuses, health, cycles, work and relative win rate; not universal power.
- `npc.search {recipes,budgets,seeds,targetWinRate,maxCycles,references}` measures at most128 requests, deduplicates identical kits and ranks proximity to the target win rate. Returns rejected requests with reasons. Default roster is three explicit baseline kits.
- `context.npcLab` exposes the same functions. Commands run without rendering or changing the current Black Bell session.
- `node tools/npc-report.mjs [output.json]` writes the default report and prints throughput. Tests: `node --test tests/*.test.mjs` and supervised headless `run tests.run`.
- `npc.discover {seed,budget,evaluations,objective,...}` mutates unrestricted item combinations/placements; default64/max128evaluations, bounded attempts. Objectives: strength/burst/sustain/efficiency/work. Training-only ranking; distinct holdouts, item-removal tests, exact replay requests and authoring snapshots. `tools/combo-report.mjs` writes a report. See design/npc-authoring.md for formulas, constraints and limits; no exhaustive-optimum claim.
- `npc.exhaustive {settings,references,objective,maxCycles,limit,checkpoint}` enumerates every legal constrained kit/placement (including ordered storage), simulates full fights in both orders, and returns resumable progress/top5. `complete:false` means best-so-far only. CLI `tools/exhaustive-report.mjs output.json [request.json]` saves atomic checkpoints and guards resume with a source hash. `settings.required` focuses regression runs on new items.
