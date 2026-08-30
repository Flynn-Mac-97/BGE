# Kitten Hit Feel

- One table saying how hard every hit in this game punches. Tune the feel of the whole game here and nowhere else.
- Listens to `entity:hurt` and `entity:killed` and calls `context.impact.hit` with a weight per damage source.
- A hit on the player outweighs everything else on screen; a kill always outweighs the hit that caused it.
- Sets `damageNumbers.defaults` once for this camera and this crowd: 1 m tall, and a short life with a fast rise so a hundred hits a second do not leave the screen full of figures.
- Restyles the builtin `blood` and `explosion` effects into this game's star burst — small, fully saturated, additive, gone in under a quarter second. That is how a game changes the look of the builtin hit wiring without turning it off. Combat Effects' own counts already scale a hit against a kill.
- It owns the punch, not the look. What a hit or a death is made of is Kitten Effects.
- Sounds are named, not shipped: `hit`, `hurt`, `squeak`, `down`. They record in `audio.recent` and go silent until a type declares the files.
- Check with `kitten.feel`.
