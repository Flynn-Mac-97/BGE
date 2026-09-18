---
name: glass-see-the-game
description: Use when a question is about what is actually there in the running game world or on screen — and the answer must come from live engine data, not from reading source, type files, or a screenshot. Trigger it for: "what is that thing on screen / in my level", something missing or not appearing (is it hidden, blocked, off-screen, or absent?), something drawn wrong (grey box, flat colour, wrong shape), things overlapping, stacking, floating, or piling up at one spot, and checking positions, counts, sizes, or what blocks what after simulating steps. Also use when a debugging question would otherwise be answered by guessing from code or by eyeballing a picture — query the scene graph instead. Covers identify, describe, find, isolate, occlusion, diff, camera. Do not use for writing gameplay or rendering features, camera or effect authoring, renames, or for capturing/prompting on an image — that is the See Frames guide.
---
<!-- generated from plugins/builtin/see.agent.md at server start; edits are lost -->

Read the generated interface in `plugins/builtin/see.agent/interface.generated.md`. Plugin edits refresh it while the server runs. This packet command also checks freshness:

```sh
node bin/engine.mjs agent.context '{"task":"…","files":["plugins/builtin/see.js"]}'
```

# See

Your model of the game and what a player sees can disagree, and the code does
not say so. See answers from the engine's own data — what is on screen, where,
what it is, what is hidden — so a visual question costs a query, not a
screenshot and a guess.

Query first, pixels last. Route every question to the cheapest exact
authority — scene graph, then geometry, then renderer queries, then
pixels. Spend an image only on aesthetic judgement or an A/B choice.
Read down; stop at the first row that answers.

| question | use | costs |
|---|---|---|
| **what is THAT thing, at this spot on screen** | `see.identify '{"at":[50,50]}'` | nothing; ID buffer, falls back to boxes |
| what does a ray pass through, from a point or in a direction | `see.ray '{"at":[50,50]}'`, `'{"grid":[6,4]}'`, `'{"from":"you","direction":"down"}'` | nothing; works everywhere |
| what is on screen — counts, positions, sizes, coverage, regions, overlaps, between | `see.describe` | nothing; works everywhere |
| which entities match predicates — type, region, size, depth, cut, occlusion, distance | `see.find` | nothing; works everywhere |
| one entity in full — world box, screen box, cover, velocity, camera relation | `see.isolate` | nothing; may step the world once |
| how much of X is visible, and who blocks it | `see.occlusion` | nothing; ID buffer or rays |
| what changed over N steps — appeared, gone, moved, entered or left frame | `see.diff` | nothing; advances the world |
| why the frame looks wrong — eye inside a box, thing against the lens | `see.camera` | nothing; works everywhere |
| layout and composition, roughly | `see.sketch` | one small PNG; works everywhere |
| does it actually look right — art, light, readability, A/B | `see.capture` | a real frame; needs a browser — see "A frame from a terminal" |
| render versus scene truth at the same instants | `see.moment` | one sheet; needs a browser |

Never ask a vision model what a query answers. Vision models miscount
overlapping things and misjudge positions and distances; the query numbers
are exact, and every reply's `method` field names how it was computed.

## Detail

Read only the file your task needs.

- `plugins/builtin/see.agent/query-commands.md` — every verb's arguments and what it returns
- `plugins/builtin/see.agent/troubleshooting.md` — a symptom routed to the verb that explains it
- `plugins/builtin/see.agent/never-ask-a-picture.md` — the questions a look gets wrong, and the verb for each
- `plugins/builtin/see.agent/limits.md` — what the queries cannot tell you
- `plugins/builtin/see.agent/inspect-one-model-in-one-call.md` — one model's nodes, bones and materials
- `plugins/builtin/see.agent/producing-an-actual-image.md` — when to spend a frame, and how to read it
- `plugins/builtin/see.agent/from-a-terminal.md` — getting a frame with no tab of your own
