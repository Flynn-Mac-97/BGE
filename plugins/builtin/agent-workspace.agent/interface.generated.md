<!--72b9ea33-->
parsed from source
  plugin Agent Workspace
  category agents
  points 1 panel, 1 menu
  commands agent.context
  agent.status
  agent.toggle
  agent.create
  agents.browse
  arguments agent.context: request;agent.status:;agent.toggle: value;agent.create: value;agents.browse:
  context agents
  listens files:written
  emits open:agent-file {scope, path}
  source 168 lines
