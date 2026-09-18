<!-- Generated from plugins/builtin/agent-workspace.js; sha256 ab66cc4d2f6f2ca9ea79fb2eee79ac94229705596afa8c5663b24628059a5c1a. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/agent-workspace.js). Where the prose below it disagrees, this is the code.

```
  plugin     Agent Workspace
  category   agents
  points     1 panel, 1 menu
  commands   agent.context (Build a small instruction packet)
             agent.status (Read the agent tree and runs)
             agent.toggle (Turn an optional skill on or off)
             agent.create (Add an instruction or skill)
             agents.browse (AGENTS)
  arguments  agent.context: request
  arguments  agent.status: none
  arguments  agent.toggle: value
  arguments  agent.create: value
  arguments  agents.browse: none
  context    context.agents
  listens    files:written
  emits      open:agent-file {scope, path}
  source     163 lines
```
