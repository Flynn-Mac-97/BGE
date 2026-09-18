/**
 * Dream — improve one thing in this engine, by trying versions of it and
 * scoring them against a measure it designed for itself.
 *
 * A run has three phases. A design agent reads the target and writes the
 * measurement: the tasks, the checks, and what each measure costs in score. The
 * setup is checked twice — it must pass the target as it stands, and it must
 * fail the target with one literal break applied — and then it is frozen.
 * Candidates follow, each one a version of the target built on the best version
 * before it, each scored by that frozen file.
 *
 * The loop does not run here. It runs in its own process, detached, because a
 * run spends agent calls for minutes and a plugin edit reloads this page. All
 * this half does is start it, stop it, and read the run's directory, which is
 * the run's whole state.
 *
 * A run writes what it found as it goes: `report.md` for the target, the checks,
 * the control and every attempt, `graph.svg` for score against attempts, and
 * `tree.svg` for who descends from whom. Both pictures are drawn by the run, so
 * they exist for an agent to read without a browser.
 *
 * Nothing here is automatic. A run never edits the checkout: every candidate is
 * a worktree, and the winner is a patch. Landing it is a separate command a
 * person runs.
 */

/** What the panel shows. Module level, the same way the Plugin Browser keeps the open plugin. */
const state = {
  runs: [],
  note: null,
  problem: null
}

/** What the panel's field holds between redraws, so a typed target survives one. */
const draft = { target: '', rounds: 2, candidates: 1 }

/** The node half: everything that touches a process or a file. Absent in the browser. */
let nodeHalf = null
const node = async () => (nodeHalf ||= await import('./dream/run.mjs'))

/** Refuse in the browser, naming the command that does work. */
const needsNode = id => ({
  refused: `${id} starts a process, so it runs where the engine has a filesystem`,
  run: `node bin/engine.mjs ${id === 'dream.improve' ? `dream.improve ${'"<target>"'}` : id}`
})

/** Read every run, and say so when the read failed rather than showing nothing. */
async function refresh(context) {
  if (!context.host) return state
  try {
    state.runs = (await node()).listRuns({ checkout: context.host.checkout })
    state.problem = null
  } catch (error) {
    state.problem = String(error?.message || error)
  }
  context.redraw()
  return state
}

/** The newest run, which is what the panel leads with. */
const newest = () => state.runs[0] ?? null

const shape = run => ({
  run: run.name,
  target: run.target,
  phase: run.phase,
  round: run.round,
  best: run.best ? { id: run.best.id, value: run.best.value, measures: run.best.measures } : null,
  winner: run.winner,
  live: run.live,
  why: run.why,
  report: `${run.directory}/report.md`,
  graph: `${run.directory}/graph.svg`,
  tree: `${run.directory}/tree.svg`
})

