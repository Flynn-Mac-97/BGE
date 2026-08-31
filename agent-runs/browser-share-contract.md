# Browser Share — End-State Contract

## Contract status

provisional. Two blocking unknowns: whether headless Chromium gets real GPU
WebGL on this machine (`U1`), and whether the viewer must show a lane's own
renderer changes (`U2`). One probe each settles them, named below.

## North star

While up to five agent lanes work in parallel, one person watching one ordinary
browser tab can see what every lane is doing to the game, live — and no lane
ever loses time to the browser, because no lane shares the person's browser at
all.

## Authority and protected intent

`USER` One engine, always up. No closing and restarting it per lane.
`USER` One browser session the person keeps open and watches.
`USER` Live visual feedback: selection and edits visible as they happen.
`USER` Per-lane view, switchable — the "scene tab" idea, one tab per worktree.
`USER` Render access is queued when two lanes want a real frame at once.
`USER` The engine itself may be changed; no part of it is fixed.
`USER` Non-browser delivery is open for discussion, not ruled in or out.

Reinterpreted, not overridden: five *browser* tabs cannot carry this, so lane
views become tabs inside one page. `LOCAL` p233: "only the front tab draws";
`SOURCE` background tabs get no `requestAnimationFrame` callbacks. The intent —
one switchable view per worktree — is unchanged.

## Must-pass outcomes

1. **A lane never touches the person's browser.** Lane rendering runs in an
   isolated Chromium the person never sees or shares.
2. **The viewer shows all lanes live and read-only.** One tab, one lane tab per
   active worktree, updating while lanes work.
3. **Every bridge call names its target.** No broadcast where the first reply
   wins.
4. **Five lanes run a full loop with zero lane-minutes lost to browser faults.**

## Evidence map

