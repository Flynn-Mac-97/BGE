# Kitten Danger

- Joins the crowd to the kitten's health: every enemy in reach bites on its own half-second cooldown, so standing in ten hurts ten times as much as standing next to one. Without it the run cannot be lost.
- Arms the kitten's health pool on `play:started` and hands it to the Run Clock, so the run ends when the kitten does.
- Warns before the teeth arrive: anything within `WARNING_BAND` metres of contact triggers one red pulse at the kitten, throttled and sized by how many are closing. One burst however large the crowd.
- Each bite that lands throws a red spark halfway to the enemy that made it, so a bite has a place on screen.
- Full-saturation red is reserved for danger — nothing else in this game uses it, so a threat is separable by colour alone.
- `kitten.danger` says what is biting, what is closing, and how much damage a second the kitten is standing in.
