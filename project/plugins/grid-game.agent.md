---
category: gameplay
description: Black Bell's serializable inventory-grid rules, shared effects, triggers, statuses and bounded resolution.
triggers: grid rules, modular items, effect vocabulary, gridGame
---
# Black Bell Grid

`context.gridGame.createRules(catalog)` compiles plain item, ability and status records. No item IDs select resolver behaviour. See `design/grid-rules.md` for the data contract and timing.

- `createState(setup)` creates actors and distinct item instances.
- `addItem(state,id,type,owner)`, `place(state,id,[x,y] | null)`, `resize(state,columns,rows)` mutate planning state atomically and return success.
- `resolveCycle(state,{afterCycle:['enemy']})` returns `{state,trace,work}` without mutating input. Trace snapshots are independent.
- `resolveEvent(state,event,options)` resolves a single externally supplied event.
- `targets`, `cells`, `adjacent`, `stat`, `winner` support inspection and previews.
- Catalogs are cloned, validated and frozen. State and trace contain only JSON-compatible records.
- Work budget defaults to 1024 tasks, extra-activation cap to 8 per instance per resolution. Circular activation paths are blocked. Unbounded reaction chains throw without changing input.
- Commands: `gridGame.vocabulary`, `gridGame.validate <catalog>`, `gridGame.resolve {catalog,state,options}`.
- No renderer or engine clock in the core. The game presents snapshots on fixed time.
- Tests: `node --test tests/*.test.mjs`, engine headless `run tests.run`.
