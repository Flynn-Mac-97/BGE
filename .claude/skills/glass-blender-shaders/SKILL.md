---
name: glass-blender-shaders
description: Rebuilds a Blender material's node graph as a live TSL shader, so a look designed in Blender draws in the engine. Use when a Blender material arrives flat grey, when a procedural look must move, and when a node type is reported as untranslatable.
---
<!-- generated from plugins/builtin/blender-shaders.agent.md at server start; edits are lost -->

# Blender Shaders

Design the material in Blender. The engine rebuilds the node graph as a TSL
shader and draws it. Nothing is written by hand.

`blender.import` writes `<model>.shaders.json` beside the `.glb`. This plugin
reads it, builds the network in TSL, and swaps it onto any surface whose
material name matches.

## The loop

1. Build the material in Blender with nodes.
2. `node bin/engine.mjs --headless run blender.import '{"all":true}'`
3. The shader is live in the open editor. No reload, no second file.

## The one rule

**A material is swapped only when EVERY node in it can be translated.** A graph
with one unknown node keeps the material the `.glb` already carried — which is
right for plain values and image textures, and is why an untranslatable graph
never makes a surface worse.

`blender.shaders` names what each material still needs.

## Commands

- `blender.shaders` — every material graph, whether it translates, and what it needs.
- `blender.shaders.apply` — re-read the graphs and rebuild every material.

## What translates

56 node types. Textures: Image, Noise, White Noise, Voronoi (F1, F2, edge),
Checker, Brick, Magic, Gradient, Wave. Shaders: Principled, Emission, Diffuse,
Glossy, Transparent, Glass, Translucent, Background, **Mix Shader**, **Add
Shader**. Normals: **Bump**, **Normal Map**, Normal. Plus coordinates, Mapping,
Vector Rotate, Object Info, Attribute, Colour Ramp, RGB/Float/Vector Curves,
Mix, Math and Vector Math (every operation), Separate/Combine, Map Range, Hue,
Gamma, Blackbody, Fresnel, Layer Weight.

Images a graph samples are written to `<model>.textures/` and loaded in the
colour space Blender set on them.

Node groups, nested groups, reroutes and muted nodes are flattened into plain
nodes when Blender exports, so they work wherever their contents translate.

## What does not

Light Path, Wavelength, Vector Transform, Displacement and script nodes.
`blender.shaders` names each one a material still needs.

Add a node type: one entry in `plugins/builtin/blender-shaders/nodes.js`, then
its name in `TRANSLATABLE_TYPES`. The test builds every listed type.

## It is close, not identical

Blender's noise is Blender's own, and Cycles is a path tracer while this engine
rasters. Patterns, colours and scale land in the same place; pixel-exact they
are not. Judge the look in the engine, not in Blender's viewport.

## Detail

- `plugins/builtin/blender-shaders.agent/translating.md` — how a graph becomes a
  shader, how to add a node type, and what to check when a material looks wrong.
