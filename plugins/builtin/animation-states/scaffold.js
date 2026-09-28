/**
 * Animation States: a first graph built from a folder of takes, so a person
 * or an agent starts from a machine that already plays rather than a blank
 * file. Pure: it reads take names and answers a graph record (graph.js).
 *
 * A take `take-base-walk-b` is the state `walk`: the `take-` and `base-`
 * prefixes and a last `-<letter>` are dropped, and the takes of one state are
 * gathered. A state the table below knows gets its usual transition, in the
 * table's order, which is priority order; any other state is listed with no
 * transition, for the person to wire (`animation.graph` names them).
 *
 * The inputs the known transitions read: `moving` (bool), `gait` ('walk',
 * 'jog', 'run', 'sprint'), `crouched`, `sneaking`, `armed` (bools),
 * `direction` ('forward', 'back', 'left', 'right') and `turning` ('left',
 * 'right' or null).
 */

/** A take's state name. */
export const stateNameOf = take => take.replace(/^take-/, '').replace(/^base-/, '').replace(/-[a-z]$/, '')

/**
 * The usual states, in priority order: each state's transition, and for a
 * state that plays once, what it goes on to. `stand-turn-*` is a turn in place.
 */
const KNOWN = [
  ['stand-turn-left', { from: ['idle', 'idle-ready'], when: { moving: false, turning: 'left' } }, { then: 'idle', turns: true }],
  ['stand-turn-right', { from: ['idle', 'idle-ready'], when: { moving: false, turning: 'right' } }, { then: 'idle', turns: true }],
  ['sneak-crouch', { when: { moving: true, crouched: true, sneaking: true } }],
  ['crouch-walk', { when: { moving: true, crouched: true } }],
  ['crouch-idle', { when: { crouched: true } }],
  ['sneak', { when: { moving: true, sneaking: true } }],
  ['walk-back', { when: { moving: true, direction: 'back' } }],
  ['strafe-left', { when: { moving: true, direction: 'left' } }],
  ['strafe-right', { when: { moving: true, direction: 'right' } }],
  ['sprint', { when: { moving: true, gait: 'sprint' } }],
  ['run', { when: { moving: true, gait: 'run' } }],
  ['jog', { when: { moving: true, gait: 'jog' } }],
  ['walk', { when: { moving: true } }],
  ['idle-ready', { when: { armed: true } }],
  ['idle', {}]
]

/**
 * A graph for `takes` (take names, as in the folder without `.json`) in
 * `folder`: `{ graph, unwired }`, the states with no known transition named.
 */
export function scaffoldGraph(folder, takes) {
  const grouped = {}
  for (const take of [...takes].sort()) (grouped[stateNameOf(take)] ??= []).push(take)
  const known = KNOWN.filter(([name]) => grouped[name])
  const states = Object.fromEntries(
    Object.entries(grouped).map(([name, clips]) => [name, { clips, ...(KNOWN.find(([known]) => known === name)?.[2] ?? {}) }])
  )
  const start = grouped.idle ? 'idle' : Object.keys(grouped)[0]
  const transitions = known.flatMap(([name, transition]) => {
    // A transition only from states the folder lacks can never fire.
    const from = transition.from?.filter(state => grouped[state])
    if (from && !from.length) return []
    return [{ to: name, ...(from ? { from } : {}), ...(transition.when ? { when: transition.when } : {}) }]
  })
  return { graph: { folder, start, states, transitions }, unwired: Object.keys(grouped).filter(name => !known.some(([known]) => known === name)) }
}
