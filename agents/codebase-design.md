# Codebase design

Codemap's design rules. They add to the engine's rules; where the two disagree,
the engine's rule wins.

- A module is anything with an interface and an implementation: a function, a
  file, a folder. The interface is everything a caller must know — parameters,
  return, errors, order, side effects.
- Make a module deep: a small interface with a lot of behaviour behind it.
  Before adding a method or a parameter, ask whether the interface can be
  smaller and more can be hidden inside.
- Apply the deletion test. If deleting a module only moves its code into its
  callers, it was a pass-through. Do not add a pass-through layer.
- Earn a seam. Add an interface to swap an implementation only when two real
  implementations exist.
- Accept dependencies as parameters; do not create them inside. Return the
  result instead of changing shared state where you can.
- The interface is the test surface. Test through it, not past it.