export default {
  name: 'Dream',
  category: 'agents',
  about: 'Improve one target in the engine by trying versions of it and scoring them against a measure designed for it.',

  inspect: () => (newest()
    ? [{
        title: 'Dream',
        rows: [
          ['target', newest().target ?? '—'],
          ['phase', `${newest().phase} · round ${newest().round}`],
          ['best', newest().best ? `${newest().best.id} at ${newest().best.value}` : 'the target as it stands'],
          ['report', newest().report ?? '—'],
          ['runs', String(state.runs.length)]
        ]
      }]
    : []),

  onLoad(context) {
    // The viewport exists only after shell:ready, and so does the host.
    if (context.host) refresh(context)
  },

  panels: [{
    id: 'dream',
    title: 'Dream · improve',
    dock: 'right',
    order: 40,

    actions: [
      {
        label: 'Stop',
        title: 'Ask the newest run to stop after the work in flight',
        run: context => {
          const run = newest()
          return run ? context.run('dream.stop', run.directory) : { skipped: 'no run to stop' }
        }
      }
    ],

    render(ui, context) {
      const run = newest()
      const rows = state.runs.slice(0, 8)
      const start = () => context.run('dream.improve', draft.target, { rounds: draft.rounds, candidates: draft.candidates })

      return ui.stack([
        // A target is a sentence, so it is typed rather than picked. The field
        // commits on Enter or on leaving it, which is when a run may start.
        ui.field({ k: 'target', v: draft.target, onChange: value => { draft.target = value } }),
        ui.row([
          ui.button('Improve', start, { primary: true }),
          ui.meta(draft.target ? `${draft.rounds} rounds` : 'ctrl+alt+d focuses this')
        ]),
        ...(rows.length
          ? [ui.list({
              items: rows,
              key: row => row.name,
              selected: 0,
              row: item => [
                ui.glyph(item.live ? '●' : '·', { strong: item.live }),
                ui.label(item.target ?? item.name),
                ui.spacer(),
                ui.meta(item.best ? `${item.best.value}` : item.phase)
              ],
              onPick: item => context.run('dream.report', item.directory)
            })]
          : [ui.empty('no run yet — name a target and press Improve')]),
        ...(run
          ? [ui.text(
              `${run.phase} · round ${run.round} · best ${run.best ? `${run.best.id} ${run.best.value}` : 'the target as it stands'}`,
              { dim: true }
            )]
          : []),
        ...(run?.why ? [ui.text(run.why, { dim: true })] : []),
        ...(state.problem ? [ui.text(state.problem, { dim: true })] : [])
      ])
    }
  }],

  commands: [
    {
      id: 'dream.improve',
      label: 'Dream: improve a target',
      // ctrl+alt+d: the dream key. Chrome binds no such combination, and no
      // other engine command claims it.
      key: 'ctrl+alt+d',
      // args: the target in words, then { files, rounds, candidates, timeout, model }
      run: async (context, target, options = {}) => {
        if (!context.host) return needsNode('dream.improve')
        if (!target) return { refused: 'name a target to improve, in words' }
        const files = [].concat(options.files ?? (options.file ? [options.file] : []))
        const started = await (await node()).startRun({
          checkout: context.host.checkout,
          target: String(target),
          files,
          rounds: options.rounds,
          candidates: options.candidates,
          timeout: options.timeout,
          model: options.model
        })
        await refresh(context)
        return started
      }
    },
    {
      id: 'dream.status',
      label: 'Dream: what the runs are doing',
      run: async (context, directory) => {
        if (!context.host) return needsNode('dream.status')
        await refresh(context)
        const found = directory
          ? (await node()).runStatus({ checkout: context.host.checkout, directory })
          : newest()
        return found ? shape(found) : { runs: [] }
      }
    },
    {
      id: 'dream.stop',
      label: 'Dream: ask a run to stop',
      run: async (context, directory) => {
        if (!context.host) return needsNode('dream.stop')
        const run = newest()
        const stopped = (await node()).stopRun({
          checkout: context.host.checkout,
          directory: directory ?? run?.directory
        })
        await refresh(context)
        return stopped
      }
    },
    {
      id: 'dream.report',
      label: 'Dream: the document a run wrote about itself',
      run: async (context, directory) => {
        if (!context.host) return needsNode('dream.report')
        const run = directory ? state.runs.find(one => one.name === directory || one.directory === directory) ?? newest() : newest()
        if (!run) return { refused: 'no run to report on' }
        const text = await context.files.read(`${run.directory}/report.md`).catch(() => null)
        return text ?? { refused: `no report at ${run.directory}/report.md`, run: shape(run) }
      }
    },
    {
      id: 'dream.forget',
      label: 'Dream: throw a finished run away',
      run: async (context, directory) => {
        if (!context.host) return needsNode('dream.forget')
        const forgotten = (await node()).forgetRun({ checkout: context.host.checkout, directory })
        await refresh(context)
        return forgotten
      }
    }
  ]
}
