# Keeping an effect affordable

Triangles are cheap. **Overlapping transparent pixels are not** — an additive
layer has no early-z, so the cost is the number of screen pixels it covers times
how many layers deep it is. This is what breaks a frame, not the count.

- Both fields batch: one draw call per texture-and-blend for particles, one per
  blend for beams. Keep it that way — never one mesh per particle.
- A large soft additive quad is the most expensive thing on the screen. Prefer
  several small ones.
- Particles cap at 3000 and beams at 64, oldest dropped. Read `dropped` in
  `state`; a number climbing means the effect is asking for more than it gets.
- Scale down with distance. A far effect can be one flash and nothing else.
