# NPC authoring and simulation lab

This is an authoring tool using the production grid resolver. It does not replace the current dungeon encounter list, add an enemy inventory screen, or establish a difficulty curve. Existing Android gameplay remains on its previous encounter rules.

## Build a kit

Edit `plugins/npc-lab/definitions.js`. Actor templates hold health, tags, resources, shared ability references and an independent inventory. Recipes hold mandatory item placements, required links and optional pools with legal candidate positions. Item definitions and effects remain in the existing shared catalog.

Included recipes:

| Recipe | Required interaction | Minimum item budget |
| --- | --- | --- |
| poison | Vial coats dagger before its attack | 5 |
| defender | Buckler grants guard before sword attacks | 8 |
| hunger | Adjacent tooth builds Hunger; cup spends it to heal; actor gains Hunger when damaged | 7 |

The budget is a provisional sum of item authoring costs. It does not price actor health or innate traits, and it is not measured power. Comparisons across different actors come from simulation.

Generation is seeded, bounded and deterministic. Mandatory links must work. Optional items must fit, stay within budget and avoid missing targets or late next-action preparation. Unaffordable recipes fail explicitly. Validation reports geometry/link errors separately from potential timing/target warnings; it is not a proof that every conditional effect will trigger.

From the engine root:

```sh
node bin/engine.mjs --project project --headless run npc.generate '{"recipe":"poison","budget":10,"seed":41}'
node bin/engine.mjs --project project --headless run npc.search '{"recipes":["poison","defender","hunger"],"budgets":[8,10,12],"seeds":[1,2,3],"targetWinRate":0.5}'
node project/tools/npc-report.mjs agent-runs/black-bell-items/npc-report.json
```

## Measure rather than guess

`npc.evaluate` tests a candidate against explicit reference kits with both initiative orders. Measurements include effective damage, blocked damage, effective healing, generated guard, applied status amounts, ability activations, misses, loop blocks, remaining health, cycles and resolver work. Status damage is attributed to its recorded origin. Status counts combine applications such as coating and Poison, so they are not a damage estimate. Blocked damage is attributed to the attacking source.

Wins, losses, mutual defeats and cycle-limit stalemates are separate. Win rate counts outright wins only. A target win rate ranks candidates by distance from that target, with lower authoring cost breaking ties. Results depend on the chosen reference roster; this is not universal difficulty or a guarantee that increasing budget increases strength.

`npc.search` evaluates at most128 candidate requests, at most16 references and at most100 cycles per match (default30). Duplicate actor/item layouts reuse results inside the same search. Invalid candidates are returned with rejection reasons. Every result includes generation inputs, kit data, reference data and measurements. Capture the repository revision with reports when comparing across rule changes.

## Cheap execution and exact replay

Actor-local inventories let both enemies and characters use identical coordinates independently. Spatial selectors, adjacency, storage and aura geometry stay inside each actor's inventory. Explicit all-item effects can still cross owners if authored without an owner filter.

Lab turns use explicit `ownerOrder`: each actor's items scan row-major, then its intrinsic own-turn abilities run. After both sides, cycle-end statuses and expiry run. The existing game timing path is preserved when no owner order is supplied. Both initiatives are measured because action order and guard timing matter. This schedule remains an experimental authoring choice.

`resolveCycle(...,{trace:'events'})` keeps small events without cloning the entire combat state after every action. `trace:'none'` keeps only the final state and work count. Default traces retain full snapshots for gameplay feedback. All modes retain validation, reaction limits and work budgets. Tests compare exact outcomes across modes.

Use `npc.simulate {first,second,options:{replay:true}}` on an interesting pairing for the full state-by-state replay. The cheap and replay paths use the same resolver. No graphics, fixed-step presentation waits or browser are needed.

Next design work: choose reference kits and desired encounter behaviours together, then use measured bands to author encounters. The current dungeon scaling is unchanged by this lab.

## Combo discovery beyond recipes

