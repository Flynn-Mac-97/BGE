---
name: glass-lane-view
description: Watches one parallel lane from the person's tab: a schematic from its own engine and its last captured frame. Use when several lanes work at once and you want to see one without touching it.
---
<!-- generated from plugins/builtin/lane-view.agent.md at server start; edits are lost -->

Read the generated interface in `plugins/builtin/lane-view.agent/interface.generated.md`. Plugin edits refresh it while the server runs. This packet command also checks freshness:

```sh
node bin/engine.mjs agent.context '{"task":"…","files":["plugins/builtin/lane-view.js"]}'
```

# Lane View

- Watches one lane from the person's tab. Read only: it sends `snapshot` and `see.describe` and nothing else, so it works while the work lock holds.
- Two labelled halves, each dated. **Schematic** is an SVG diagram built from `see.describe` — the lane's own engine computes every position, size, hull and colour. **Capture** is the last real PNG that lane wrote. A schematic never stands in for a missing frame; with no frame the capture half says "no frame yet".
- State older than 4 s is marked `DATED` and the diagram drops to one grey, so stale state cannot pass for live.
- One lane is polled — the selected one, every 1.2 s. Switching lanes switches which one is polled.
- `lane.view` — open or close the panel, and start or stop polling. Also on the LANES toolbar button.
- `lane.watch <client>` — watch that lane, read it once, and answer what it reported. No name picks the first lane.
- `lane.report` — what the panel shows now: the two labels, each half's timestamp, the lane's level and visible count. No pictures.
- Lanes come from `GET /api/server`: its `lanes` array, or the attached tabs that call themselves headless when the server does not send one.
- Frames come from `GET /api/lane-frame?client=<name>`, asked with HEAD so a poll never carries the picture. That route sends `x-engine-frame` and no date, so an undated frame is labelled `first seen <time>` rather than given the poll time. A 404 saying `no such endpoint` is reported as a missing route, not as a lane with no frame.
- Needs Terminal Bridge, because it reaches a lane through `POST /api/engine` with a `client` field.
