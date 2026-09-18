/**
 * A reference setup: what an agent needs to do a job in this engine, and what
 * that costs.
 *
 * The target is the connection between an agent and the engine — the context
 * packet it is handed, and the command route it takes. A task is a question an
 * agent is asked, plus the route the current documentation implies it should
 * take. Running that route headless with no model in the loop measures the
 * connection exactly and identically every run.
 *
 * Only the routes and the checks are here. What they cost is `weights`, and the
 * score is computed from whatever a task reports as measures.
 *
 * This is a starting point for `dream.improve`, not part of the plugin: a run
 * against a new target writes its own setup.
 */
import { FIXTURE_LEVEL } from '../../../test/fixture-project.mjs'

const entitiesIn = reply => (Array.isArray(reply?.entities) ? reply.entities : null)

/** Run one route, and count what it cost. */
function route({ checkout, project, helpers }, steps) {
  const replies = []
  let milliseconds = 0
  let characters = 0
  let processes = 0

  for (const step of steps) {
    if (step.packet) {
      const packet = helpers.packetCharacters(checkout, step.packet)
      if (packet.error) return { problem: `the context packet failed: ${packet.error}` }
      characters += packet.characters
      milliseconds += packet.milliseconds
      continue
    }
    const run = helpers.engineProcess(checkout, project, step.args, { level: step.level })
    processes++
    milliseconds += run.milliseconds
    if (run.problem) return { problem: `${step.args[0]}: ${run.problem}` }
    replies.push(run.reply)
  }
  return { replies, measures: { characters, processes, milliseconds } }
}

/** One task: how it is run, and what makes its answer right. */
const task = (id, question, steps, check) => ({
  id,
  question,
  async run(context) {
    const result = route(context, steps)
    if (result.problem) return { pass: false, problem: result.problem, measures: result.measures }
    const problem = check(result.replies)
    return { pass: problem === null, problem, measures: result.measures }
  }
})

export default {
  name: 'agent-connection',
  project: 'test/fixture-project',
  weights: { processes: 0.02, characters: 0.00001 },
  tasks: [
    task(
      'find-player',
      'Which entity in this level is the player, and where is it?',
      [
        { packet: { task: 'find the player entity in this level and report its position', files: ['levels/main.json'] } },
        { level: FIXTURE_LEVEL, args: ['snapshot', '--entities'] }
      ],
      replies => {
        const entities = entitiesIn(replies[0])
        if (!entities) return 'snapshot answered no entity list'
        const player = entities.find(entity => entity.type === 'player')
        if (!player) return 'no entity of type player in the answer'
        if (!Array.isArray(player.at)) return `the player has no position: ${JSON.stringify(player)}`
        return null
      }
    ),
    task(
      'frame-facts',
      'What is on screen right now, and what is off it?',
      [
        { packet: { task: 'report what is visible on screen in this level and what is off screen', files: ['levels/main.json'] } },
        { level: FIXTURE_LEVEL, args: ['run', 'see.describe'] }
      ],
      replies => {
        const described = replies[0]
        if (!Array.isArray(described?.visible)) return 'see.describe answered no visible list'
        if (typeof described.counts?.visible !== 'number') return 'see.describe answered no visible count'
        if (described.counts.visible !== described.visible.length) {
          return `the visible count disagrees with the list: ${described.counts.visible} vs ${described.visible.length}`
        }
        return null
      }
    ),
    task(
      'state-hash',
      'Step the world half a second and report what it became.',
      [
        { packet: { task: 'simulate half a second of this level and report the resulting state', files: [] } },
        { level: FIXTURE_LEVEL, args: ['script', JSON.stringify([['simulate', 0.5], ['snapshot', {}]])] }
      ],
      replies => {
        const reply = replies[0]
        if (!Array.isArray(reply)) return 'script answered one object, not one reply per op'
        const state = reply[1]
        if (typeof state?.hash !== 'number') return 'the state after stepping carries no hash'
        if (typeof state.counts?.entities !== 'number') return 'the state after stepping carries no entity count'
        return null
      }
    ),
    task(
      'healthy',
      'Is this project healthy, and if not, what is broken?',
      [
        { packet: { task: 'check whether this project is healthy and name anything broken', files: [] } },
        { args: ['check'] }
      ],
      replies => {
        const verdict = replies[0]
        if (verdict?.ok !== true) return `check did not pass: ${JSON.stringify(verdict?.problems ?? verdict)}`
        return null
      }
    ),
    task(
      'verbs',
      'Which verbs can be run against this engine?',
      [
        { packet: { task: 'list the commands this engine exposes', files: [] } },
        { args: ['commands', JSON.stringify({ fields: ['id'] })] }
      ],
      replies => {
        const table = replies[0]
        if (!Array.isArray(table?.rows)) return 'commands answered no rows'
        const ids = table.rows.map(row => row[0])
        // Plugin commands only: `check` and `snapshot` are CLI ops and never appear here.
        for (const wanted of ['see.describe', 'agent.context', 'cli.surface']) {
          if (!ids.includes(wanted)) return `the command list has no ${wanted}`
        }
        return null
      }
    )
  ]
}
