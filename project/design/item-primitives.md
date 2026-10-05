# Item primitives and directed relationships

Items, abilities, statuses and relationships are plain records. The shared rule functions interpret them. There are no item subclasses or per-item update scripts. The catalog compiler validates and freezes authoring data. The existing eight effects remain supported.

## Spatial selection

An `area` selector uses `shape: 'rays' | 'row' | 'column' | 'radius'`. Rays default to up/down/left/right, range1. `directions` selects cardinal rays; `range` is an integer1–12. `first:true` stops each ray at its first occupied item before tag filtering. Other items do not block rays by default. Rows and columns include items overlapping any row/column of the source footprint. Radius uses minimum Manhattan cell distance. Recipients are unique and ordered by normal activation order. The source is excluded.

Every occupied cell of the full footprint participates. Actor-local inventories remain isolated. On a shared grid, `ownerOnly:true` restricts recipients. Tags filter item definitions. Rays cross attached pack seams. Storage itself has no occupied cells and emits no spatial rays.

`{kind:'containerItems'}` selects ordinary items whose entire footprint lies inside the source storage item's column region. It excludes items straddling a seam and other owners. Base inventory space is not a container item. Geometry is indexed lazily per fight and remains fixed during combat; planning queries rebuild from current placement.

## Directed graph and empowerment

`rules.relationships(state)` returns an isolated snapshot `{nodes,edges,outgoing}`. Nodes are placed item IDs. Each edge contains `kind`, source item ID `from`, target reference `to`, and local relationship `id`. Targets of stat auras can also be actors. `outgoing[itemId]` contains indices into the edge list. `statAura` edges carry stat/amount; `grant` edges carry abilities. This graph describes influence, not automatic activation.

An item can author:

```js
grants: [{
  id: 'electricAura',
  target: {
    kind: 'area', shape: 'rays',
    directions: ['up', 'down', 'left', 'right'], range: 1,
    tags: ['weapon'], ownerOnly: true
  },
  abilities: ['shockHit']
}]
```

`shockHit` can listen for the recipient's `damageDealt`, select `eventTarget`, and apply Shock. The granting item supplies the relationship; the recipient supplies source stats, resources and ability execution. Record events include `grantor` for presentation. The recipient and emitter must remain alive, and the emitter equipped. Planning moves/detaches rebuild recipients on the next resolution. Grant selectors must select fixed item recipients, not enemy or event references.

Each emitter contributes once per recipient per grant. Multiple emitters add independent abilities with independent limits. Limits are keyed by emitter/grant/ability identity; ordinary abilities do not collide. Grant abilities execute after ordinary abilities, following emitter and recipient scan order. Existing status listeners run before ordinary and granted listeners. A grant does not itself activate its recipient or recursively grant another ability. Trigger-item effects retain activation-path protection and work limits.

`plugins/grid-game/storm-example.js` is a complete runnable catalog, separate from the live item pool. It grants one Shock application per weapon per cycle per emitter. Its prototype Shock accumulates to8, then consumes its stacks at cycle end for equal damage bypassing guard. This is an example status definition, not a fixed engine meaning for electricity.

## Numeric effect additions

| Effect | Required fields | Semantics |
| --- | --- | --- |
| `removeGuard` | `amount` | Remove up to the target actor's current guard. |
| `consumeStatus` | `status,amount` | Remove up to the available stacks; report actual consumption. |
| `transferResource` | `from,resource,amount` | Select exactly one donor; transfer up to availability and recipient capacity. Same donor/recipient moves zero. |
| `modifyCharges` | `ability,amount` | Adjust an intrinsic charged ability by signed amount, clamped0..authored maximum. Does not reset per-cycle/combat usage limits. |

Transfer preserves total resources. If multiple targets are selected they receive resources sequentially in target order. A missing or ambiguous donor is an authoring/runtime error; guard it with conditions if necessary. Charge modification requires an actual charged intrinsic item/actor ability; it does not address status-granted or aura-granted abilities.

`{previous:true,scale:2}` uses the actual amount returned by the immediately preceding effect/target application within this ability, multiplied by2. It starts at zero per ability. It is not a sum over all previous targets. `{eventAmount:true,scale:0.5}` reads the triggering event's amount, or zero if absent. Existing `{stat}`, `{resource}`, `{stacks:true}` and constants remain unchanged. `{grantorStat:'potency'}` in a granted ability reads the granting item's stat, so a totem's level grows what it gives; outside a grant it is zero. Numbers may be fractional; the core does not silently round.

Example: consume up to4 Curse from one enemy, then damage that enemy by `{previous:true,scale:2}`. This prevents a2-stack enemy from paying out as though4 stacks were consumed. Fixed resource conversion is already expressed by an ability resource cost followed by a resource effect.

## Timing

Existing combat/cycle/activation/damage/status events remain the timing vocabulary. Added conditions: `cycleAtLeast` and `cycleEvery` require a positive integer `amount`; `eventAmountAtLeast` requires a nonnegative amount. For a one-time third-cycle payoff, combine `cycleStart`, `cycleAtLeast:3` and `limit:{perCombat:1}`. Conditions, costs and limits are checked when the ability executes.

This pass does not implement sockets, arbitrary scheduled future tasks, loot generation, damage-type conversion or strongest-only grant stacking. Those require their own explicit data contracts rather than special cases inside these primitives. Existing storage attachments are supported.

## Verification

`tests/primitives.test.mjs` compares full events, final state and work counts between cycle resolution and compiled fights. It covers four-way grants, diagonals, independent inventories, dead emitters, additive sources, detaching, ray blockers, graph isolation, resource conservation, status consumption, charging, guard stripping and container seams. Existing simulation and game suites remain required. No renderer or browser is needed to author or execute this catalog.
