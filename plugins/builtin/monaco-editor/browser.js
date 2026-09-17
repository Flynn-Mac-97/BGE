import * as monaco from 'monaco-editor/editor/editor.main.js'
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker'
import TypeScriptWorker from 'monaco-editor/language/typescript/ts.worker.js?worker'
import JsonWorker from 'monaco-editor/language/json/json.worker.js?worker'
import CssWorker from 'monaco-editor/language/css/css.worker.js?worker'
import HtmlWorker from 'monaco-editor/language/html/html.worker.js?worker'
import { javascriptDefaults, typescriptDefaults } from 'monaco-editor/languages/features/typescript/register.js'
import { jsonDefaults } from 'monaco-editor/languages/features/json/register.js'
import { cssDefaults, lessDefaults, scssDefaults } from 'monaco-editor/languages/features/css/register.js'
import { htmlDefaults, handlebarDefaults, razorDefaults } from 'monaco-editor/languages/features/html/register.js'

// Monaco's worker factory is process-wide; editors and models remain owned by each mount.
const workers = new Set()
let previousEnvironment, installed = false
const environment = {
  getWorker(moduleId, label) {
    const WorkerType = label === 'javascript' || label === 'typescript' ? TypeScriptWorker : label === 'json' ? JsonWorker : ['css','scss','less'].includes(label) ? CssWorker : ['html','handlebars','razor'].includes(label) ? HtmlWorker : EditorWorker
    const worker = new WorkerType(); workers.add(worker); return worker
  }
}
export function dispose() {
  // Reset language clients as well as workers so re-enabling cannot reuse a terminated connection.
  for (const defaults of [javascriptDefaults, typescriptDefaults]) defaults.setCompilerOptions(defaults.getCompilerOptions())
  jsonDefaults.setDiagnosticsOptions(jsonDefaults.diagnosticsOptions)
  for (const defaults of [cssDefaults, lessDefaults, scssDefaults, htmlDefaults, handlebarDefaults, razorDefaults]) defaults.setOptions(defaults.options)
  for (const worker of workers) worker.terminate()
  workers.clear()
  if (globalThis.MonacoEnvironment === environment) globalThis.MonacoEnvironment = previousEnvironment
  installed = false
}
let sequence = 0
const language = path => /\.json$/.test(path) ? 'json' : /\.css$/.test(path) ? 'css' : /\.html$/.test(path) ? 'html' : /\.tsx?$/.test(path) ? 'typescript' : 'javascript'

export function mount(element, options) {
  if (!installed) { previousEnvironment = globalThis.MonacoEnvironment; globalThis.MonacoEnvironment = environment; installed = true }
  element.style.height = '540px'
  element.style.minWidth = '0'
  element.setAttribute('aria-label', 'Monaco code editor')
  const base = `file:///editor-session-${++sequence}/`
  const uri = path => monaco.Uri.parse(base + String(path).split('/').map(encodeURIComponent).join('/'))
  const models = new Map()
  for (const file of options.files || []) {
    if (!/\.(m?js|cjs|tsx?|json|css|html)$/.test(file.path)) continue
    const path = `${file.scope || 'source'}/${file.path}`
    if (!models.has(path)) models.set(path, monaco.editor.createModel(file.text, language(path), uri(path)))
  }
  const path = options.path || 'source/code.js'
  const model = models.get(path) || monaco.editor.createModel(options.value || '', language(path), uri(path))
  models.set(path, model)
  if (model.getValue() !== options.value) model.setValue(options.value || '')
  const editor = monaco.editor.create(element, {
    model, theme: 'vs-dark', readOnly: !!options.readOnly, automaticLayout: true,
    minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false,
    folding: true, wordWrap: options.wordWrap ? 'on' : 'off', ariaLabel: 'Source code editor', tabSize: 2
  })
  const subscription = model.onDidChangeContent(() => options.onChange?.(model.getValue()))
  const line = Math.max(1, Math.min(model.getLineCount(), options.line || 1))
  editor.setPosition({ lineNumber: line, column: 1 })
  editor.revealLineInCenter(line)
  return { dispose() { subscription.dispose(); editor.dispose(); for (const model of models.values()) model.dispose() } }
}
