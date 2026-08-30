---
skill: none
---

# Particle Painter

- Draws the Particles field: camera-facing quads in shared buffers on `context.renderer.scene`, one draw call per texture-and-blend group.
- Untextured particles are soft round dots; `blend: 'add'` glows; `fadeTo` slides the colour over the particle's life in linear light.
- It owns no state worth asking about and contributes no commands — `particles.state` on the Particles plugin is the honest count.
- Headless it does nothing at all, on purpose: three is imported only after `shell:ready` hands it a renderer.
- Check the picture in a browser frame; check the numbers with `particles.state`.
