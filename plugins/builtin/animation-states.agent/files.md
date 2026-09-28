# The three files

The full contracts are at the top of the code; this is where to look.

- Graph and set files: `animation-states/graph.js`. `folder` makes a take name
  a clip file; a set later in the list wins over an earlier one.
- The machine's rules (priority order, `from`, once states with `then`,
  `turns` for a turn in place, `hold` 0 to let go of the item): `animation-states/machine.js`.
- Hold records (sockets, mounts, guard, motion, `set`): `animation-states/held-items.js`.
- Scaffold names and the inputs its transitions read: `animation-states/scaffold.js`.
- What `animation.graph` checks: `animation-states/report.js`.

An action: `{ clips, mask: 'upper' | 'all' | [nodes], hold: { holding, other }, speed }`.
While it plays, `acting` is an input the graph can read, so a transition can
stop a sprint during an attack.
