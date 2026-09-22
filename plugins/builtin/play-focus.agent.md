---
skill: none
---

# Play Focus

- Playing collapses the docks to the viewport. It never goes full screen.
- Full screen is the FOCUS button's job, because only a real click can ask for it.
- `play.focus` reports the state. `play.focus true` collapses without the screen; `play.focus '{"on":true,"fullscreen":true}'` also asks for it.
- Keep editor shortcuts separate from game input.
