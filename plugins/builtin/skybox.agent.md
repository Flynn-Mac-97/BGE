# Skybox

- Controls the sky around the level: a flat colour or a panorama mapped over a sphere.
- Declared in the level's `world` block (`sky`, `skyTexture`) — keep it as declared data where possible.
- `skybox.look` and `skybox.set` report and change the sky for the session.
- `world.look` / `world.set` still answer for the whole `world` block, reading the sky's part from here.
- Check visual changes in a browser frame.
