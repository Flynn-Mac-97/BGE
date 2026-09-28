/**
 * Animation States: the state machine, as plain records and functions over
 * them. Nothing here reads the world or the clock; the plugin calls it once a
 * fixed step with the entity's inputs.
 *
 * A type declares its machine as data, beside its `rig`:
 *
 *   animationStates: {
 *     start: 'idle',
 *     states: {
 *       idle: { clips: ['idle-a', 'idle-b'] },       rig clip names; one is picked at random on entry
 *       walk: { clips: ['walk-a'] },
 *       'turn-left': { clips: ['turn-left-a'], then: 'idle', turns: true },   when a once clip ends,
 *                                                    go to `then`; `turns` moves the clip's turn into the facing
 *       dead: { clips: ['death-a'], hold: 0 }        `hold` 0 lets go of a held item here
 *     },
 *     transitions: [
 *       { to: 'walk', from: ['idle'], when: { speed: { above: 0.2 } } },
 *       { to: 'crouch-idle', when: { crouched: true, speed: { below: 0.2 } } }
 *     ]
 *   }
 *
 * Game code sets `entity.animationInputs`, a record of named values (speed,
 * crouched, ...). The transitions are a list in priority order: the first
 * whose every `when` value matches (equal, or `{ above }` / `{ below }` a
 * number) names the state, and naming the state it is in keeps it there. A
 * transition with `from` applies only in those states. One with no `from`
 * does not interrupt a state that has `then` (a once clip, a turn) until its
 * clip ends. `done` is an input the machine sets itself: true once the
 * state's clip has played to its end.
 */

/** Whether one input matches one `when` value. */
function isMatch(value, wanted) {
  if (wanted !== null && typeof wanted === 'object') {
    if (wanted.above !== undefined && !(value > wanted.above)) return false
    if (wanted.below !== undefined && !(value < wanted.below)) return false
    return true
  }
  return value === wanted
}

/** Whether a transition applies in `state` with `inputs`. */
function isFiring(transition, state, isPlayingOnce, inputs) {
  if (transition.from ? !transition.from.includes(state) : isPlayingOnce) return false
  return Object.entries(transition.when ?? {}).every(([name, wanted]) => isMatch(inputs[name], wanted))
}

/**
 * The state the machine is in after this step: a finished once state's
 * `then`, else the first transition that applies, else the state it is in.
 */
export function nextState(machine, state, inputs) {
  const then = machine.states[state]?.then
  if (then && inputs.done) return then
  const isPlayingOnce = Boolean(then)
  const fired = (machine.transitions ?? []).find(transition => isFiring(transition, state, isPlayingOnce, inputs))
  return fired ? fired.to : state
}

/** One of a state's clips, picked by `random` (a number from 0 to 1). */
export function pickClip(machine, state, random) {
  const clips = machine.states[state]?.clips ?? []
  return clips[Math.min(clips.length - 1, Math.floor(random * clips.length))] ?? null
}

/**
 * Every problem with a machine against the clips its rig declares, in words:
 * an empty list when it is whole. A state with no clip, a clip the rig does
 * not declare, or a transition to a state that does not exist plays nothing
 * and says nothing at run time, so the plugin reports these once.
 */
export function machineProblems(machine, rigClips) {
  const states = machine?.states ?? {}
  const named = Object.keys(states)
  const problems = []
  if (!named.length) problems.push('it has no states')
  if (machine?.start && !states[machine.start]) problems.push(`start "${machine.start}" is not a state`)
  for (const [name, state] of Object.entries(states)) {
    if (!state.clips?.length) problems.push(`state "${name}" has no clips`)
    // A clip file (from a graph file's folder) is checked against the disk by animation.graph, not here.
    for (const clip of state.clips ?? []) if (!clip.endsWith('.json') && !rigClips?.[clip]) problems.push(`state "${name}" plays "${clip}", which rig.clips does not declare`)
    if (state.then && !states[state.then]) problems.push(`state "${name}" goes on to "${state.then}", which is not a state`)
  }
  for (const transition of machine?.transitions ?? []) {
    if (!states[transition.to]) problems.push(`a transition goes to "${transition.to}", which is not a state`)
    for (const from of transition.from ?? []) if (!states[from]) problems.push(`a transition comes from "${from}", which is not a state`)
  }
  return problems
}
