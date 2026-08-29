# Agents

- `context.agents` is the registry every coding agent is found and run through. This plugin names no vendor — a provider plugin registers itself in its own `onLoad`:
  `context.agents.register({ id, name, about, cli, build(task, options), parse(stdout, stderr, exitCode) })`.
- `agents.list` shows the registered providers. `agents.run` runs one.
- `agents.run` takes **one** JSON argument — the CLI forwards a single argument to a command's `run`, not several:
  `node bin/engine.mjs run agents.run '{"id":"my-agent","task":"…","options":{…}}'`.
- An agent is a child process, so a browser page answers with the terminal command instead — use `--headless` or the terminal.
- `parse` receives `exitCode: null` when the process never ran to an exit (command not found, or killed by the timeout). The timeout is the child process's own `timeout` option — this plugin never reads the wall clock, so runs stay repeatable.
