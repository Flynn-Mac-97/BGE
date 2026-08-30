# Kitten Effects

- Owns this game's particle looks, as tables at the top of the file: hit sparks per weapon (`weapon:hit`), fur death puffs (`enemy:died`), gem sparkle — idle glints, a latch trail, a collect pop (`pickup:latched` / `pickup:collected`) — and the gold level-up burst (`experience:levelled`).
- Tune the game's feel here and only here. The machinery is the Particles builtin; the generic hurt-and-kill dust is Combat Effects plus Kitten Hit Feel's `define('blood', ...)` recolour.
- Idle gem glints tick on the fixed clock through the engine's seeded random — a replay sparkles the same.
- `kitten.effects.preview` fires one of each look at the kitten, for a browser frame or a headless `particles.recent` read.
- It refuses nothing loudly: a missing point or a level with no `you` simply does nothing.
