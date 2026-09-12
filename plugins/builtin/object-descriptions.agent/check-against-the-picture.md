# Check an authored sentence against the picture

This is the workflow the verbs exist for, and the first thing to run when a
description feels off:

```sh
run description '{"type":"rat"}'          # what the author says a correct one looks like
run see.capture '{"subject":"rat-80"}'    # what one actually looks like
```

Ask the picture the positive question first — what do you see — then compare it
against `appearance` yourself. Where the two disagree, the disagreement IS the
finding: either the art changed and the sentence went stale, or the art is
broken. Nothing in the engine checks these sentences, so this comparison is the
only thing that catches a stale one.

Never paste `appearance` into the question you ask a vision model. A model
adopts a judgement it is handed and will report seeing whatever you described.
That is why `appearance` is absent from every See sidecar.
