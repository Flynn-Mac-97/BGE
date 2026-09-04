/**
 * Claim Guard — refuse a write to a file another agent has claimed.
 *
 * `agent.prepare` records which files a run is working on, and until now that
 * record was advisory: nothing read it at write time, so an agent that never
 * prepared was invisible and a claimed file was not actually protected. Two
 * sessions rewriting each other's work was found by comparing modification
 * times, which is the failure the registry was built to answer and did not.
 *
 * The kernel performs writes, so only the kernel can stop one — but the policy
 * is here, not there, because a rule about who may write what is not the
 * kernel's business. `context.files.guardWrites` takes a function that returns
 * a reason to refuse; this one answers from the registry. Turn this plugin off
 * and writes are open again, which is deliberate: a guard nobody can disable is
 * a guard people route around.
 *
 * Reading the registry needs node, so in the browser this plugin guards
 * nothing and says so. That is honest rather than convenient — the editor is
 * one writer at a keyboard, and the collisions this exists for happen between
 * headless runs.
 */

/**
 * This run, if the environment names one. Its own claims must not refuse it.
 *
 * Read at the moment of the write, not at import. A module is cached for the
 * life of a process, so capturing it once meant a world started later in the
 * same process still answered with the first world's identity.
 */
const mine = () => (typeof process !== 'undefined' ? process.env.ENGINE_AGENT_ID || null : null)

const state = { active: [], reason: null }

const normal = value => String(value || '').replaceAll('\\', '/').replace(/^\.\//, '')

/**
 * Does a write to `path` fall inside `claimed`?
 *
 * A claim is a path, and a directory claim covers what is under it. Deliberately
 * not the wildcard rule `claimsOverlap` uses for prepare: that one asks whether
 * two claims could ever collide, which must be generous, while this asks whether
 * one real file is inside one claim, which must not be.
 */
const covers = (claimed, path) => {
  const a = normal(claimed), b = normal(path)
  return a === b || b.startsWith(a.replace(/\/$/, '') + '/')
}

/**
 * A write is judged against the project directory it lands in, because a claim
 * names a repository path and `files.write` names a project-relative one.
 */
const asRepoPath = (path, scope) => scope === 'engine' ? normal(path) : 'project/' + normal(path)

export default {
  name: 'Claim Guard',
  category: 'agents',
  about: 'Refuses a write to a file another agent run has claimed, so the run registry stops being advice.',

  inspect: () => [{
    title: 'Claim Guard',
    rows: state.reason
      ? [['guarding', 'no'], ['why', state.reason]]
      : [
          ['guarding', 'yes'],
          ['this run', mine() || 'not named — set ENGINE_AGENT_ID'],
          ...state.active.map(run => [run.id, (run.files || []).join(', ') || 'no files'])
        ]
  }],

  async onLoad(context) {
    if (typeof process === 'undefined' || !process.versions?.node) {
      state.reason = 'the registry is read on the node side — the editor is one writer anyway'
      return
    }

    try {
      const { readAgentRegistry } = await import('../../engine/agent-workspace-node.mjs')
      // Read once at load. A run that starts mid-session is not yet claiming
      // anything this process could be about to overwrite, and re-reading the
      // registry on every write would put a file read in front of every save.
      state.active = readAgentRegistry(process.cwd()).runs.filter(run => run.status === 'active')
    } catch (error) {
      state.reason = `could not read the run registry — ${String(error?.message || error)}`
      return
    }

    context.files.guardWrites((path, scope) => {
      const target = asRepoPath(path, scope)
      for (const run of state.active) {
        if (run.id === mine()) continue
        if ((run.files || []).some(claimed => covers(claimed, target))) {
          return `agent run "${run.id}" claimed it${run.task ? ` for: ${run.task}` : ''}`
        }
      }
      return null
    })
  },

  commands: [{
    id: 'claims.list',
    label: 'What every active run has claimed',
    run: () => ({
      guarding: !state.reason,
      ...(state.reason ? { why: state.reason } : {}),
      thisRun: mine(),
      runs: state.active.map(run => ({ id: run.id, task: run.task, files: run.files || [] }))
    })
  }]
}
