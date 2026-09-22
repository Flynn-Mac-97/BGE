import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'

const element = id => document.getElementById(id)
const sessions = new Map()
let selected = null, page = 'terminal', snapshot, polling = false, reading = false
let previousSessions = '', previousInstances = '', previousEvents = '', previousProviders = ''
let height = 300
const call = (action, args = {}) => window.desktop.command({ action, ...args })
const error = problem => { element('error').textContent = problem.message || String(problem); element('error').hidden = false }
const act = callback => async () => {
  element('error').hidden = true
  try { await callback(); await refresh() } catch (problem) { error(problem) }
}
const button = (label, action) => {
  const node = document.createElement('button')
  node.textContent = label
  node.onclick = act(action)
  return node
}

function fit() {
  const session = sessions.get(selected)
  if (!session || page !== 'terminal') return
  session.fit.fit()
  void call('terminal.resize', { id: selected, columns: session.terminal.cols, rows: session.terminal.rows }).catch(error)
}

function select(id) {
  selected = id
  for (const [name, session] of sessions) session.mount.hidden = name !== id
  for (const tab of element('sessions').children) tab.setAttribute('aria-selected', String(tab.dataset.id === id))
  fit()
  sessions.get(id)?.terminal.focus()
}

function addSession(record) {
  const mount = document.createElement('div')
  mount.className = 'terminal-mount'
  mount.hidden = true
  element('terminal-area').append(mount)
  const terminal = new Terminal({ cursorBlink: true, scrollback: 5000, fontSize: 13, theme: { background: '#111318', foreground: '#dfe4ed', cursor: '#8bbcff' } })
  const fitAddon = new FitAddon()
  const search = new SearchAddon()
  terminal.loadAddon(fitAddon)
  terminal.loadAddon(search)
  terminal.open(mount)
  terminal.onData(text => void call('terminal.write', { id: record.id, text }).catch(error))
  sessions.set(record.id, { terminal, fit: fitAddon, search, mount, offset: 0, exited: false })
  element('terminal-empty').hidden = true
}

function renderSessions(records) {
  const signature = JSON.stringify(records.map(record => [record.id, record.state, record.exitCode]))
  if (signature === previousSessions) return
  previousSessions = signature
  for (const record of records) if (!sessions.has(record.id)) addSession(record)
  for (const [id, session] of sessions) if (!records.some(record => record.id === id)) {
    session.terminal.dispose(); session.mount.remove(); sessions.delete(id)
  }
  element('sessions').replaceChildren(...records.map(record => {
    const tab = button(`${record.label} · ${record.id}${record.state === 'exited' ? ` · exit ${record.exitCode}` : ''}`, () => select(record.id))
    tab.dataset.id = record.id
    tab.setAttribute('role', 'tab')
    tab.setAttribute('aria-selected', String(record.id === selected))
    return tab
  }))
  if (!sessions.has(selected) && records.length) select(records.at(-1).id)
}

async function readOutput() {
  if (reading || !selected || page !== 'terminal') return
  reading = true
  const id = selected, session = sessions.get(id)
  try {
    const result = await call('terminal.read', { id, offset: session.offset })
    if (result.truncated) session.terminal.writeln('\r\n[Earlier output exceeded the session buffer]\r\n')
    if (result.text) await new Promise(resolve => session.terminal.write(result.text, resolve))
    session.offset = result.offset
    if (result.exitCode !== null && !result.text && !session.exited) {
      session.exited = true
      session.terminal.writeln(`\r\n[Process exited with code ${result.exitCode}]`)
    }
  } catch (problem) { error(problem) } finally { reading = false }
}

