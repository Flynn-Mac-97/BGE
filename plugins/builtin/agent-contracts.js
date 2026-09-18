const input = { type: 'object', additionalProperties: false, properties: { query: { type: 'string' }, plugin: { type: 'string' }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 50 } } }
const page = (items, options) => { const offset = options.offset || 0, limit = options.limit || 20; return { total: items.length, offset, nextOffset: offset + limit < items.length ? offset + limit : null, items: items.slice(offset, offset + limit) } }
const matches = (text, query) => !query || text.toLowerCase().includes(query.toLowerCase())

export default {
  name: 'Agent Contracts', category: 'agents', lifecycle: 'scoped', provides: ['agent.contracts'],
  about: 'Live plugin ownership and dependencies.',
  onLoad(context, scope) { scope.provide('agent.contracts', { inspect: () => context.loader.contracts() }) },
  commands: [
    { id: 'agent.contracts', label: 'Plugin contracts', inputSchema: input,
      run(context, options = {}) {
        const report = context.loader.contracts()
        const plugins = report.plugins.filter(plugin => (!options.plugin || plugin.name === options.plugin) && matches(plugin.name, options.query))
        const selected = page(plugins, options), names = new Set(selected.items.map(plugin => plugin.name))
        return { ...selected, services: report.services.filter(service => names.has(service.owner)), schedule: Object.fromEntries(Object.entries(report.schedule).map(([phase, systems]) => [phase, systems.filter(system => names.has(system.plugin))])), scheduleError: report.scheduleError, diagnostics: report.diagnostics.filter(item => names.has(item.plugin)), coverage: { plugins: report.plugins.length, scoped: report.plugins.filter(plugin => plugin.lifecycle === 'scoped').length }, note: 'Reads and writes are declarations, not runtime enforcement. Legacy plugins may retain unmanaged side effects when disabled.' }
      } },
    { id: 'agent.commands', label: 'Find commands', inputSchema: input,
      run(context, options = {}) {
        const commands = [...context.loader.contrib.commands, ...context.loader.contrib.menus].filter(command => (!options.plugin || command.plugin === options.plugin) && matches(`${command.id} ${command.label || ''}`, options.query))
        return page(commands.map(command => ({ id: command.id, plugin: command.plugin, label: command.label, inputSchema: command.inputSchema ? JSON.parse(JSON.stringify(command.inputSchema)) : null, validation: command.inputSchema ? 'validated' : 'undeclared' })), options)
      } }
  ]
}
