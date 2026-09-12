# What it refuses, and says

- `[Skybox] "purpleish" is not a colour the sky can use — it is neither a #hex value nor one of the CSS colour names — falling back to #6d7f96`
- `[Skybox] skyTexture must be the name of one image file` for anything that is not a non-empty string.
- `skybox.set` throws `no sky key "fog". One of sky, skyTexture` — fog belongs to `world.set`.
- `skybox.set takes one JSON argument — run skybox.set '["sky", <value>]'` when given a bare string.
- `[Skybox] this renderer has no setSky() — that part of the level's world block was not applied`. Those are said once each.
- `[Skybox] the sky texture "skies/dawn.png" did not load, so the flat sky colour is showing` — `skyBox` then reports `failed` and the next apply tries again, so this line repeats; so does a `world` block that could not be read off disk.
