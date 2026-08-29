# World Look

- Owns the fog and the global light of a level: `fog`, `ambient`, `sun`, declared in the level's `world` block. Keep it as declared data.

```json
"world": {
  "fog": [0.014, "#8a94a3"],
  "ambient": { "intensity": 0.55, "color": "#93a7c4" },
  "sun": { "direction": [-0.4, -1, -0.3], "intensity": 0.9, "color": "#fff2d8" }
}
```

- **`fog` is exponential-squared and has no near or far.** A surface is washed out by `1 - exp(-(density * metres)²)`, so it is half gone at `sqrt(ln2) / density` — 60 m at 0.014. It takes any of: a number (density), a colour string, `[density, colour]`, or `{ density, color }`. `false` turns it off; the default density is 0.014 and the default colour `#93a7c4`.
- **The fog colour should sit near the sky just above the horizon.** Lighter than the sky and distant geometry reads as pale blocks standing in front of it rather than dissolving into it.
- `ambient` takes a number, a colour, `[intensity, colour]` or `{ intensity, color }`.
- `sun` takes a number, a colour, `{ intensity, color, direction }`, or a bare array — **an array on `sun` is its DIRECTION, not an intensity-and-colour pair**. `direction` is the direction the light travels.
- **`world.sun` cannot cast a shadow.** Only a light entity can — see the Lights guide. Use `sun` as fill and a `type: "light"` directional as the key.
- The sky is the Skybox plugin's (`sky`, `skyTexture`); post-processing is its own and reads `world.post`. `world.look` and `world.set` still report and change the whole `world` block, reading the sky's part from Skybox.
- Drivable, so finding the numbers is a round trip rather than an edit and a reload:
  `run world.look` · `run world.set '["fog", 0.02]'`. Check the result in a browser frame.
