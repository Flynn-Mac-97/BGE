# Browser Share — End-State Contract

## Contract status

complete. `U1` and `U2` resolved by measurement below. No blocking unknown
remains; every row's evaluator is staffed.

## North star

While five lanes work in parallel, one person watching one ordinary browser tab
sees what every lane is doing, live — and no lane loses time to the browser,
because no lane shares it.

## Authority and protected intent

`USER` One engine, always up; no restart per lane.
`USER` One browser session, kept open and watched.
`USER` Live feedback: selection and edits visible as they happen.
`USER` Switchable per-lane view — the "scene tab", one per worktree.
`USER` Render access queued when two lanes want a frame at once.
`USER` The engine may be changed; nothing is fixed.
`USER` Targets: mobile, Windows, WebGL. iOS is out of scope now.
`USER` The person's engine locks while lanes work; a click must not break one.

Reinterpreted, not overridden: five *browser* tabs cannot carry this, so lane
views become tabs inside one page — `LOCAL` p233, "only the front tab draws".
One switchable view per worktree is unchanged.

## Must-pass outcomes

1. **A lane never touches the person's browser, and renders at a stated device
   profile** — an isolated Chromium, at a viewport and pixel ratio it names.
2. **The person's engine locks while lanes work, and shows each one.** Editing
   and play are refused while a lane is active. One lane tab per worktree: a
   schematic from reported state plus the lane's last capture, each labelled.
3. **Every bridge call names its target.** No broadcast, no first-reply-wins.
4. **Five lanes run a full loop with zero lane-minutes lost to browser faults.**

## Evidence map

