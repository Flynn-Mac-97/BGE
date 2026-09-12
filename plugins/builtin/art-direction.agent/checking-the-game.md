# Checking the game against it

```sh
node bin/engine.mjs run see.capture '{"marks":false,"ui":false,"name":"look"}'
node bin/engine.mjs run art.check '{"frame":"agent-runs/see/look.png"}'
node bin/engine.mjs run art.compare '{"reference":"hades-arena.png","frame":"agent-runs/see/look.png"}'
```

`art.check` returns `broken` and `held` for the measured rulings, and lists the
judged ones without scoring them. `art.compare` writes one sheet, reference on
the left and frame on the right, at one height and unmarked. Ask it a single
forced choice, then ask again with the sides swapped; a flipped answer means
there is no difference to find.
