# Codebase design

Codemap's rules; the engine's rules win where they disagree.

- A module has an interface and an implementation: a function, a file, a folder. The interface is all a caller must know: parameters, return, errors, order, side effects.
- Make a module deep: a small interface over much behaviour. Before adding a method or parameter, ask if the interface can shrink.
- Deletion test: if deleting a module only moves its code into its callers, it was a pass-through. Do not add one.
- Earn a seam: swap an implementation behind an interface only when two real ones exist.
- Pass dependencies in; return the result rather than changing shared state where you can.
- The interface is the test surface; test through it.
- One record, one shape. Two hand-written projections drift, and the untested one drifts in silence.
