# Black Bell grid rules — prototype contract

The game uses plain JSON-compatible records. A compiled catalog holds item definitions, shared ability blocks and status definitions. A battle holds actors and distinct item instances. Family tags describe an item's setting; they never restrict who can equip it.

## Authoring

Edit `plugins/bell/catalog/items.js` to add or tune an item. Edit `catalog/abilities.js` for a reusable ability. `plugins/bell/catalog.js` assembles those records and statuses. No resolver or UI branch is needed for a new combination of existing blocks.

Example item:

```js
{
  name: 'Iron Sword', mark: 'I', footprint: [1, 3],
  tags: ['weapon', 'blade', 'combat'],
  stats: { damage: 5 }, abilities: ['strike'],
  description: 'Deal 5 damage. Needs a full column.'
}
```

Example ability:

```js
{
  id: 'nearbyHealing',
  trigger: {
    event: 'damageDealt',
    source: { kind: 'adjacentItems', tags: ['weapon'], ownerOnly: true }
  },
  target: { kind: 'owner' },
  effects: [{ type: 'heal', amount: 2 }],
  limit: { perCycle: 1 }
}
```

A shared ability uses its catalog key as its ID. Inline abilities need an explicit ID. Item definitions support `resources`, `resourceCaps` and `auras` as well as the fields above. Auras are constant stat contributions with a selector; they recompute from the actual layout.

## Vocabulary

| Block | Supported values |
| --- | --- |
| Trigger event | `combatStart`, `cycleStart`, `cycleEnd`, `ownTurn`, `itemActivated`, `damageDealt`, `damageTaken`, `statusApplied` |
| Target kind | `self`, `selfItem`, `owner`, `enemy`, `eventSource`, `eventTarget`, `adjacentItems`, `directionalNeighbour`, `allItems` |
| Effect type | `damage`, `heal`, `guard`, `applyStatus`, `removeStatus`, `modifyStat`, `resource`, `triggerItem` |
| Condition kind | `hasTag`, `hasStatus`, `resourceAtLeast`, `healthBelow`, `cellEmpty` |
| Duration | `instant` for direct stat changes; `nextAction`, `cycle`, `combat`, `whileAdjacent` for ongoing effects |
| Limit | `perCycle`, `perCombat`, `charges`; optional `refill: 'cycle'` |

Selectors accept `tags` (all must match) and `ownerOnly`. Directional neighbours need `direction: 'right'|'left'|'up'|'down'`. Targets are unique instances touching the entire indicated edge, not just a top-left cell. `enemy` chooses the first living hostile actor by ID. Adjacency excludes diagonals.

Amounts are a finite number or one expression: `{stat:'damage'}`, `{resource:'hunger'}`, `{stacks:true}`. Expressions read the source of the effect; stack expressions read the active status. An effect may override the ability's target with its own `target` selector. Health and guard affect actors; `triggerItem` affects item instances.

Conditions are ANDed. By default they inspect the selected target. Set `subject` to `self`, `selfItem`, `owner`, `enemy`, `eventSource` or `eventTarget` to inspect another reference. `healthBelow` accepts an absolute `amount` or `ratio`. `cellEmpty` checks the complete directional edge of the source item; off-grid space is not empty storage.

Costs are `{target,resource,amount}` entries. They select exactly one unit, aggregate before evaluation, and spend atomically only when the ability has an eligible target and an available use. Negative resource effects also exist, but costs are the conditional-spending mechanism. Gains respect each unit's resource cap.

Hunger in the demo belongs to the recruit and caps at nine. Multiple Hungry Teeth feed that same pool; a Blood Cup spends it. Other catalogs can put resources on each item instead. No pool is implicit.

## Timing

1. Combat-start event runs once.
2. Cycle-start statuses and abilities run.
3. Equipped items activate in row-major order by their top-left anchor, once per normal scan regardless of footprint size.
4. Each ability reserves its limit/cost, then applies effects in declared order. Reactions run immediately after that ability and before the next item.
5. Cycle-end effects run, including Poison damage and its one-stack decay.
6. The demo enemy takes its turn, unless already dead.
7. Unused cycle preparation and guard expire. If a team won, combat-duration effects expire; otherwise the next planning cycle opens.

For each event, status listeners precede ordinary abilities. Own-turn, activation, damage-dealt and status-applied triggers default to the source item/actor; damage-taken defaults to the target. An explicit trigger `source` selector watches other sources. Lifecycle events broadcast to eligible living listeners.

`nextAction` is consumed after the next successful own-turn ability, so all effects in that ability share the preparation. `expires:'cycle'` is an optional fallback. `whileAdjacent` contributions suspend when either item leaves the edge. Use declarative `auras` for continuous placement bonuses. Same-source, same-ability stat modifiers replace their previous value; distinct sources add. Status stacking can add, replace or take the maximum, with an optional cap.

Poison and Regeneration are status records containing the same ability/effect blocks as equipment. Poison deals stack damage at cycle end, bypasses guard and removes one stack. Regeneration heals stack health at cycle start and removes one stack. Venom coating modifies the weapon's `poisonOnHit` stat until used or expired.

## Safety and state

`createRules` clones, validates and freezes a catalog. `createState` gives each item its own ID, type, owner, position, stats, resources, statuses, modifiers and usage counters. A position is `[x,y]` or `null` for reserve. Grid width can grow on the right without shifting coordinates. Placement and resize are atomic planning operations.

Resolution clones its input and returns independent snapshots. Extra actions use a queue, not recursive calls. A circular activation path is blocked and logged. Extra activations are capped per instance. A reaction chain exceeding the work budget throws without mutating input. These checks do not claim that every possible user-authored loop is a valid design.

The prototype only changes topology between cycles. It does not yet implement sockets, arbitrary footprint shapes, cross-character inventories or inventory-item-driven storage expansion. The core resize operation supports full-height right expansion; this demo awards columns at fixed depth milestones. A future storage module can invoke the same operation.

## Verification

`node --test tests/*.test.mjs` checks rules, UI locks and progression. Engine headless `run tests.run` executes the same cases. `node tools/playthrough.mjs` earns items through real fights and tests reward/placement decisions over twelve rooms with fixed seeds. It is a balance probe, not evidence of subjective enjoyment or device frame rate.


## Storage and acquisition

Item definitions may include `storage: { columns: 1 }` (integer 1–9). A storage instance uses `position: [leftColumn, 0]` to identify an attached full-height container region. It occupies no equipment cells: `cells` returns an empty array for storage. Reserve storage adds nothing. `baseColumns` records the base width; total width is capped at twelve.

Attach with `place(state,id,[state.grid.columns,0])`. Pack regions must form a contiguous chain starting at the base right edge. Ordinary items can occupy the resulting cells; adjacency and directional effects work across joins. Stowing with `place(...,null)` succeeds only for an empty outermost pack. Placement and resizing validate the full arrangement atomically. Base resizing with attached packs is refused if it would break their fixed attachment coordinates. Room transitions preserve attachment IDs and coordinates. The UI provides a tap-only right-edge socket outside the scrolling grid, plus an Attach right action; attached entries select the pack for Detach or Salvage.

Acquisition is separate from combat effects: ordinary rooms yield one scrap and three recovery on `descend`; every fourth room yields one item choice on `claim`. Both actions are single-use. Caches cost twelve scrap and never advance rooms. The first item choice is room four; room eight offers pouch/pack/sword. Intervals and enemy numbers are provisional; detailed scaling design is deferred.
