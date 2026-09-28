# The three files

The full contracts are at the top of the code; this is where to look.

- Graph and set files: `animation-states/graph.js`. `folder` makes a take name
  a clip file; a set later in the list wins over an earlier one.
- The machine's rules (priority order, `from`, once states with `then`,
  `turns` for a turn in place, `hold` 0 to let go of the item): `animation-states/machine.js`.
- Hold records (sockets, mounts, guard, motion, `set`): `animation-states/held-items.js`.
- Scaffold names and the inputs its transitions read: `animation-states/scaffold.js`.
- What `animation.graph` checks: `animation-states/report.js`.

An action plays a take or follows a path. A path action, `{ path: [{ at, guard, ease }] }`,
moves the held item's guard through keys and the hands stay locked to it
(`animation-states/guard-path.js`): nothing in a take can break it, and a
swing is tuned by editing numbers. Its `body` (0 to 1, 0.3 by default) is how
much the spine turns and leans after the item. A person builds one by eye on
Kimodo's hold board: hold the item, pick the action, and drag each key while
the path the tip takes is drawn. A take action:
`{ clips, mask, hold: { holding, other }, speed }`; `mask` is 'upper', 'right-arm' or 'left-arm' (the spine and one arm, so a one-handed swing leaves the other arm to the state), 'all', or a list of nodes.
While it plays, `acting` is an input the graph can read, so a transition can
stop a sprint during an attack.
