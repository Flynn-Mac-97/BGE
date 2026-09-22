---
skill: see-frames
description: Produce an actual image of the running game and read it — sketches, marked captures, saved moments, the size a frame comes out at, and how to prompt a vision model on one. Use only after the data verbs in See cannot answer, because a picture costs about fifty times a query and answers less. Also covers getting a frame from a terminal with no tab of your own.
match: plugins/builtin/see.js plugins/builtin/see/**
triggers: screenshot, capture, take a picture, frame, png, image of, sketch, moment, vision model, lane browser, headless browser, render a frame
category: core
---

# See Frames

Pixels, and only pixels. Every question that can be answered from engine data
is answered in the **See** guide, and should be asked there first: a frame
costs about fifty times a query, and a model reading one can be wrong about
what it sees in a way a query never is.

Reach for a frame when the question is genuinely about appearance — does this
read as a wall, is the silhouette right, does the lighting sell it — or when a
person asked to see something.

Use `see.editor` for the desktop editor panels. Add `{"scope":"window"}`
to include the desktop tabs and console. This captures Electron surfaces,
requires the desktop host, and does not need Chrome or native computer tools.
Use `see.capture` for the game canvas.

## Detail

Read only the file your task needs.

- `plugins/builtin/see-frames.agent/image-commands.md` — every image verb's arguments and what it returns
- `plugins/builtin/see-frames.agent/frame-shape.md` — the size and aspect a frame comes out at
- `plugins/builtin/see-frames.agent/moments.md` — render and scene truth at the same instants
- `plugins/builtin/see-frames.agent/from-a-terminal.md` — getting a frame with no tab of your own
- `plugins/builtin/see-frames.agent/no-gl.md` — what still works when there is no GL
- `plugins/builtin/see-frames.agent/vision-model.md` — how to prompt a vision model on a frame
