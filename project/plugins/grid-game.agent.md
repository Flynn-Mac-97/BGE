---
category: gameplay
description: Black Bell's serializable inventory-grid rules, shared effects, triggers, statuses and bounded resolution.
triggers: grid rules, modular items, effect vocabulary, gridGame
---
# Black Bell Grid

`context.gridGame.createRules(catalog)` compiles plain item, ability and status records. No item IDs select resolver behaviour. See `design/grid-rules.md` for the data contract and timing.

- `createState(setup)` creates actors and distinct item instances.
- `addItem(state,id,type,owner)`, `place(state,id,[x,y] | null)`, `resize(state,columns,rows)` mutate planning state atomically and return success.
- `storage: {columns}` on item data defines an attached full-height region at [rightEdge,0], with no occupied cells. `baseColumns` excludes storage. Packs form a contiguous chain; detach only empty outermost packs. Ordinary item interactions cross joins; `resize` sets base dimensions.
- `resolveCycle(state,{afterCycle:['enemy']})` returns `{state,trace,work}` without mutating input. Trace snapshots are independent.
- `resolveEvent(state,event,options)` resolves a single externally supplied event.
- `resolveFight(state,{ownerOrder,maxCycles,record})` resolves whole fights on one private copy with cached geometry/listeners and the same effects/limits. `record(kind,detail)` receives borrowed read-only details; copy them if retained. Returned state has no caches.
- `createFightRunner(state)` validates/captures once and returns `options => result` for independent repeats. Status membership changes invalidate event routing. Pending work uses a stack preserving reaction order.
- `targets`, `cells`, `adjacent`, `stat`, `winner` support inspection and previews.
- Work budget defaults to 1024 tasks, extra-activation cap to 8 per instance per resolution. Circular activation paths are blocked. Unbounded reaction chains throw without changing input.
- Commands: `gridGame.vocabulary`, `gridGame.validate <catalog>`, `gridGame.resolve {catalog,state,options}`.
- Tests: `node --test tests/*.test.mjs`, engine headless `run tests.run`.
- Actors may supply `inventory:{columns,rows}` (all actors or none), isolating geometry/storage. Shared ability IDs expand for actor abilities as for items.
- `resolveCycle` accepts `ownerOrder:[actorIds]` for per-owner item scans plus intrinsic turns before cycle-end statuses; do not combine with `afterCycle`. Existing default timing is unchanged.
- `trace:'events'` omits per-event state snapshots; `'none'` omits events; default `'full'` retains gameplay snapshots. All modes preserve limits, input immutability and outcomes.

- `relationships(state)` returns directed stat-aura/grant edges. `area` and `containerItems` target space; `grants` add recipient abilities while emitters live. Numeric extensions and timing contracts: `design/item-primitives.md`; runnable catalog: `grid-game/storm-example.js`.
