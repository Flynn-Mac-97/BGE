---
category: core
description: A shared board a person and an agent both edit, for planning a game mechanic, a system, a mood board or a reference sheet before any of it is code. Use when asked to plan, diagram, map out, sketch a flow, design a system, make a mood board, or work on a design the person started in the Draft panel.
triggers: draft, diagram, plan, flow map, flowchart, system design, mood board, moodboard, node graph, graph editor, whiteboard, concept map, design a mechanic
---

# Draft

A draft is a saved board: boxes joined by arrows. A person draws it in the
**DRAFT** panel; an agent reads and writes the same board through these
commands. Both see the other's change.

- Box kinds: `text` (a short label), `note` (a paragraph), `image` (a picture
  under the project, named by path), `group` (a labelled frame behind others).
- Every box has one `text`: words for text, note and group; the asset path for
  an image.
- Drafts save in the engine's document store as `draft-<slug>`, revision
  checked. Every edit writes at once; there is no save button. A write that
  races another is refused and says so.
- A draft's id is its document id, `draft-<slug>`. Every command accepts that or
  the bare `<slug>`; `draft.list` answers with the full one.

## Commands

- `draft.plan {title, nodes, edges}` — write a whole board in one call. Each
  node is `[id, kind, text, at?]` or an object; each edge is `[from, to, label?]`.
  With `id`, replaces that draft and keeps the position of every box that keeps
  its id.
- `draft.read {id?}` — the plan shape back, for editing.
- `draft.show {id?}` — the board in words, for understanding without a picture.
- `draft.new {title}` — a blank board.
- `draft.add {kind?, text?, at?, ...}` — add a box; answers with its id.
- `draft.set {node, text?, kind?, at?, w?, h?, colour?}` — change one box.
- `draft.connect {from, to, text?}` · `draft.label {edge, text}` — draw and label an arrow.
- `draft.remove {node?|edge?}` · `draft.open {id}` · `draft.fit` (frames every box) · `draft.full {on?}` (the board covers the whole window) · `draft.list` · `draft.panel`.

Every command takes `id` to name a draft other than the open one, so one
headless call is enough on its own.

## Working beside a person

- While the DRAFT panel is open, a command run against the attached editor
  changes what the person sees at once. `draft.read` then sees their
  arrangement too.
- A box the person moved stays where they put it: `draft.plan` keeps a position
  it is not given again.

## Detail

- `plugins/builtin/draft.agent/data-model.md` — the document, the plan shape, a worked plan.
