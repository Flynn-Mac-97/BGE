# How a graph becomes a shader

## The three files

| file | job |
|---|---|
| `blender-shaders/graph.js` | reads the dumped graph. No TSL, no three. |
| `blender-shaders/nodes.js` | one entry per Blender node type, as TSL maths. |
| `blender-shaders/build.js` | walks the graph and fills in a three material. |

The walk is separate from the maths, so adding a node type touches one table.

## Groups never reach the engine

`export-glb.py` flattens every node group before it writes the graph. A node
inside a group is named `<group node>/<node>`, links are joined through Group
Input, Group Output and reroutes, and a muted node passes on the input its
`internal_links` name. An unlinked group input moves its value onto the socket
it fed. The translator only ever sees plain nodes.

## Sockets are addressed by position, never by name

A Math node's three inputs are all called `Value`. A Mix node has ten inputs:
`Factor, Factor, A, B, A, B, A, B, A, B` — one pair per data type. Floats are at
2 and 3, vectors at 4 and 5, colours at 6 and 7.

A reader keyed on names finds the first socket, builds from defaults, and draws
something that looks nearly right. `graph.js` addresses by position and only
falls back to a name when the name is unique.

Names that Blender has changed between versions (`Fac` became `Factor`) are
listed in `ALSO_CALLED` in `graph.js`.

## Adding a node type

1. Add an entry to `NODES` in `nodes.js`:

```js
TEX_BRICK: (read, properties, socket, linked) => {
  const position = linked('Vector') ? asVec3(read('Vector')) : positionLocal
  return value(/* a TSL node */, 1)   // 1 for a number, 3 for a colour
}
```

2. Add its Blender type name to `TRANSLATABLE_TYPES` in the same file.

`read` takes a socket name or a position and gives a value already computed.
`properties` is what the node is set to. `socket` is which output was asked for.
`linked` says whether an input has anything plugged into it, which is how a
texture knows to use its own coordinates.

Every value carries its width — 1 or 3. `asFloat` and `asVec3` convert, the way
Blender converts silently between a number and a colour.

## Where a value lands

Every shader node answers a **surface**: colour, roughness, metallic, alpha,
emission and normal together. Mix Shader and Add Shader blend all six. The
surface wired to the Material Output fills `colorNode`, `roughnessNode`,
`metalnessNode`, `emissiveNode`, `normalNode` and `opacityNode` on a
`MeshStandardNodeMaterial`.

A material turns transparent only when its alpha is linked or below 1.

## When a material looks wrong

| what you see | what to check |
|---|---|
| flat grey, unchanged | `blender.shaders` — the graph needs a node that is not translated |
| black | a colour socket driven by a number, or a ramp with no stops |
| the pattern is the wrong size | `Mapping` scale; the default coordinates are the model's local position, not its UVs |
| nothing swapped | `blender.shaders.apply`, then check the material NAME matches the one in the `.glb` |

A material is matched to its graph **by name**. Renaming a material in Blender
and not re-importing breaks the join.

## When it rebuilds

A change to a `*.shaders.json` rebuilds every material, because the plugin
listens for it. A new model is picked up within a few frames: the swap runs on
`frame:painted` while the world is stopped and on a `frame` system while it
plays, since neither fires in the other state.
