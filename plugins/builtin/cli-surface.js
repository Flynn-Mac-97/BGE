/**
 * CLI Surface — every way into the engine from a terminal, with a purpose.
 *
 * Transparency: one command answers "what can I call, and what does it do?"
 * The kernel surface, offline ops and flags are a small fixed set, curated
 * here and kept in step with `bin/engine.mjs help`. The plugin commands are
 * read live from the loader, so a new verb appears the moment its plugin
 * loads. The inspector renders the same inventory through the `inspect`
 * contribution.
 */
const KERNEL = [
  { op: 'snapshot', purpose: 'the world in one view: mode, level, time, seed, camera, counts' },
  { op: 'entity <id>', purpose: 'one entity, complete' },
  { op: 'select <id...>', purpose: 'choose entities' },
  { op: 'set <id> <key> <value>', purpose: 'set a field or property and write it to the level' },
  { op: 'spawn <type> [placement]', purpose: 'place a new entity' },
  { op: 'destroy <id>', purpose: 'remove an entity' },
  { op: 'play', purpose: 'enter play mode' },
  { op: 'stop', purpose: 'leave play mode, or reload the level after a simulation' },
  { op: 'simulate <seconds>', purpose: 'advance the fixed clock deterministically' },
  { op: 'seed <n>', purpose: 're-seed the random stream and restart the clock' },
  { op: 'errors', purpose: 'what went wrong' },
  { op: 'log [n]', purpose: 'recent hot-swap and file events' },
  { op: 'watch', purpose: 'tail the log live' },
  { op: 'eval <js>', purpose: 'run code in the editor page' },
  { op: 'run <id> [arg]', purpose: 'any command, any argument' },
  { op: 'commands', purpose: 'every command id' },
  { op: 'clearLog', purpose: 'empty the error ring' }
]

const OFFLINE = [
  { op: 'index', purpose: 'rebuild the project index and print it' },
  { op: 'tree', purpose: 'every project file, with its kind' },
  { op: 'check', purpose: 'exit 1 with file and line on anything broken or nondeterministic' },
  { op: 'pain "<what>" [--cost N]', purpose: 'record friction — the cost matters as much as the words' },
  { op: 'pain.list', purpose: 'open painpoints, ranked by cost, grouped by kind' },
  { op: 'pain.resolve <id> "<done>"', purpose: 'mark a painpoint resolved' },
  { op: 'agent.context [file...]', purpose: 'the small instruction packet for a task' },
  { op: 'agent.prepare <id> [file...]', purpose: 'claim files and get a packet; parallel writers get a worktree' },
  { op: 'agent.status [--all]', purpose: 'live runs, lanes still to merge, and leftovers on disk; --all prints the raw registry' },
  { op: 'agent.release <id> [--blocked]', purpose: 'run the packet checks and finish a run; failing checks leave it active' },
  { op: 'agent.merge <id>', purpose: 'merge the lane, run its deferred checks, remove its worktree and branch' },
  { op: 'agent.sweep [--dry-run]', purpose: 'delete worktrees and directories left by lanes whose work is in HEAD' },
  { op: 'agent.skills', purpose: 'rewrite AGENTS.md, CLAUDE.md and the generated skill copies' }
]

const FLAGS = [
  { op: '--headless', purpose: 'run the op in a private world in this process' },
  { op: '--level <name>', purpose: 'open this level first (headless only)' },
  { op: '--project <name>', purpose: 'open this project directory instead of `project` — a directory inside the checkout. index, tree, check and headless read it' },
  { op: '--port <n>', purpose: 'which dev server to talk to' },
  { op: '--timeout <ms>', purpose: 'how long to wait for the editor' },
  { op: '--raw / --pretty', purpose: 'force one-line or indented JSON' }
]

const liveCommands = context => [...context.loader.contrib.commands]
  .sort((a, b) => a.id.localeCompare(b.id))
  .map(c => ({ id: c.id, purpose: c.label, plugin: c.plugin }))

const liveMenus = context => [...context.loader.contrib.menus]
  .sort((a, b) => a.id.localeCompare(b.id))
  .map(m => ({ id: m.id, purpose: m.label, toolbar: true, plugin: m.plugin }))

export default {
  name: 'CLI Surface',
  about: 'Every way into the engine from a terminal, with a purpose. Kernel and offline ops are curated; plugin commands are read live.',
  inspect: context => [
    { title: 'Kernel surface', rows: KERNEL.map(k => [k.op, k.purpose]) },
    { title: 'Offline ops', rows: OFFLINE.map(k => [k.op, k.purpose]) },
    { title: 'Flags', rows: FLAGS.map(k => [k.op, k.purpose]) },
    { title: 'Plugin commands', rows: liveCommands(context).map(c => [c.id, c.purpose]) }
  ],
  commands: [{
    id: 'cli.surface',
    label: 'Every CLI access point and its purpose',
    run: context => ({
      kernel: KERNEL,
      offline: OFFLINE,
      flags: FLAGS,
      commands: liveCommands(context),
      menus: liveMenus(context)
    })
  }]
}
