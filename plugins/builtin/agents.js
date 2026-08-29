/**
 * Agents — the registry every coding agent is found and run through.
 *
 * The engine hosts no AI and names no vendor. A provider plugin registers
 * itself here in its own onLoad, and this file owns the registry and the
 * running: it finds a provider, spawns the command the provider's own build()
 * describes, and reads the result through the provider's own parse(). Nothing
 * in this file knows what an agent is beyond that contract, so a provider can
 * be any tool that answers a task on the command line.
 *
 * An agent is a child process, so a browser page cannot run one — the browser
 * answers with the terminal command instead, built through build() so the
 * answer is never guessed. This mirrors tools.make in agent-tools.js.
 *
 * `context.agents` is this registry. Agent Workspace holds the instruction
 * tree on `context.agentWorkspace`: two plugins, two keys, neither depending
 * on which happens to load first.
 */
const PROVIDERS = []

/** One terminal line from a build() result, for a person to copy. */
const commandLine = built => [built.command, ...(built.args || [])]
  .map(argument => /\s/.test(String(argument)) ? JSON.stringify(String(argument)) : String(argument))
  .join(' ')

/**
 * Whether the provider's command line tool exists, for the inspector.
 *
 * A page cannot probe the PATH, so from the browser the honest answer is
 * "terminal". Node asks `where`/`which` — synchronously, because inspect is
 * synchronous — through the builtin module loader, which keeps node imports
 * out of the browser bundle.
 */
function reachable(cli) {
  if (!cli) return 'no command line tool'
  if (typeof process === 'undefined' || !process.versions?.node) return 'terminal — the page cannot probe'
  try {
    const spawnSync = process.getBuiltinModule?.('node:child_process')?.spawnSync
    if (!spawnSync) return 'could not probe'
    const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cli], { stdio: 'ignore' })
    return probe.status === 0 ? 'reachable on PATH' : 'not on PATH'
  } catch {
    return 'could not probe'
  }
}

/**
 * Run one agent: unknown ids answer politely, the browser answers with the
 * terminal command, and node spawns the provider's command and lets the
 * provider read the result.
 */
async function runAgent(id, task, options) {
  const provider = PROVIDERS.find(known => known.id === id)
  if (!provider) return { error: `no agent "${id}". Try agents.list`, agents: PROVIDERS.map(known => known.id) }

  // Deliberately 'workspace-write': the wrapped command line tools already
  // default to it, and an agent editing the workspace should not need more
  // than the workspace. Do not quietly change this default.
  const effective = { ...options, permissionMode: options?.permissionMode ?? 'workspace-write' }
  const built = provider.build(task, effective)

  // The agent is a child process, so a page cannot run it. Answer with the
  // exact terminal command — through the provider's own build(), never
  // guessed — the way tools.make does.
  if (typeof process === 'undefined' || !process.versions?.node) {
    return {
      agent: provider.id,
      command: built.command,
      args: built.args || [],
      run: commandLine(built),
      why: 'the agent runs in a child process — use --headless or the terminal'
    }
  }

  const outcome = await spawnAgent(built, effective)

  // Silence is the enemy. A command that was never found and a command the
  // timeout killed both end with no exit code and no output, and a provider
  // handed nothing cannot tell those apart — it would report an empty answer
  // as an answer. So name the failure here, in the provider's own four-key
  // shape, instead of asking parse() to read nothing.
  if (outcome.failure) {
    return {
      agent: provider.id,
      ok: false,
      text: '',
      error: outcome.failure,
      meta: { run: commandLine(built), exitCode: outcome.exitCode, signal: outcome.signal }
    }
  }

  const parsed = provider.parse(outcome.stdout, outcome.stderr, outcome.exitCode) || {}
  return { agent: provider.id, ...parsed }
}

/**
 * Spawn the provider's command and collect everything parse() needs.
 *
 * The timeout is the child process's own `timeout` option, not a timer of
 * ours: a plugin must not break determinism, and setTimeout is on the banned
 * list.
 *
 * `failure` is the reason the command produced no answer, already written out
 * for a person to read, or null when the command ran and exited on its own.
 * Both of the ways this goes wrong — the executable is not installed, and the
 * timeout killed it — otherwise arrive as the same empty result with a null
 * exit code, which is the one thing the caller must not have to guess at.
 */
async function spawnAgent(built, options) {
  const { spawn } = await import('node:child_process')
  return await new Promise(resolve => {
    const child = spawn(built.command, built.args, {
      cwd: options.cwd,
      timeout: options.timeout,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    let settled = false
    const finish = value => { if (!settled) { settled = true; resolve(value) } }
    child.on('error', error => finish({
      stdout, stderr, exitCode: null, signal: null,
      failure: error.code === 'ENOENT'
        ? `${built.command} is not on PATH — install it, or name a different agent`
        : `${built.command} could not be started: ${error.message}`
    }))
    child.on('close', (exitCode, signal) => finish({
      stdout, stderr, exitCode, signal: signal ?? null,
      // Node kills the child with a signal when its own timeout fires, so a
      // signal and a timeout together is the timeout, said plainly.
      failure: !signal ? null
        : options.timeout
          ? `${built.command} was killed after its ${options.timeout}ms timeout`
          : `${built.command} was killed by ${signal}`
    }))
  })
}

export default {
  name: 'Agents',
  about: 'The registry every coding agent is found and run through. Provider plugins register themselves here; this file names no vendor — it spawns what a provider\'s own build() describes and reads the result through the provider\'s own parse().',
  inspect: context => [{
    title: 'Registered agents',
    rows: (context.agents?.list?.() || []).map(provider => [`${provider.id} — ${provider.name}`, reachable(provider.cli)])
  }],

  onLoad(context) {
    context.agents = {
      /** The registered providers, as the CLI lists them. */
      list: () => PROVIDERS.map(provider => ({ id: provider.id, name: provider.name, about: provider.about, cli: provider.cli })),

      /**
       * Add one provider, from any plugin's onLoad. A duplicate id is
       * ignored, not an error.
       */
      register(provider) {
        const missing = ['id', 'name', 'build', 'parse'].filter(key => provider?.[key] === undefined)
        if (missing.length) throw new Error(`agents.register needs a provider with ${missing.join(', ')}`)
        if (PROVIDERS.some(known => known.id === provider.id)) return PROVIDERS
        PROVIDERS.push(provider)
        return PROVIDERS
      },

      /** One provider, or undefined. */
      get: id => PROVIDERS.find(known => known.id === id),

      /** Find a provider and run one task through it. */
      run: (id, task, options) => runAgent(id, task, options)
    }
  },

  commands: [
    {
      id: 'agents.list',
      label: 'List the registered agent providers',
      run: context => context.agents?.list?.() || PROVIDERS.map(provider => ({ id: provider.id, name: provider.name, about: provider.about, cli: provider.cli }))
    },
    {
      id: 'agents.run',
      label: 'Run one registered agent provider',
      run: async (context, request) => {
        const value = request || {}
        return context.agents.run(value.id, value.task, value.options)
      }
    }
  ]
}