`npc.discover` performs bounded mutation search, not exhaustive enumeration. It can add, remove or replace items, move their coordinates and swap placements. Duplicate items are allowed up to the configured limit. Storage can attach and expand capacity through the same placement rules. Required recipe links are not retained: this mode explores combinations outside those recipes, including bad intermediate arrangements.

```sh
node bin/engine.mjs --project project --headless run npc.discover '{"seed":41,"budget":14,"evaluations":64,"objective":"strength"}'
node project/tools/combo-report.mjs agent-runs/black-bell-items/combo-report.json
```

Settings include `actor`, `pool`, `budget`, `maxItems`, `duplicateLimit`, `seed`, `evaluations`, `maxCycles`, `finalists`, `objective`, `training` and `holdout`. Actor stats stay fixed during one experiment. Defaults: scavenger, full item pool, budget14, at most8items, at most2copies, seed41, 64evaluations, 20cycles and3finalists. Limits:128evaluations, 12items, 4copies, 60cycles, 3finalists and8opponents in each roster. Candidate attempts are capped at32times the evaluation limit. Geometry, item pool, cost and copy limits are hard constraints; missing targets and late preparation are allowed to reveal their measured consequences.

Search starts with an empty layout and legal training-kit seeds on the selected actor. Half the mutations choose parents from the best eight measured candidates; half choose from the full archive. This preserves some weak intermediate combinations. Canonical identities remove duplicate item-ID and input-order permutations while retaining actual placement differences. Equivalent layouts are only evaluated once.

Objectives are intentionally explicit and provisional. Let margin be average remaining candidate HP minus opponent HP:

| Objective | Score |
| --- | --- |
| strength | 100 × outright win rate + margin |
| burst | Average 100/cycles for wins, zero otherwise |
| sustain | Average 100 if candidate survives + remaining candidate HP |
| efficiency | Strength score / max(1,item cost) |
| work | Average resolver work per fight |

Sustain can reward stalemates; work can reward long normal fights. These objectives surface cases to inspect, not automatically label exploits. Costs exclude actor traits/stats. Efficiency ablations change the cost denominator, so read win-rate deltas alongside score deltas.

Training alone determines ranking and parent selection. Finalists are measured against separate holdout kits with both initiatives; holdout results do not rerank candidates or feed back into this search. Identical training/holdout kits are refused. Holdouts still share item families and are not a guarantee of broad generalisation. Repeatedly choosing experiments by the same holdout results would make those opponents another training set.

Each finalist includes single-item removal tests on holdouts. A positive delta means removing the item hurt that measurement; zero suggests redundancy or inactivity in those matchups. Removal can change timing, survival and resource use. It is an explanation aid, not proof of universal synergy. Invalid removals, such as detaching occupied inner storage, are reported as skipped. Pairwise interaction attribution and deliberately breaking links are future extensions.

Reports include constraints, seed, exact layouts, mutation parentage, training and holdout rosters/results, mutation counts, ablations, failed simulations and a complete authoring-data snapshot. `replayRequest` can be passed directly to `npc.simulate` for a full trace. Replay uses current resolver code: retain the source revision/archive alongside a report for long-term reproduction. Runtime-limit errors remain visible instead of scoring as victories. Fight counters count completed measurements.

This is heuristic discovery; the evaluation/attempt stop reason is recorded. It cannot certify that a layout is globally optimal or that no undiscovered exploit exists. It does not change live encounters, item numbers or the difficulty curve.

## Exhaustive enumeration and complete-cycle evaluation

Result-only simulations use `resolveFight`: validate and clone once, index listeners by event type, cache fixed geometry and aura recipients, then update the private numeric combat state through the shared effect handlers. Status listeners, conditions, resources, expiry, death and enemy retargeting remain dynamic. Fixed geometry is valid because the current combat effect vocabulary cannot move items, change tags or transfer ownership. New effects that change those facts must invalidate the caches. Work budgets and activation limits still apply each cycle.

