# Kitten Effects

- Owns this game's particle looks, as tables at the top of the file: hit sparks per weapon plus a white core (`weapon:hit`), the death pop (`enemy:died`), gem sparkle — idle glints, a latch trail, a landing pop (`pickup:latched` / `pickup:collected`) — and the gold level-up burst (`experience:levelled`).
- Restyles the builtin `muzzle-flash` and `brass` that Combat Effects fires on every shot. **A weapon firing may never cover the thing that fired it.** The engine's flash is one 0.4 m additive quad placed 0.3 m from the shooter, which inside a 0.5 m kitten repaints up to 20.3% of its silhouette; this game's is five 0.055 m dots thrown along the fire direction, which measures 4.2% at its worst frame and is clear of the body by the next one. Brass is set to nothing — a cat ejects no shell casing. Measure it again with `agent-runs/2026-08-31-brawl-stars/feel2/flash-cover.mjs`.
- Also owns what may mark the ground: `place` on the decal wall is wrapped to refuse a mark with no texture, because an untextured decal draws as a solid tinted square. The engine ships no decal art, so this game puts down no marks. Name a picture in `context.particles.art` and marks come back with no change here.
- The vocabulary is one thing at three sizes: small, fully saturated, gone in under a quarter second. Never a cloud, never a dark stain — see `art/effects/rulings.json` and `agent-runs/2026-08-31-brawl-stars/reference/what-the-frames-show.md`.
- Counts stay small because a hundred enemies die at once. Gem landings and idle glints are pooled on the fixed clock: forty gems arriving is one swelling pop, and one gem glints per beat, not two hundred.
- Tune the game's feel here and only here. The machinery is the Particles builtin; how hard a hit punches is Kitten Hit Feel.
- Idle glints and landing pops tick on the fixed clock through the engine's seeded random — a replay sparkles the same.
- `kitten.effects.preview` fires one of each look at the kitten. `kitten.marks` says how many marks were refused and what decal art the project has named.
- It refuses nothing loudly: a missing point or a level with no `you` simply does nothing.
