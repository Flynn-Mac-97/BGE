<!-- Generated from plugins/builtin/agent-workspace.js; sha256 996b47a7f2b30c29b2c0a7b8860f7f3e608d68e2ab43bd9437129662c27dea83. Do not edit. -->
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
  source     168 lines
```
