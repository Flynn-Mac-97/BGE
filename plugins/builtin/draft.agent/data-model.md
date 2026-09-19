# The draft data model

## Document, as stored

One JSON object under `<project>/.engine/systems/draft-<slug>.json`, revision
checked by the engine's document store.

```json
{
  "kind": "draft",
  "title": "Rendering",
  "nodes": [
    { "id": "camera", "kind": "text",  "text": "Camera", "at": [40, 60] },
    { "id": "fbo",    "kind": "text",  "text": "Render to FBO", "at": [300, 60] },
    { "id": "ref",    "kind": "image", "text": "refs/target.png", "at": [580, 60], "h": 140 },
    { "id": "decide", "kind": "note",  "text": "bloom before or after tonemap?", "at": [40, 200] },
    { "id": "frame",  "kind": "group", "text": "post", "at": [300, 190], "w": 380, "h": 220 }
  ],
  "edges": [
    { "id": "e1", "from": "camera", "to": "fbo", "text": "draws" },
    { "id": "e2", "from": "fbo", "to": "ref" }
  ]
}
```

| field | meaning |
|---|---|
| `id` | a slug. Unique in the draft; an edge carries its own `id` |
| `kind` | `text`, `note`, `image` or `group` |
| `text` | words, or the asset path for an image |
| `at` | top-left in diagram units, `[x, y]` |
| `w` | width in units. Omitted means the kind's default |
| `h` | height for an image or a group. Text and notes derive their height from the wrapped text |
| `colour` | optional CSS colour behind the box |
| `from` / `to` | node ids. A self-edge and a duplicate are refused |

## Plan shape, as an agent writes it

`draft.read` returns exactly what `draft.plan` accepts, so a read, an edit and a
write round-trip.

```json
{
  "title": "Rendering",
  "nodes": [
    ["camera", "text", "Camera", [40, 60]],
    ["fbo", "text", "Render to FBO"],
    ["ref", "image", "refs/target.png"],
    ["decide", "note", "bloom before or after tonemap?"],
    ["frame", "group", "post"]
  ],
  "edges": [
    ["camera", "fbo", "draws"],
    ["fbo", "ref"]
  ]
}
```

A node tuple is `[id, kind, text, at]`. The object form is accepted too, and
carries `w`, `h` and `colour`. An id is slugged; a missing one is made from the
text. A node with no `at` is placed in a grid, or keeps the position it already
had when `draft.plan` replaces a draft.

An edge tuple is `[from, to, label]`. Both nodes must already exist in the same
plan, so order the `nodes` array before the edges that join it.

## Outline, as an agent reads it

`draft.show` renders the board in words:

```
draft "Rendering" id=rendering — 5 nodes, 2 edges
  camera  text  at 40,60    "Camera"
  fbo     text  at 300,60   "Render to FBO"
  ref     image at 580,60   "refs/target.png"
  decide  note  at 40,200   "bloom before or after tonemap?"
  frame   group at 300,190  "post"
edges:
  camera -> fbo  "draws"
  fbo -> ref
```

## A worked plan

Mock up how the rendering runs, from nothing:

```sh
node bin/engine.mjs run draft.plan '{"title":"Rendering flow","nodes":[
  ["cull","text","Cull","[40,40]"],
  ["shadow","text","Shadow pass"],
  ["opaque","text","Opaque pass"],
  ["transparent","text","Transparent pass"],
  ["post","group","post"],
  ["bloom","note","bloom threshold?"]
],"edges":[
  ["cull","shadow"],["shadow","opaque","depth"],["opaque","transparent"],
  ["transparent","bloom"]
]}'
```

Then read the result a person may have rearranged:

```sh
node bin/engine.mjs run draft.read '{"id":"rendering-flow"}'
```

Improve the flow in place — this keeps every position the person set and only
changes the plan:

```sh
node bin/engine.mjs run draft.plan '{"id":"rendering-flow","title":"Rendering flow","nodes":[
  ["cull","text","Cull"],["shadow","text","Shadow pass"],["opaque","text","Opaque pass"],
  ["transparent","text","Transparent pass"],["resolve","text","Resolve to texture"],
  ["post","group","post"],["bloom","note","bloom threshold?"]
],"edges":[
  ["cull","shadow"],["shadow","opaque","depth"],["opaque","transparent"],
  ["transparent","resolve"],["resolve","bloom","after tonemap"]
]}'
```

Each `run` against a live editor updates the panel at once, so the person
watches the change land.