function renderInstances(records) {
  const signature = JSON.stringify([records, snapshot.active])
  if (signature === previousInstances) return
  previousInstances = signature
  element('instance-list').replaceChildren(...records.map(record => {
    const row = document.createElement('div'); row.className = 'instance'
    const name = document.createElement('span'); name.className = 'name'; name.textContent = record.label || record.id
    const state = document.createElement('span'); state.className = 'state'; state.textContent = record.state
    const detail = document.createElement('small'); detail.className = 'grow'; detail.textContent = [record.id, record.kind, record.pid && `PID ${record.pid}`, record.port && `:${record.port}`, record.cwd || record.serves].filter(Boolean).join(' · ')
    row.append(name, state, detail)
    if (record.kind === 'engine-view') row.append(button(record.id === snapshot.active ? 'Shown' : 'Show', () => call('engine.activate', { id: record.id })))
    if (record.kind !== 'engine-backend') row.append(button('Stop', () => call('instance.stop', { id: record.id })))
    return row
  }))
}

function renderEvents(events) {
  const signature = String(events.at(-1)?.sequence)
  if (signature === previousEvents) return
  previousEvents = signature
  const list = element('events')
  list.replaceChildren(...events.slice().reverse().map(event => {
    const row = document.createElement('li')
    row.className = event.event === 'error' ? 'error' : ''
    row.textContent = `${event.at.slice(11, 19)}  ${event.id}  ${event.event}  ${event.detail || ''}`
    return row
  }))
}

async function refresh() {
  if (polling) return
  polling = true
  try {
    snapshot = await call('snapshot')
    element('project').textContent = snapshot.project.project
    if (!element('cwd').value) element('cwd').value = snapshot.project.directory
    element('health').textContent = `${snapshot.instances.length} running instances`
    element('new-dev').hidden = !snapshot.development
    renderSessions(snapshot.terminals)
    renderInstances(snapshot.instances)
    renderEvents(snapshot.events)
    const providers = JSON.stringify(snapshot.providers)
    if (providers !== previousProviders) {
      previousProviders = providers
      element('provider').replaceChildren(...snapshot.providers.map(provider => {
        const option = document.createElement('option'); option.value = provider.id
        option.textContent = provider.id === 'shell' ? 'Shell' : `${provider.id}${provider.available ? '' : ' (not installed)'}`
        option.disabled = !provider.available
        return option
      }))
    }
  } catch (problem) { error(problem) } finally { polling = false }
}

for (const tab of document.querySelectorAll('[data-page]')) tab.onclick = () => {
  page = tab.dataset.page
  for (const panel of document.querySelectorAll('.page')) panel.hidden = panel.id !== page
  for (const button of document.querySelectorAll('[data-page]')) button.setAttribute('aria-selected', String(button === tab))
  fit()
}
element('start').onclick = act(async () => {
  const result = await call('terminal.start', { provider: element('provider').value, cwd: element('cwd').value })
  await refresh()
  document.querySelector('[data-page="terminal"]').click()
  select(result.id)
})
element('choose-directory').onclick = act(async () => { const result = await call('folder.choose'); if (result.path) element('cwd').value = result.path })
element('open-project').onclick = act(async () => {
  const result = await call('folder.choose')
  if (result.path) { await call('project.open', result); element('cwd').value = result.path }
})
element('new-view').onclick = act(() => call('engine.open'))
element('reload').onclick = act(() => call('engine.reload'))
element('new-dev').onclick = act(() => call('dev.start'))
element('interrupt').onclick = act(() => selected && call('terminal.interrupt', { id: selected }))
element('stop').onclick = act(() => selected && call('terminal.stop', { id: selected }))
element('search').oninput = () => sessions.get(selected)?.search.findNext(element('search').value)
function resize(next) {
  height = Math.round(Math.max(180, Math.min(innerHeight - 100, next)))
  element('console').style.height = `${height}px`
  void call('console.layout', { height }).catch(error)
  fit()
}
element('expand').onclick = () => resize(height > innerHeight / 2 ? 300 : innerHeight - 100)
element('resize').onpointerdown = event => {
  event.currentTarget.setPointerCapture(event.pointerId)
  event.currentTarget.onpointermove = move => resize(innerHeight - move.clientY)
  event.currentTarget.onpointerup = () => { element('resize').onpointermove = null }
}
element('resize').onkeydown = event => { if (event.key === 'ArrowUp') resize(height + 30); if (event.key === 'ArrowDown') resize(height - 30) }
addEventListener('resize', () => resize(height))
setInterval(refresh, 1000)
setInterval(readOutput, 40)
void refresh()
