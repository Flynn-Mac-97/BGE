# Determinism

- Every number comes from `context.random`, which a level load reseeds from the
  level's `seed`. **The same seed grows the same field, for ever.**
- It is the level's one simulation stream, so adding or retuning a scatter moves
  every draw made after it, in level order. Two scatters in one level are grown
  in the order the entities appear in the file.
- Sampling costs two draws per attempt and four more per placement, so the draw
  count depends on the rule and nothing else.
