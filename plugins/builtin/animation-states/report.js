/**
 * Animation States: a graph in words, and what is wrong with it, for an agent
 * helping a person build one. Pure: it reads a machine (graph.js
 * `machineWith`) and the asset paths that exist.
 *
 * It answers what `machineProblems` does not: states nothing reaches, takes
 * whose files are missing, transitions a rule above them always beats, and
 * the inputs game code has to set.
 */
import { machineProblems } from './machine.js'

/** A transition's `when` in words: `moving, gait = run, speed > 0.2`. */
export function whenInWords(when = {}) {
  const words = Object.entries(when).map(([name, wanted]) => {
    if (wanted === true) return name
    if (wanted === false) return `not ${name}`
    if (wanted !== null && typeof wanted === 'object') {
      return [wanted.above !== undefined && `${name} > ${wanted.above}`, wanted.below !== undefined && `${name} < ${wanted.below}`].filter(Boolean).join(', ')
    }
    return `${name} = ${wanted}`
  })
  return words.join(', ') || 'always'
}

/** Every state the machine can get to from its start, by its transitions and its `then`s. */
function reachableStates(machine) {
  const names = Object.keys(machine.states)
  const reached = new Set([machine.start ?? names[0]])
  let isGrowing = true
  while (isGrowing) {
    isGrowing = false
    for (const transition of machine.transitions ?? []) {
      const isFromReached = !transition.from || transition.from.some(from => reached.has(from))
      if (isFromReached && !reached.has(transition.to)) {
        reached.add(transition.to)
        isGrowing = true
      }
    }
    for (const name of [...reached]) {
      const then = machine.states[name]?.then
      if (then && !reached.has(then)) {
        reached.add(then)
        isGrowing = true
      }
    }
  }
  return reached
}

/** Transitions that can never fire: an earlier one with no `from` and no `when` always wins first. */
function shadowedTransitions(machine) {
  const transitions = machine.transitions ?? []
  const always = transitions.findIndex(transition => !transition.from && !Object.keys(transition.when ?? {}).length)
  return always < 0 ? [] : transitions.slice(always + 1).map(transition => transition.to)
}

/** The graph as flowchart text (Mermaid), for a person to see it drawn. */
function flowchartOf(machine) {
  const names = Object.keys(machine.states)
  const id = name => name.replace(/[^a-zA-Z0-9]/g, '_')
  const lines = ['flowchart LR']
  for (const transition of machine.transitions ?? []) {
    const froms = transition.from ?? ['any']
    for (const from of froms) lines.push(`  ${id(from)} -->|${whenInWords(transition.when)}| ${id(transition.to)}`)
  }
  for (const name of names) if (machine.states[name].then) lines.push(`  ${id(name)} -.->|clip ends| ${id(machine.states[name].then)}`)
  return lines.join('\n')
}

/**
 * The machine in words and its problems: `{ start, states, transitions,
 * inputs, problems, flowchart }`. `paths` is the set of asset paths that exist
 * (`assets/...`), or null to skip the file check.
 */
export function graphReport(machine, rigClips, paths = null) {
  const reached = reachableStates(machine)
  const shadowed = shadowedTransitions(machine)
  const missing = Object.entries(machine.states).flatMap(([name, state]) =>
    (state.clips ?? []).filter(clip => clip.endsWith('.json') && paths && !paths.has(`assets/${clip}`)).map(clip => `state "${name}": no file assets/${clip}`)
  )
  const problems = [
    ...machineProblems(machine, rigClips),
    ...missing,
    ...Object.keys(machine.states).filter(name => !reached.has(name)).map(name => `state "${name}" is never reached: no transition goes to it`),
    ...shadowed.map(to => `the transition to "${to}" never fires: a transition above it always matches`)
  ]
  return {
    start: machine.start ?? Object.keys(machine.states)[0],
    states: Object.fromEntries(
      Object.entries(machine.states).map(([name, state]) => [
        name,
        { takes: state.clips?.length ?? 0, ...(state.then ? { then: state.then } : {}), ...(state.turns ? { turns: true } : {}) }
      ])
    ),
    transitions: (machine.transitions ?? []).map(transition => `${(transition.from ?? ['any']).join('|')} -> ${transition.to} when ${whenInWords(transition.when)}`),
    inputs: [...new Set((machine.transitions ?? []).flatMap(transition => Object.keys(transition.when ?? {})))],
    problems,
    flowchart: flowchartOf(machine)
  }
}
