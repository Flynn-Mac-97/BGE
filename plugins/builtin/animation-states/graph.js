/**
 * Animation States: the graph as files, and the sets laid over it. Pure: the
 * plugin reads the files and hands their records here.
 *
 * A graph file, `assets/animation/<name>.states.json`, is the machine
 * (machine.js) with a `folder` its takes are in, so a state names a take
 * rather than a file:
 *   {
 *     folder: 'motion/kimodo-mannequin',
 *     start: 'idle',
 *     states: { idle: { clips: ['take-base-idle-a', 'take-base-idle-d'] }, ... },
 *     transitions: [ ... ],
 *     sets: ['locomotion-extras']          sets that are always on (optional)
 *   }
 *
 * A set file, `assets/animation/sets/<name>.set.json`, is a module: actions
 * played as a layer over whatever state plays, and states whose takes it
 * swaps while it is on. An item turns its set on by naming it in its hold
 * record (`set: 'one-handed'`), so a new weapon is a new item and a new set.
 *   {
 *     folder: 'motion/kimodo-mannequin',
 *     actions: {
 *       attack: {
 *         clips: ['take-base-slash-sword-a'],   one picked each time it plays
 *         mask: 'upper',                         'upper' (above the hips), 'right-arm' or 'left-arm'
 *                                                (the spine and one arm), 'all', or a list of nodes
 *         hold: { holding: 0, other: 1 },        how much each hand keeps its hold while it plays
 *         speed: 1
 *       }
 *     },
 *     states: { 'idle-ready': { clips: ['take-base-idle-ready-d'] } }
 *   }
 * A set later in the list wins over an earlier one for the same action or state.
 */

/** A take named in a file with a folder, as the clip file Rig Animation plays. */
const fileOf = (folder, name) => (!folder || name.endsWith('.json') ? name : `${folder}/${name}.json`)

/** A record's states with each take made a clip file by its folder. */
function statesWithFiles(record) {
  return Object.fromEntries(
    Object.entries(record.states ?? {}).map(([name, state]) => [name, { ...state, clips: (state.clips ?? []).map(clip => fileOf(record.folder, clip)) }])
  )
}

/** A set's actions with each take made a clip file by its folder. */
function actionsWithFiles(set) {
  return Object.fromEntries(
    Object.entries(set.actions ?? {}).map(([name, action]) => [name, { ...action, clips: (action.clips ?? []).map(clip => fileOf(set.folder, clip)) }])
  )
}

/**
 * The machine to run: the graph with each on set's states laid over its own,
 * later sets winning, and every take a clip file. `sets` are set records in
 * the order they turn on.
 */
export function machineWith(graph, sets) {
  const states = statesWithFiles(graph)
  for (const set of sets) {
    for (const [name, state] of Object.entries(statesWithFiles(set))) states[name] = { ...states[name], ...state }
  }
  return { ...graph, states }
}

/** The action `name` from the on sets, the last that has it; null when none does. */
export function actionOf(sets, name) {
  const owner = [...sets].reverse().find(set => set.actions?.[name])
  return owner ? actionsWithFiles(owner)[name] : null
}

/** Every action name the on sets give, for the panel and the commands. */
export const actionNames = sets => [...new Set(sets.flatMap(set => Object.keys(set.actions ?? {})))]

/** The nodes from the hips' child up to the chest: the spine a one-arm layer turns with the arm. */
function spineOf(skeleton, chest) {
  const spine = []
  for (let node = chest; skeleton.nodes[node]?.parent; node = skeleton.nodes[node].parent) spine.unshift(node)
  return spine
}

/** Every node under `top`, and `top`. */
function branchOf(skeleton, top) {
  const parentOf = name => skeleton.nodes[name]?.parent ?? null
  return Object.keys(skeleton.nodes).filter(name => {
    for (let node = name; node; node = parentOf(node)) if (node === top) return true
    return false
  })
}

/**
 * The spine and one arm, from the shoulder bone above the upper arm: a
 * one-handed swing that leaves the other arm to the state.
 */
export function armMaskOf(skeleton, chest, upperArm) {
  const shoulder = skeleton.nodes[upperArm]?.parent
  const top = shoulder && shoulder !== chest ? shoulder : upperArm
  return [...spineOf(skeleton, chest), ...branchOf(skeleton, top)]
}

/**
 * The nodes above the hips: the hips' child whose branch holds the chest, and
 * everything under it. A layer on these plays the arms and the spine and
 * leaves the legs to the state.
 */
export function upperBodyOf(skeleton, chest) {
  const parentOf = name => skeleton.nodes[name]?.parent ?? null
  let top = chest
  while (parentOf(top) && parentOf(parentOf(top))) top = parentOf(top)
  return branchOf(skeleton, top)
}
