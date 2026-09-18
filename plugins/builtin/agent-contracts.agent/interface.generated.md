<!-- Generated from plugins/builtin/agent-contracts.js; sha256 7b75df6909ac67771fe82f7e1dd250779f02494d1c45821245e2a13b956909ca. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/agent-contracts.js). Where the prose below it disagrees, this is the code.

```
  plugin     Agent Contracts
  category   agents
  lifecycle  scoped
  provides   agent.contracts
  commands   agent.contracts (Plugin contracts)
             agent.commands (Find commands)
  arguments  agent.contracts: options = {}
  input      agent.contracts: { type: 'object', additionalProperties: false, properties: { query: { type: 'string' }, plugin: { type: 'string' }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 50 } } }
  arguments  agent.commands: options = {}
  input      agent.commands: { type: 'object', additionalProperties: false, properties: { query: { type: 'string' }, plugin: { type: 'string' }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 50 } } }
  source     24 lines
```
