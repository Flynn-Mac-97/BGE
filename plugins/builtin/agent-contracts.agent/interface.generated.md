<!-- Generated from plugins/builtin/agent-contracts.js; sha256 bf836cb0286475d6c3fd2afc83007fe645d3fc981b333ff12d8b18818e788f08. Do not edit. -->
**Interface, parsed from source** (plugins/builtin/agent-contracts.js). Where the prose below it disagrees, this is the code.

```
  plugin     Agent Contracts
  category   agents
  lifecycle  scoped
  provides   agent.contracts
  commands   agent.contracts (Inspect plugin contracts and execution order)
             agent.commands (Find commands and their accepted arguments)
  arguments  agent.contracts: options = {}
  input      agent.contracts: { type: 'object', additionalProperties: false, properties: { query: { type: 'string' }, plugin: { type: 'string' }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 50 } } }
  arguments  agent.commands: options = {}
  input      agent.commands: { type: 'object', additionalProperties: false, properties: { query: { type: 'string' }, plugin: { type: 'string' }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 50 } } }
  source     24 lines
```