| Reference | Tier / lane | Scope | Transferable lesson | Does not transfer | Version | Confidence |
|---|---|---|---|---|---|---|
| `agent-runs/painpoints.jsonl` p233 @99c5ac9 | LOCAL, primary | This repo, 5-lane loops | "Only the front tab draws"; shared Chrome is the largest source of lost lane time | Nothing — measured here | 2026-08-30 | High |
| `agent-runs/painpoints.jsonl` p245, p217 @99c5ac9 | LOCAL, primary | Same | A backgrounded tab stops answering the bridge and is indistinguishable from a missing one | — | 2026-08-30 | High |
| `agent-runs/painpoints.jsonl` p131 @99c5ac9 | LOCAL, primary | Bridge transport | Broadcast + first-reply-wins let a stale tab answer with a blank frame | — | 2026-08-29 | High |
| `vite.config.js:27-30` @99c5ac9 | LOCAL, primary | Server root rule | `ENGINE_PROJECT` must be a direct child of ROOT or the server throws, so `.agent-worktrees/<lane>/<project>` cannot be served today | Says nothing about whether it *should* be lifted | 99c5ac9 | High |
| Measured: `run see.capture --headless` @99c5ac9 | LOCAL, primary | This engine | Capture refuses headless: "no DOM, no context.renderer"; `see.describe` returns full geometry headless; `see.sketch` is a flat-colour fallback | Sketch cannot answer lighting or `art.check` | 2026-08-31 | High |
| [Chrome background tabs](https://developer.chrome.com/blog/background_tabs) | SOURCE, official | Chromium | Background tabs get no rAF callbacks | Not about headless instances | 2017, still current | High |
| [Chromium SwiftShader docs](https://chromium.googlesource.com/chromium/src/+/main/docs/gpu/swiftshader.md) | SOURCE, official | Chromium | Automatic WebGL fallback to SwiftShader is deprecated; context creation will fail rather than fall back | Does not say GPU-backed headless fails | 2026 | Medium |

## Acceptance matrix

| # | Outcome | Build check (builder, today) | Acceptance check (independent evaluator) | Pass | Boundary | Fail | Provenance | Feasibility / cost |
|---|---|---|---|---|---|---|---|---|
| 1 | Lane never touches the person's browser | `agent.prepare --parallel` for 5 lanes, then assert no lane process holds a handle to the person's Chrome profile and no lane issues a `claude-in-chrome` call | James runs a 5-lane loop with the viewer tab focused, then backgrounded, then minimised; records whether any lane errors. Evaluator `STAFFED` (James) | 5/5 lanes complete every render request with the viewer minimised the whole run | 1 lane needs a retry but completes | Any lane blocks, times out, or reports "no editor attached" | LOCAL p233, p245 | medium |
| 2 | Viewer shows all lanes live, read-only | Script drives 3 lanes making a known edit each; assert the viewer's lane tab reflects each within 2 s | James watches one loop and answers: could you tell, without asking, what each lane was doing? Evaluator `STAFFED` (James) | Yes for every active lane, and no viewer action changed a lane's files | Viewer lags a lane by >2 s but is correct | Viewer shows a lane's stale state as current, or a click edits lane files | USER intent; INFERENCE on 2 s | medium |
| 3 | Every bridge call names its target | Open 2 clients; assert a bridge call without a target is refused with both client identities listed, and a targeted call reaches only that client | Reviewer reads the reply schema and confirms client identity (id, url, viewport, headless flag) is present on every reply. Evaluator `STAFFED` (James) | Untargeted call with >1 client exits non-zero and names them; targeted call reaches exactly one | Warns and picks deterministically instead of refusing | Broadcasts and keeps the first reply | LOCAL p131 | small |
| 4 | Zero lane-minutes lost to browser faults over a full loop | Instrument each lane: log every render request with wait and outcome; sum time in `timeout`/`no editor`/`wedged` | James compares this loop's lost time against loop 3's, which is recorded in `agent-runs/2026-08-31-brawl-stars/`. Evaluator `STAFFED` (James) | 0 lane-minutes lost to browser faults across 5 lanes | Under 2 lane-minutes, none fatal | Any lane dies or a tab must be closed and reopened by hand | LOCAL p217, p233 | medium |

## Anti-goals

- Not a second renderer. Frames agents check are Chromium frames or they are not
  the frames players see.
- Not five WebGL contexts in one page. `SOURCE` Chrome kills the oldest past its
  per-tab cap.
- Not an editable viewer. It observes; it never writes lane files.
- Not a fix for lane dev servers leaking. That is p246/p247, tracked separately.
- No new score. Progress is these four rows, per loop.

## Unknowns and assumptions

- `U1` **blocking** — Does headless Chromium get GPU-backed WebGL here, or
  refuse a context? `SOURCE`: SwiftShader fallback is deprecated. Probe: launch
  headless Chromium on the editor URL, read `WEBGL_debug_renderer_info`, capture
  one meadow frame, diff it against a foreground capture of the same seed.
- `U2` **blocking** — Must a lane tab show that lane's *own* renderer and plugin
  changes, or is its world state enough? Hosting real lane code needs
  `vite.config.js:27-30` lifted and `.agent-worktrees` served. Mirroring state
  needs neither. `USER` did not answer; the question stands.
- `U3` non-blocking — Is a serial render queue enough? `INFERENCE`: a frame is
  well under a second and lanes ask rarely. Falsified by a lane doing a tuning
  sweep of many frames.
- `A1` `INFERENCE` — 2 s viewer latency reads as "live". Untested with James.
- `A2` `LOCAL` — Multiple isolated worlds already run in one process
  (`test/cli.test.mjs:523`), so per-lane isolation is not new ground.

## Optional builder suggestions

Not acceptance criteria. A standalone Electron app bundles Chromium, so pixels
still match what ships, and gives the viewer a window instead of a tab. It costs
packaging and a second build target for a renderer already free. Worth it only
if a desktop app is itself wanted; headless Chromium plus one viewer tab gets
the same isolation without it.

## Research appendix

**Capability** P1. Local inspection plus two searches.

**Artifact manifest** All at `99c5ac9`: `vite.config.js:27-30`,
`vite.config.js:74` (`watched`, dot-directories never watched),
`plugins/builtin/bridge.js:1-46`, `test/cli.test.mjs:523`,
`agent-runs/painpoints.jsonl` (p131, p217, p233, p245, p246, p247). Measured
live: `see.capture` refused headless; `see.describe` returned full geometry.

**Excluded** Figma-style multiplayer and Live Share: they solve concurrent human
editing of one document, not isolation of automated renderers.

**Falsification** This target is wrong if `U1` shows headless Chromium cannot
produce a frame matching a foreground tab on this machine. Then lanes cannot
render in isolation, the person's browser is the only renderer, and the right
shape is a strict queue over one tab — a different contract, not a tuned one.
It is also wrong if a 5-lane loop under the new design loses more lane-minutes
than loop 3 did.
