import { createMounts } from './editor-services/mounts.js'

export default {
  name: 'Monaco Code Editor', category: 'editor', lifecycle: 'scoped',
  about: 'Reusable code editor backed by Monaco. Loads on demand; source writes belong to the consuming plugin.',
  provides: ['editor.code'],
  onLoad(context, scope) {
    const service = createMounts(() => import('./monaco-editor/browser.js'))
    scope.provide('editor.code', service)
    scope.defer(() => service.dispose())
  }
}
