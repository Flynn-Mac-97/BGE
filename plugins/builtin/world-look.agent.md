# World Look

- Controls the fog and the global light (ambient, sun) around the level.
- Declared in the level's `world` block — keep it as declared data where possible.
- `world.look` and `world.set` report and change the whole `world` block, including the sky's part (read from the Skybox plugin when it is loaded).
- The sky itself is the Skybox plugin's; `skybox.look` / `skybox.set` own it directly.
- Check visual changes in a browser frame.
