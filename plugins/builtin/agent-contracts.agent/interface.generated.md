<!--8aec0eb7-->
parsed from source
  plugin Agent Contracts
  category agents
  lifecycle scoped
  provides agent.contracts
  commands agent.contracts
  agent.commands
  arguments agent.contracts: options = {};agent.commands: options = {}
  input agent.contracts: { type: 'object', additionalProperties: false, properties: { query: { type: 'string' }, plugin: { type: 'string' }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 50 } } };agent.commands: { type: 'object', additionalProperties: false, properties: { query: { type: 'string' }, plugin: { type: 'string' }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 50 } } }
  source 87 lines
