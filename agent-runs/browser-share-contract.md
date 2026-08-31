# Browser Share — End-State Contract

## Contract status

provisional. One blocking unknown: whether headless Chromium gets real GPU
WebGL on this machine (`U1`). One probe settles it. `U2` is resolved below.

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

Reinterpreted, not overridden: five *browser* tabs cannot carry this, so lane
views become tabs inside one page. `LOCAL` p233: "only the front tab draws".
One switchable view per worktree is unchanged.

## Must-pass outcomes

1. **A lane never touches the person's browser, and renders at a stated device
   profile** — an isolated Chromium, at a viewport and pixel ratio it names.
2. **The viewer shows all lanes live and read-only, and never fakes a frame.**
   One lane tab per worktree: a schematic from reported state, plus the lane's
   last real capture, each labelled as what it is.
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
| [Chrome background tabs](https://developer.chrome.com/blog/background_tabs) | SOURCE, official | Chromium | Background tabs get no rAF callbacks | Not about headless instances | 2017, still current | High |
| [Chromium SwiftShader docs](https://chromium.googlesource.com/chromium/src/+/main/docs/gpu/swiftshader.md) | SOURCE, official | Chromium | Automatic WebGL fallback to SwiftShader is deprecated; context creation will fail rather than fall back | Does not say GPU-backed headless fails | 2026 | Medium |

## Acceptance matrix

| # | Outcome | Build check (builder, today) | Acceptance check (independent evaluator) | Pass | Boundary | Fail | Provenance | Feasibility / cost |
|---|---|---|---|---|---|---|---|---|
| 1 | Lane never touches the person's browser, and renders at a stated device profile | `agent.prepare --parallel` for 5 lanes; assert no lane holds a handle to the person's Chrome profile and none issues a `claude-in-chrome` call. Assert every written frame's pixel dimensions equal the profile the lane asked for, and that a frame records the profile it was taken at | James runs a 5-lane loop with the viewer focused, then backgrounded, then minimised; records lane errors. He then reads one blind set and confirms every frame in it shares one profile. Evaluator `STAFFED` (James) | 5/5 lanes complete every render request with the viewer minimised, and every frame in a comparison set is the declared profile | 1 lane needs a retry but completes; profiles still uniform | Any lane blocks or reports "no editor attached"; or a set mixes profiles as loop 3 did (540x960 beside 1920x911) | LOCAL p233, p245, p261 | medium |
| 2 | Viewer shows all lanes live, read-only, never fakes a frame | Script drives 3 lanes making a known edit each; assert the viewer's lane tab reflects each within 2 s. Assert every panel is labelled schematic or capture, and that a lane whose `engine/render.js` differs from the viewer's shows no schematic claiming to be its drawing | James watches one loop and answers: could you tell, without asking, what each lane was doing? Evaluator `STAFFED` (James) | Yes for every active lane; no viewer action changed a lane's file; no panel is mislabelled | Viewer lags a lane by >2 s but is correct and labelled | Viewer shows stale state as current, a click edits lane files, or a schematic is presented as a real frame | USER intent; LOCAL p131; INFERENCE on 2 s | medium |
| 3 | Every bridge call names its target | Open 2 clients; assert a bridge call without a target is refused with both client identities listed, and a targeted call reaches only that client | Reviewer reads the reply schema and confirms client identity (id, url, viewport, headless flag) is present on every reply. Evaluator `STAFFED` (James) | Untargeted call with >1 client exits non-zero and names them; targeted call reaches exactly one | Warns and picks deterministically instead of refusing | Broadcasts and keeps the first reply | LOCAL p131 | small |
| 4 | Zero lane-minutes lost to browser faults over a full loop | Instrument each lane: log every render request with wait and outcome; sum time in `timeout`/`no editor`/`wedged` | James compares this loop's lost time against loop 3's, which is recorded in `agent-runs/2026-08-31-brawl-stars/`. Evaluator `STAFFED` (James) | 0 lane-minutes lost to browser faults across 5 lanes | Under 2 lane-minutes, none fatal | Any lane dies or a tab must be closed and reopened by hand | LOCAL p217, p233 | medium |

## Anti-goals

- Not a second renderer. A three.js game reaches every `USER` target through a
  WebView, and `SOURCE` each renders WebGL through ANGLE. A Chromium frame is
  the shared proxy; Windows is that path exactly.
- Not five WebGL contexts in one page. `SOURCE` Chrome kills the oldest.
- Not an editable viewer. It observes; it never writes lane files.
- Not a fix for leaking lane dev servers. That is p246/p247.
- No new score. Progress is these four rows, per loop.

## Unknowns and assumptions

- `U1` **blocking** — Does headless Chromium get GPU-backed WebGL here, or
  refuse a context? `SOURCE`: SwiftShader fallback is deprecated. Probe: run it
  on the editor URL, read `WEBGL_debug_renderer_info`, capture a meadow frame,
  diff against a foreground capture of the same seed.
- `U2` **resolved** — Both, split by consumer. The render service runs the
  lane's real code: a lane editing `engine/render.js` must be checked against
  its own drawing, and a headless Chromium on the lane's own dev server does
  that, since each worktree is already a valid server root. The viewer mirrors
  reported state, needing no lane code and no `vite.config.js` change.
- `U3` non-blocking — Is a serial render queue enough? `INFERENCE`: a frame
  takes under a second and lanes ask rarely. Falsified by a tuning sweep.
- `U4` out of scope — `USER` deferred iOS. Windows and WebGL use the checked
  path, so no Metal question arises here.
- `A1` `INFERENCE` — 2 s viewer latency reads as "live". Untested.
- `A2` `LOCAL` — Isolated worlds already run together
  (`test/cli.test.mjs:523`), so per-lane isolation is not new.
- `A3` `LOCAL` — `project/.engine/servers.json` already records each server's
  port, url and checkout, so the viewer finds live lanes with no new registry.

## Optional builder suggestions

Not acceptance criteria. Electron bundles Chromium, so pixels still match, and
is the likely Windows export path — building the viewer on it would prove that
path early.

## Research appendix

**Capability** P1. Local inspection plus two searches.

**Artifact manifest** All at `99c5ac9`: `vite.config.js:27-30`, `:74`,
`plugins/builtin/bridge.js:1-46`, `test/cli.test.mjs:523`, `README.md:613`,
`project/.engine/servers.json`, `agent-runs/painpoints.jsonl` (p131, p217,
p233, p245, p261), PNG headers in `agent-runs/2026-08-31-brawl-stars/`.
Measured: `see.capture` refused headless.

**Excluded** Figma multiplayer and Live Share: they solve concurrent human
editing, not renderer isolation.

**Falsification** Wrong if `U1` shows headless Chromium cannot match a
foreground frame here: then the person's browser is the only renderer and the
shape becomes a strict queue over one tab — a different contract, not a tuned
one. Also wrong if a 5-lane loop loses more lane-minutes than loop 3.
