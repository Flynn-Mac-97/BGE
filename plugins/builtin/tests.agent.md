---
match: project/tests/**
---

# Tests

- Runs lasting checks from `project/tests/`. One file, `export default { name, level, run(test) }`.
- Arrange, simulate fixed time, then assert. Never write to a level — a test run marks the world simulated, and a simulated world refuses to save.
- Use headless tests for safe parallel runs.

## What `test` gives you

- **Assert:** `is(got, want, msg)` `near(got, want, tol, msg)` `ok(cond, msg)` `note(msg)`.
- **A test that asserts nothing fails.** `note` records a line and does not count.
- **World:** `entity(id)` `count(type)` `exists(id)` `at(id,x,y)` `set(id,key,value)` `spawn` `destroy` `attach` `detach` `state` `entities`.
- **Time and input:** `simulate(seconds)` `hold(action, seconds)` `tap(action)`. No real time passes.
- **The engine:** `test.context` — the live context, the same object a hook gets. Ask any plugin-contributed verb: `test.context.canStand(...)`, `test.context.camera.aim()`, `test.context.input.look(...)`.
- **Commands:** `test.run(id, args)` — drive the editor the way the terminal does.
- **Events:** `test.on(event, handler)` — dropped for you when the test ends.

Never import a plugin module to reach its live state. Everything is on `test.context`; a module handle is a second copy waiting to disagree.
