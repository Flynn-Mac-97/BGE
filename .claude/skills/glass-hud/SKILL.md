---
name: glass-hud
description: The readouts over live play — score, health bar, ammo, timer — declared in the level and bound to `world.state`. Use when putting a value on screen during play. For a full-screen menu or card, use Screen.
---
<!-- generated from plugins/builtin/hud.agent.md at server start; edits are lost -->

# HUD

- Declare HUD text and bars in the level.
- Read values from `world.state` with `{name}`.
- Check text with `hud.read`.
- `hud.toggle` — show or hide the whole HUD, so a capture can be taken without it.
