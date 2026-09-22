# Engine Base — the instructions for working with this engine

Read this first. It sets how an agent speaks and works here, and points to the
detailed rules. Files on disk are the truth — nothing exists that is not in a
file, and nothing is saved anywhere else.

## Speech style

- Plain words. Exact, full names — `context`, not `ctx`; `entity`, not `e`.
- One idea per sentence. Keep output short — an agent pays for every token.
- Say what a thing does; say plainly when it is not on disk.

## Working rules

- Get the small instruction packet for your task first:
  `node bin/engine.mjs agent.context <file>`
- Shared working rules: `agents/core.md` — always in force, never overridden.
- Run every check named in your packet before you finish.
- Read a plugin's `.agent.md` guide, not its source. That is what it is for —
  the guide is ten lines, the plugin can be a thousand.
- Read `project/.engine/index.agent.json` before opening many project files. It
  is generated; `node bin/engine.mjs index` writes it.
- Working with other agents at once: `docs/agent-workspace.md`, the "Several
  agents at once" section. Claim a file with `agent.prepare` and set
  `ENGINE_AGENT_ID`, or another run's claim will refuse your writes.
- Every engine process goes through the supervisor: the dev server, the editor
  browser, a lane browser and a headless session. Start it with
  `node bin/engine.mjs supervisor.start`, or `engine.cmd` at the checkout root.
  Rule: `agents/supervisor.md`.

## Style links

- Code style: `agents/code-style.md`
- Comment style: `agents/comment-style.md`
- Codebase design: `agents/codebase-design.md`
- Plugin rules: Plugin Master — `plugins/builtin/plugin-master.agent.md`

## Where everything is

- `README.md` — how to use the engine
- `ARCHITECTURE.md` — how it works and why it is shaped this way
- `agents/` — the engine's instructions; `agents/manifest.json` is the tree
- `plugins/` — everything is a plugin; each carries a short guide beside it.
  Keep a plugin under 400 lines: `--headless run plugin.sizes` names the ones
  that are over, and any missing a guide
- `project/` — the open game, wherever its directory is; `project/agents/` has
  the game's own rules. No game is in this repository
- `agent-runs/` — anything an agent makes: one folder per round, and the
  friction log. All of it is a working artifact and all of it can be deleted.
  Write your leftovers there, never at the root
- `bin/engine.mjs` — the CLI: `help`, `check`, `agent.*`, and every verb