| Reference | Tier / lane | Scope | Transferable lesson | Does not transfer | Version | Confidence |
|---|---|---|---|---|---|---|
| `agent-runs/painpoints.jsonl` p233 @99c5ac9 | LOCAL, primary | This repo, 5-lane loops | "Only the front tab draws"; shared Chrome is the largest source of lost lane time | Nothing — measured here | 2026-08-30 | High |
| `agent-runs/painpoints.jsonl` p245, p217 @99c5ac9 | LOCAL, primary | Same | A backgrounded tab stops answering the bridge and is indistinguishable from a missing one | — | 2026-08-30 | High |
| `agent-runs/painpoints.jsonl` p131 @99c5ac9 | LOCAL, primary | Bridge transport | Broadcast + first-reply-wins let a stale tab answer with a blank frame | — | 2026-08-29 | High |
| `vite.config.js:27-30` @99c5ac9 | LOCAL, primary | Server root rule | `ENGINE_PROJECT` must be a direct child of ROOT or the server throws, so `.agent-worktrees/<lane>/<project>` cannot be served today | Says nothing about whether it *should* be lifted | 99c5ac9 | High |
| Measured: `run see.capture --headless` @99c5ac9 | LOCAL, primary | This engine | Capture refuses headless: "no DOM, no context.renderer"; `see.describe` returns full geometry headless; `see.sketch` is a flat-colour fallback | Sketch cannot answer lighting or `art.check` | 2026-08-31 | High |
| Measured: frame sizes in `agent-runs/2026-08-31-brawl-stars/` @99c5ac9 | LOCAL, primary | Loops 1-3 | Frames were taken at 1107x748, 540x960 and 1920x911; blind set 3 put 540x960 beside 1920x911. Frame shape was never controlled | Does not say which shape is right — the bibles do | 2026-08-31 | High |
| `kitten-survivors/art/world/bible.md:13`, `art/interface/bible.md:13,87` @99c5ac9 | LOCAL, primary | This game | Target is a portrait phone, 390 pt wide, 1080 px short edge | Other games set their own | 99c5ac9 | High |
| [WebKit ANGLE backend](https://trac.webkit.org/wiki/AngleforWebGL) | SOURCE, official | WebKit / Safari / WKWebView | Safari renders WebGL through ANGLE, as Chrome does; ANGLE translates to D3D11 on Windows and Metal on iOS | Does not promise pixel-identical output across backends | current | Medium |
| [Capacitor games guide](https://capacitorjs.com/docs/guides/games) | SOURCE, first-party | Capacitor | WebGL and canvas games export to iOS and Android through a WebView | No performance figures given | current | Medium |
| Measured: U1 probe, `agent-runs/u1-clean.png` @52b96d6 | LOCAL, primary | This machine, Chrome 151 | Headless Chromium renders this engine on the real GPU and the CLI drives it with no window; five at once each kept a context | One machine, one GPU; says nothing about a GPU-less CI box | 2026-08-31 | High |
| Measured: capture size 524x865 inside a 540x960 window @52b96d6 | LOCAL, primary | Editor capture path | `see.capture` returns the canvas, which is the window minus editor chrome, so a window size is not the frame size | — | 2026-08-31 | High |
| [Chrome background tabs](https://developer.chrome.com/blog/background_tabs) | SOURCE, official | Chromium | Background tabs get no rAF callbacks | Not about headless instances | 2017, still current | High |
| [Chromium SwiftShader docs](https://chromium.googlesource.com/chromium/src/+/main/docs/gpu/swiftshader.md) | SOURCE, official | Chromium | Automatic WebGL fallback to SwiftShader is deprecated; context creation will fail rather than fall back | Does not say GPU-backed headless fails | 2026 | Medium |

## Acceptance matrix

| # | Outcome | Build check (builder, today) | Acceptance check (independent evaluator) | Pass | Boundary | Fail | Provenance | Feasibility / cost |
|---|---|---|---|---|---|---|---|---|
| 1 | Lane never touches the person's browser, and renders at a stated device profile | `agent.prepare --parallel` for 5 lanes; assert no lane holds a handle to the person's Chrome profile and none issues a `claude-in-chrome` call. Assert every written frame's pixel dimensions equal the profile the lane asked for, and that a frame records the profile it was taken at | James runs a 5-lane loop with the viewer focused, then backgrounded, then minimised; records lane errors. He then reads one blind set and confirms every frame in it shares one profile. Evaluator `STAFFED` (James) | 5/5 lanes complete every render request with the viewer minimised, and every frame in a comparison set is the declared profile | 1 lane needs a retry but completes; profiles still uniform | Any lane blocks or reports "no editor attached"; or a set mixes profiles as loop 3 did (540x960 beside 1920x911) | LOCAL p233, p245, p261 | medium |
| 2 | Person's engine locks while lanes work, and shows each one | With 3 lanes active, assert every mutating verb (`set`, `spawn`, `destroy`, `play`, level save) is refused with a reason naming the lanes, and that read verbs still answer. Drive a known edit per lane; assert its lane tab reflects it within 2 s and every panel is labelled schematic or capture | James watches one loop and answers two questions: could you tell, without asking, what each lane was doing? And did the engine stop you editing while they ran? Evaluator `STAFFED` (James) | Yes to both; no viewer action changed a lane's file; no panel mislabelled | Viewer lags a lane by >2 s but is correct and labelled; lock still holds | A mutating verb succeeds while a lane is active, a schematic is presented as a real frame, or stale state shows as current | USER intent; LOCAL p131 | medium |
| 3 | Every bridge call names its target | Open 2 clients; assert a bridge call without a target is refused with both client identities listed, and a targeted call reaches only that client | Reviewer reads the reply schema and confirms client identity (id, url, viewport, headless flag) is present on every reply. Evaluator `STAFFED` (James) | Untargeted call with >1 client exits non-zero and names them; targeted call reaches exactly one | Warns and picks deterministically instead of refusing | Broadcasts and keeps the first reply | LOCAL p131 | small |
| 4 | Zero lane-minutes lost to browser faults over a full loop | Instrument each lane: log every render request with wait and outcome; sum time in `timeout`/`no editor`/`wedged` | James compares this loop's lost time against loop 3's, which is recorded in `agent-runs/2026-08-31-brawl-stars/`. Evaluator `STAFFED` (James) | 0 lane-minutes lost to browser faults across 5 lanes | Under 2 lane-minutes, none fatal | Any lane dies or a tab must be closed and reopened by hand | LOCAL p217, p233 | medium |

## Anti-goals

- Not a second renderer. Every `USER` target reaches a three.js game through a
  WebView, and `SOURCE` each renders WebGL through ANGLE. Windows is that path
  exactly.
- Not five WebGL contexts in one page. `SOURCE` Chrome kills the oldest.
- Not an editable viewer. It observes; it never writes lane files.
- Not a fix for leaking lane dev servers. That is p246/p247.
- No new score. Progress is these four rows, per loop.

## Unknowns and assumptions

- `U1` **resolved 2026-08-31** — Headless Chromium gets the real GPU: `ANGLE
  (NVIDIA, RTX 4070, Direct3D11)`, WebGL 2.0, no SwiftShader. Five at once each
  held a context and wrote a byte-identical 540x960 frame. The CLI drove one
  with no window: 1261 entities, a 32-second run, then a measured capture.
- `U2` **resolved** — Split by consumer. The render service runs the lane's real
  code, since a lane editing `engine/render.js` must be checked against its own
  drawing, and each worktree is already a valid server root. The viewer mirrors
  state, needing no lane code and no `vite.config.js` change.
- `U3` non-blocking — Is a serial render queue enough? `INFERENCE`: a frame
  takes under a second and lanes ask rarely. Falsified by a tuning sweep.
- `U4` out of scope — `USER` deferred iOS.
- `U5` non-blocking, from the probe — A device profile must be set on the
  canvas, not the window: a 540x960 window captured 524x865, editor chrome
  taking the difference. A phone frame needs a chrome-free view.
- `A1` `INFERENCE` — 2 s viewer latency reads as "live". Untested.
- `A2` `LOCAL` — Isolated worlds already run together (`test/cli.test.mjs:523`).
- `A3` `LOCAL` — `servers.json` already records each server's port, url and
  checkout, so the viewer finds lanes with no new registry.

## Optional builder suggestions

Electron is the likely Windows export path; building the viewer on it would
prove that path early.

## Research appendix

**Capability** P1. Local inspection, two searches, one measured probe.

**Artifact manifest** All at `99c5ac9`: `vite.config.js:27-30`, `:74`,
`plugins/builtin/bridge.js:1-46`, `test/cli.test.mjs:523`, `README.md:613`,
`project/.engine/servers.json`, `agent-runs/painpoints.jsonl` (p131, p217,
p233, p245, p261), PNG headers in `agent-runs/2026-08-31-brawl-stars/`.
Measured: `see.capture` refused headless.

**Excluded** Figma multiplayer and Live Share: they solve concurrent human
editing, not renderer isolation.

**Falsification** `U1` held, so the falsifier is scale: wrong if a real 5-lane
loop, each on its own worktree server rather than five clients of one, loses
more lane-minutes than loop 3. Also wrong if a headless and a foreground frame
of one seed disagree enough to flip an `art.check` verdict — untested, cheap.