The optional `record(kind,detail)` callback receives borrowed read-only event details. Aggregate immediately or clone details before retaining them. It does not receive snapshots. Full replays and `reference:true` use the existing cycle resolver; differential tests compare final states, counters, event order and loop failures. `createEvaluator` validates and copies reference kits once per batch and each candidate once. These optimizations preserve authored rules rather than approximating fights with a power score.

`createFightRunner(state)` captures a validated snapshot and returns a reusable runner. Each invocation owns a fresh state. The evaluator composes independently prepared actor inventories and shares one runner between initiative orders. Fixed trigger matches are cached by event kind, source, target and status; enemy-dependent triggers still resolve against live health. Status listener routes rebuild only when status membership changes, including removal and expiry. Stacking reads current status values. Enemy order is prepared once, but death still retargets each selection. The pending-work stack pushes reactions in reverse to preserve the original execution order without shifting the rest of the queue.

`npc.exhaustive` enumerates every legal layout inside explicit constraints. Unlike mutation search it includes all kit sizes from zero through `maxItems`, every legal placement, allowed duplicates and all ordered storage attachment chains. It does not rotate footprints. Item-ID/input-order duplicates are omitted, but mirrored/translated layouts remain distinct because scan order and directional effects can matter. `required` can restrict regression runs to layouts containing a newly added item type.

```sh
node bin/engine.mjs --project project --headless run npc.exhaustive '{"settings":{"pool":["dagger","venom","stone"],"maxItems":3,"budget":8,"duplicateLimit":2,"required":["venom"]},"maxCycles":30,"limit":256}'
node project/tools/exhaustive-report.mjs /workspace/artifacts/black-bell-exhaustive.json
```

`enumerateLoadouts(settings)` is a lazy generator. Storage attaches in every allowed sequence first, then ordinary equipment placements are enumerated with increasing placement indices and occupancy masks. This covers unordered item sets without simulating permutations of identical item IDs. Budgets, duplicate limits, item count and geometry prune impossible branches only; weak or disconnected interactions are not pruned. Enumeration uses the selected actor's base inventory dimensions.

Each candidate runs complete fights against every supplied reference with both initiative orders: combat start, cycle start, item scans and reactions/extra actions, intrinsic actor turns, cycle-end statuses and expiry. Subsequent cycles retain health, statuses, resources and combat-use limits. A fight stops on an actual result or the stated cycle limit. Mutual defeat and cycle-limit stalemate remain distinct and neither counts as a win.

`exhaustiveBatch` processes up to `limit` candidates (1–2000) and returns a checkpoint. Pass it back with identical settings/opponents/objective/cycle limit. Resume regenerates and skips earlier layouts without resimulating them. Checkpoints record authoring data, exact experiment identity, next index, completed fights, failures and top five results. A top result is only the best-so-far until `complete:true`; a completed enumeration with simulation failures does not certify a strongest measured build. Stalemates are bounded outcomes, not proof of an eventual result.

The CLI writes an atomic `.checkpoint.json` after each batch and resumes it on rerun. It hashes project plugin JavaScript and refuses resume if source or request changed. An optional third argument names a request JSON file. On completion it writes the report plus a full replay against one held-out opponent. Holdouts evaluate the winner only; they do not affect the exhaustive ranking. Keep checkpoint and source version with the report for reproduction. Enumeration remains expensive for large spaces, but partial runs are explicitly labelled and recoverable.

The first default CLI experiment uses an ordinary 12HP scavenger on a3×3base grid, up to3items, budget10, at most2copies, and dagger/sword/venom/stone/tooth/echo/buckler/salve. It includes17036legal layouts, including empty/non-attacking kits. Three baseline reference kits in both orders make102216complete-cycle fights with a30cycle cap. This is exact coverage of that space, not of the entire catalogue or all opponents. `strength` ranks100×winRate plus mean remaining-HP margin; lower cost then enumeration order break equal scores.
