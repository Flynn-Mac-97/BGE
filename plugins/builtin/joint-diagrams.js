import { createMounts } from './editor-services/mounts.js'

export default {
  name: 'JointJS Diagrams', category: 'editor', lifecycle: 'scoped',
  about: 'Reusable interactive diagrams backed by the open-source JointJS core. Accepts nodes, links and callbacks from any plugin.',
  provides: ['editor.diagram'],
  onLoad(context, scope) {
    const service = createMounts(() => import('./joint-diagrams/browser.js'))
    scope.provide('editor.diagram', service)
    scope.defer(() => service.dispose())
  }
}
