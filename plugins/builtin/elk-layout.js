export default {
  name: 'ELK Graph Layout', category: 'editor', lifecycle: 'scoped',
  about: 'Graph arrangement with ELK.',
  provides: ['graph.layout'],
  onLoad(context, scope) {
    let library, closed = false
    scope.provide('graph.layout', {
      async arrange(graph) {
        if (closed) throw new Error('ELK Graph Layout is disabled')
        library ||= import('./elk-layout/layout.js')
        const { arrange } = await library
        const result = await arrange(graph)
        if (closed) throw new Error('ELK Graph Layout is disabled')
        return result
      }
    })
    scope.defer(() => { closed = true })
  }
}
