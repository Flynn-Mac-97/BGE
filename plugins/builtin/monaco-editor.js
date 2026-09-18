import { createMounts } from './editor-services/mounts.js'

export default {
  name: 'Monaco Code Editor', category: 'editor', lifecycle: 'scoped',
  about: 'Monaco editor, loaded on demand.',
  provides: ['editor.code'],
  onLoad(context, scope) {
    const service = createMounts(() => import('./monaco-editor/browser.js'))
    scope.provide('editor.code', service)
    scope.defer(() => service.dispose())
  }
}
