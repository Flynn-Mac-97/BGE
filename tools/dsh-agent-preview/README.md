# dsh-agent-preview

A host-plane dsh plugin that shows **live agents and what they are doing** —
a `/agents` slash command in the web GUI.

## What it shows

For every live agent (the root session agent plus every spawned subagent):

```
Agents: 2 live (1 running)

● session-root-123 — running deepseek-v4-flash
    task:  Refactor the render pipeline and report back
    doing: tool pwsh git status --short
    last:  I updated engine/render.js
    age:   0s

○ session-child-456 — idle deepseek-v4-flash
    task:  Audit the test suite
    age:   0s
```

- **status** — `● running` / `○ idle` (from `agent.status`, live)
- **task** — the latest user message the agent was given
- **doing** — the last tool call (shell tools show their `command` directly)
- **last** — the last assistant text
- **age** — seconds since the agent's last activity
- When the subagent catalog is available, rows also carry the durable label,
  mode, parent, and depth (tree-indented).

## How it works

- Subscribes to the `session/event` firehose and folds each committed event
  (`user/message`, `tool/call`, `assistant/message`, `turn/start`, `turn/end`)
  into an in-memory activity map keyed by session id.
- Subscribes to `agent/created` / `agent/disposed` to track liveness.
- Registers the `/agents` command through `ctx.commands`; the handler reads
  `ctx.agents.list()` live and renders the snapshot. Handler output is UI text
  only — it never enters model history or tokens.

## Files

| path | role |
|---|---|
| `package.json` | package manifest (`type: module`, main → `lib/index.js`) |
| `lib/index.js` | the plugin (`name`, `inject`, `apply`) |
| `test-unit.mjs` | mock-ctx unit harness with assertions |
| `overlay.test.yml` | `--patch` overlay proving the row loads in a real boot |

## Install

The plugin is installed as a plain package under the shared profile module
fallback (`$DSH_HOME/profiles/node_modules/dsh-agent-preview/`), so no pnpm is
needed. The web profile's `cordis.patch.yml` inserts the row by relative path
(which the loader resolves against the profile dir):

```yaml
- insert:
    - id: agent-preview
      name: '../node_modules/dsh-agent-preview/lib/index.js'
```

The profile patch layer is live-watched, so editing the patch file hot-applies
the row to a running `dsh web` (or restart the web profile to be sure). The
`/agents` command then appears in the command menu.

## Test

```sh
node test-unit.mjs                       # mock-ctx unit test
dsh --profile headless --patch overlay.test.yml "Reply with exactly: OK"
```

## Known limitations

- The activity map is in-memory only: it resets when the process restarts and
  reflects only events since boot.
- The snapshot is point-in-time at command invocation; run `/agents` again to
  refresh.
