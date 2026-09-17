import { inspectCalls, relativeSource } from './calls.js'

export function createCallInspector(context, state, refresh) {
  const history = []
  const summary = () => ({ file: state.file, selected: state.callSelection, ...state.analysis })
  const setFunction = (id = '') => {
    const selected = state.analysis?.functions.find(item => item.id === id)
    if (id && !selected) throw new Error(`no function: ${id}`)
    state.callSelection = id
    state.line = selected?.line || 1
    refresh()
    return summary()
  }
  async function read(source, exported) {
    const generation = ++state.generation
    state.status = 'Reading function source…'
    refresh()
    try {
      const result = await context.files.readSource(source.scope, source.file)
      if (generation !== state.generation) return
      state.sourceRef = source
      state.file = `${source.scope === 'project' ? 'project/' : ''}${source.file}`
      state.text = result.text
      state.analysis = inspectCalls(result.text)
      state.callSelection = exported ? state.analysis.exports[exported] || '' : ''
      state.line = state.analysis.functions.find(item => item.id === state.callSelection)?.line || 1
      state.status = state.analysis.error || (exported && !state.callSelection ? `Export ${exported} has no resolved function definition here. Re-exports and aliases are not followed.` : 'Current source. Select a function or click a source line number to inspect its calls.')
    } catch (error) {
      if (generation !== state.generation) return
      state.status = `Could not inspect source: ${error.message}`
    }
    if (generation === state.generation) refresh()
    return summary()
  }
  return {
    async open() {
      if (!state.sourceRef) throw new Error('No source file was recorded for this selection')
      history.length = 0
      state.callView = true
      const line = state.line
      await read(state.sourceRef)
      if (state.callView && !state.analysis?.error) this.line(line)
      return summary()
    },
    select: setFunction,
    line(line) {
      if (!Number.isInteger(line) || line < 1 || line > state.text.split('\n').length) throw new Error('line must be within the current source file')
      const selected = state.analysis?.functions.filter(item => item.line <= line && item.endLine >= line).sort((left, right) => (left.end - left.start) - (right.end - right.start))[0]
      state.callSelection = selected?.id || ''
      state.line = line
      refresh()
      return summary()
    },
    site(id) {
      const call = state.analysis?.calls.find(item => item.id === id)
      if (!call) throw new Error(`no call site: ${id}`)
      state.line = call.line
      refresh()
      return { file: state.file, line: state.line }
    },
    async definition(id) {
      const call = state.analysis?.calls.find(item => item.id === id)
      if (!call) throw new Error(`no call site: ${id}`)
      if (call.target) return setFunction(call.target)
      const source = call.imported && relativeSource(state.sourceRef, call.imported.path)
      if (!source) {
        state.status = 'No local definition link: package imports and dynamic calls are not resolved.'
        refresh()
        return { resolved: false }
      }
      history.push({ sourceRef: state.sourceRef, file: state.file, text: state.text, analysis: state.analysis, callSelection: state.callSelection, line: state.line, status: state.status })
      return read(source, call.imported.name)
    },
    back() {
      const previous = history.pop()
      if (previous) { ++state.generation; Object.assign(state, previous); refresh() }
      return summary()
    },
    get canBack() { return history.length > 0 }
  }
}
