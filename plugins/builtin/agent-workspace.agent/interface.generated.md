<!-- Generated from plugins/builtin/agent-workspace.js; sha256 fd35a74de3fc483769e2f00c850b313d6bec6bccd1b7c511ca2053c5e25521ba. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/agent-workspace.js). Where the prose below it disagrees, this is the code.

```
  plugin     Agent Workspace
  category   agents
  points     1 panel, 1 menu
  commands   agent.context (Instruction packet)
             agent.status (Agent runs and tree)
             agent.toggle (Toggle a skill)
             agent.create (Add an instruction)
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
