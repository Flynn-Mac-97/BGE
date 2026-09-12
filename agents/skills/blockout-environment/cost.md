# Build technique, and what a run costs

## Build

**Use the whole of Blender.** Primitives alone are not a blockout. Terrain is
a function you keep and query, not a mesh you inspect - then pads, paths, prop
heights and camera heights all read from one source and agree. Generators
built to unit height scale per instance, so a roof line lands flat over rough
ground. Scatter loops vary every instance, because an array reads as a fence.
One mesh across hundreds of instances with the material overridden per
instance is aerial depth in greyscale, for free.

`references/blender-techniques.md` has the techniques proven in real runs -
terrain, shrinkwrap, booleans, modular kits, physics, the bevel-and-shade pass
and the three parts of it people drop.

**Build the tool you need, mid-build.** If a form would take fifty hand-placed
parts, write the generator instead, and log it.

## Cost

Cost is turns x context. Rewrite scripts whole rather than patching them line
by line - 76 tokens of context per part that way, 681 patching a live scene
object by object. That works while the script is small, which is exactly what
the kit split is for: keep each file small enough that rewriting it whole stays
the cheap option. One run let its single build script reach 63 KB, about 16,000
tokens, and spent a third of the run retyping it.

Never read your own scripts back; you wrote them. One Blender run per script
per pass, and a kit part that has not changed does not need re-running at all.
Render 640 px and only what you will read. Print only what you check in code.
