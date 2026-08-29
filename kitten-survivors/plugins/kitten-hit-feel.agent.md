# Kitten Hit Feel

- One table saying how hard every hit in this game punches. Tune the feel of the whole game here and nowhere else.
- Listens to `entity:hurt` and `entity:killed` and calls `context.impact.hit` with a weight per damage source.
- A hit on the player outweighs everything else on screen; a kill always outweighs the hit that caused it.
- Also renames the builtin `blood` and `explosion` particle colours to fur and dust, which is how a game changes the look of the builtin hit wiring without turning it off.
- Sounds are named, not shipped: `hit`, `hurt`, `squeak`, `down`. They record in `audio.recent` and go silent until a type declares the files.
- Check with `kitten.feel`.
