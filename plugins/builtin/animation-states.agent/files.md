# The three files

The full contracts are at the top of the code; this is where to look.

- Graph and set files: `animation-states/graph.js`. `folder` makes a take name
  a clip file; a set later in the list wins over an earlier one.
- The machine's rules (priority order, `from`, once states with `then`,
  `turns` for a turn in place, `hold` 0 to let go of the item): `animation-states/machine.js`.
- Hold records (sockets, mounts, guard, motion, `set`): `animation-states/held-items.js`.
- Scaffold names and the inputs its transitions read: `animation-states/scaffold.js`.
- What `animation.graph` checks: `animation-states/report.js`.

An action plays a take or follows keys. A path action has a `hand` track
(where the holding hand goes) and a `blade` track (which way the item points,
laid on the hand), each `[{ at, guard, ease }]`; the hands stay locked to the
item (`animation-states/guard-path.js`), so nothing in a take can break it.
Each track is a smooth curve through its keys. Shape the hand's arc first,
then the blade's; a blade key a little after the hand's makes the blade trail
the hand. `body` (0 to 1, 0.3 by default) is how much the spine turns and
leans after the item. `next` and `link` make a combo: a second ask while it
plays chains into `next` at `link` seconds, from where the item is. The hold
keeps the hand far enough in front of the chest that the arm does not go into
it. A person builds one by eye on Kimodo's hold board: hold the item, pick the
action, pick the hand or blade arc, and drag each key while both arcs are
drawn; Play combo plays the chain. A path action may name a take too, with
`mask: 'lower'` and a `speed` that fits it to the keys: the take steps the
feet and drops the hips while the keys move the item; a chained action with
no take keeps the one playing. The hold keeps each wrist in a person's range
(a `wrist` constraint), so a key a wrist cannot reach turns the item only as
far as it can. A take action:
`{ clips, mask, hold: { holding, other }, speed }`; `mask` is 'upper', 'right-arm' or 'left-arm' (the spine and one arm, so a one-handed swing leaves the other arm to the state), 'all', or a list of nodes.
While it plays, `acting` is an input the graph can read, so a transition can
stop a sprint during an attack.

Two items: game code sets `entity.offHandItem` too, and the same hold record
is held in the other hand as seen in a mirror (grip, guard yaw and roll). Its
`offSet` names a set that turns on only then and wins over the item's own set,
so a dual set can give its own `attack`. A path action with `item: 'off'`
moves the off-hand item; write its keys as for the holding hand, and they
are mirrored as they play. `animation.hold '{"id":"p","item":"sword","hand":"off"}'`.
