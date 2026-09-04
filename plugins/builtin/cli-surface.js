/**
 * CLI Surface — every way into the engine from a terminal, with a purpose.
 *
 * Transparency: one command answers "what can I call, and what does it do?"
 * The kernel surface, offline ops, flags and refusals are a small fixed set,
 * curated here and kept in step with `bin/engine.mjs help`. The plugin commands
 * are read live from the loader, so a new verb appears the moment its plugin
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
  { op: 'servers', purpose: 'every dev server this checkout started, each proved by asking its port' },
  { op: 'servers.stop [<port>|all]', purpose: 'stop that one; several running means one must be named' },
  { op: 'lanes', purpose: 'every headless browser started for a lane, each proved against its debugging port' },
  { op: 'lanes.start <client> [--profile WxH] [--debugPort N]', purpose: 'start one and wait for its page; refused while a browser of that name is running' },
  { op: 'lanes.stop [<client>]', purpose: 'stop one lane browser, or all of them; a port still answering is named, not called clear' },
  { op: 'clients', purpose: 'who is attached to the dev server, and which one an untargeted call would reach' },
  { op: 'lock', purpose: 'whether lanes are working, who holds the checkout, and which records are stale' },
  { op: 'pain "<what>" [--cost N]', purpose: 'record friction — the cost matters as much as the words' },
  { op: 'pain.list', purpose: 'open painpoints, ranked by cost, grouped by kind' },
  { op: 'pain.resolve <id> "<done>"', purpose: 'mark a painpoint resolved' },
  { op: 'insight "<what worked>" [--problem "<when>"] [--saves N]', purpose: 'record a solution worth reusing — the saving is what decides which becomes a tool' },
  { op: 'insight.list [<words>]', purpose: 'with words, search every insight; without, the un-adopted ones ranked by saving' },
  { op: 'insight.adopt <id> "<the tool>"', purpose: 'close an insight — the engine now reaches that answer directly' },
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
  { op: '--client <id>', purpose: 'which attached page answers. Required once two are attached; an answer from any other client fails the call' },
  { op: '--timeout <ms>', purpose: 'how long to wait for the editor' },
  { op: '--verbose', purpose: 'name the answering client on stderr, and print error detail' },
  { op: '--profile <WxH>', purpose: 'lanes.start only: the window size Chrome is told to open' },
  { op: '--debugPort <n>', purpose: 'lanes.start only: the debugging port the lane browser answers on' },
  { op: '--raw / --pretty', purpose: 'force one-line or indented JSON' }
]

/**
 * What the checkout refuses, and why.
 *
 * The lock is derived from the lane registry, so no verb turns it on or off and
 * none of it appears in the command list. An agent reading this surface has to
 * be able to tell a refusal from a fault.
 */
const REFUSALS = [
  { op: 'a lane render page', purpose: 'refused every op that writes a file, always — its world is its own, the checkout is not' },
  { op: 'the person, while a lane works', purpose: 'refused every writing op, with a reason naming the lanes. Reads answer as usual' },
  { op: 'where it is enforced', purpose: 'POST /api/engine, POST /api/file and POST /api/agent-file all answer 423 {code:"held"}' },
  { op: 'clearing it', purpose: '`lock` names the holders; lanes.stop ends a lane browser and agent.release ends a run' }
]

const byId = (one, other) => one.id.localeCompare(other.id)

const liveCommands = context => [...context.loader.contrib.commands].sort(byId)
  .map(command => ({ id: command.id, purpose: command.label, plugin: command.plugin }))

const liveMenus = context => [...context.loader.contrib.menus].sort(byId)
  .map(menu => ({ id: menu.id, purpose: menu.label, toolbar: true, plugin: menu.plugin }))

export default {
  name: 'CLI Surface',
  category: 'agents',
  about: 'Every way into the engine from a terminal, with a purpose. Kernel and offline ops are curated; plugin commands are read live.',
  inspect: context => [
    { title: 'Kernel surface', rows: KERNEL.map(entry => [entry.op, entry.purpose]) },
    { title: 'Offline ops', rows: OFFLINE.map(entry => [entry.op, entry.purpose]) },
    { title: 'Flags', rows: FLAGS.map(entry => [entry.op, entry.purpose]) },
    { title: 'The work lock', rows: REFUSALS.map(entry => [entry.op, entry.purpose]) },
    { title: 'Plugin commands', rows: liveCommands(context).map(command => [command.id, command.purpose]) }
  ],
  commands: [{
    id: 'cli.surface',
    label: 'Every CLI access point and its purpose',
    run: context => ({
      kernel: KERNEL,
      offline: OFFLINE,
      flags: FLAGS,
      refusals: REFUSALS,
      commands: liveCommands(context),
      menus: liveMenus(context)
    })
  }]
}
