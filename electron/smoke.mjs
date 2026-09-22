import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createTerminals } from './terminals.mjs'
import { spawn } from 'node:child_process'
import { nativeImage } from 'electron'

async function until(check, description, timeout = 30000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out: ${description}`)
}

export async function smokeDesktop({ command, window, views, supervisor, backend }) {
  const first = (await command({ action: 'snapshot' })).active
  const view = views.get(first).view
  await until(() => view.webContents.executeJavaScript('Boolean(window.engine)'), 'engine boot')
  assert.equal(await view.webContents.executeJavaScript('typeof window.desktop'), 'undefined')
  const call = async op => {
    const response = await fetch(new URL('api/engine', backend.url), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op, client: first }) })
    const body = await response.json()
    assert.equal(body.ok, true, JSON.stringify(body))
    assert.equal(body.answeredBy.id, first)
    return body
  }
  await until(async () => {
    const reply = await (await fetch(new URL('api/server', backend.url))).json()
    return reply.tabs.some(tab => tab.id === first)
  }, 'bridge connection')
  await call('ping')
  const editorCapture = await command({ action: 'capture', name: 'smoke-editor' })
  const editorBounds = view.getBounds()
  assert.deepEqual(editorCapture.size, [editorBounds.width, editorBounds.height])
  const windowCapture = await command({ action: 'capture', scope: 'window', name: 'smoke-window' })
  assert.deepEqual(windowCapture.size, window.getContentSize())
  for (const capture of [editorCapture, windowCapture]) {
    const picture = nativeImage.createFromBuffer(Buffer.from(capture.__files[0].base64, 'base64'))
    assert.equal(picture.isEmpty(), false)
    assert.deepEqual([picture.getSize().width, picture.getSize().height], capture.size)
    await fs.writeFile(process.env.ENGINE_DESKTOP_SMOKE + '.' + capture.scope + '.png', picture.toPNG())
  }
  await assert.rejects(() => command({ action: 'capture', name: '../escape' }), /name/)
  await assert.rejects(() => command({ action: 'capture', client: 'missing' }), /active/)
  const captured = await call('see.editor')
  assert.ok(JSON.stringify(captured).includes('electron.capturePage'))
  assert.equal(await view.webContents.executeJavaScript('typeof globalThis.__engineViewer'), 'undefined')
  await view.webContents.executeJavaScript("engine.editor.context.files.write('desktop-proof.txt', 'saved from desktop')")
  assert.equal(await fs.readFile(path.join(process.env.ENGINE_PROJECT, 'desktop-proof.txt'), 'utf8'), 'saved from desktop')
  if (process.env.ENGINE_BRIDGE_FIXTURE) {
    await new Promise((resolve, reject) => {
      const environment = { ...process.env, ENGINE_PORT: String(backend.port), ENGINE_HOST: backend.url.replace(/\/$/, '') }
      for (const name of ['ENGINE_STATE_ROOT', 'ENGINE_PROJECT', 'ENGINE_PROJECTS_ROOT', 'ENGINE_CLIENT', 'ELECTRON_RUN_AS_NODE']) delete environment[name]
      const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd test'], {
        cwd: supervisor.checkout, windowsHide: true, stdio: 'inherit', env: environment
      })
      child.once('error', reject)
      child.once('exit', code => code === 0 ? resolve() : reject(new Error(`CLI bridge suite exited ${code}`)))
    })
    return
  }
  const { id } = await command({ action: 'terminal.start', provider: 'shell', cwd: supervisor.checkout })
  await command({ action: 'terminal.resize', id, columns: 110, rows: 20 })
  await command({ action: 'terminal.write', id, text: "Write-Output ('DESKTOP_' + 'PTY_OK')\r" })
  await until(async () => (await command({ action: 'terminal.read', id })).text.includes('DESKTOP_PTY_OK'), 'terminal output')
  await command({ action: 'terminal.write', id, text: "engine agent.context '{\"task\":\"effects\",\"nodes\":[\"effects\"]}'\r" })
  await until(async () => /\"id\"\s*:\s*\"effects\"/.test((await command({ action: 'terminal.read', id })).text), 'skill packet from checkout terminal')
  await command({ action: 'terminal.write', id, text: 'engine ping\r' })
  try {
    await until(async () => /"ready"\s*:\s*true/.test((await command({ action: 'terminal.read', id })).text), 'engine command from terminal')
  } catch (error) {
    console.log((await command({ action: 'terminal.read', id })).text)
    throw error
  }
  await command({ action: 'terminal.write', id, text: 'engine check\r' })
  await until(async () => /"ok"\s*:\s*true,\s*"problems"\s*:\s*\[\]/.test((await command({ action: 'terminal.read', id })).text), 'offline checks from terminal')
  const agentDirectory = path.join(path.dirname(process.env.ENGINE_DESKTOP_SMOKE), 'provider with spaces')
  await fs.mkdir(agentDirectory)
  await fs.writeFile(path.join(agentDirectory, 'codex.cmd'), '@echo off\r\necho PROVIDER_LAUNCH_OK\r\n')
  const environment = { ...process.env }
  const pathKey = Object.keys(environment).find(key => key.toLowerCase() === 'path') || 'PATH'
  environment[pathKey] = agentDirectory + path.delimiter + environment[pathKey]
  const providers = createTerminals(supervisor, { environment })
  const agent = providers.start({ provider: 'codex', cwd: agentDirectory })
  try { await until(() => providers.read(agent.id).text.includes('PROVIDER_LAUNCH_OK'), 'provider shim with spaces') }
  catch (error) { console.log(providers.read(agent.id)); throw error }
  await providers.close()
  await command({ action: 'engine.reload' })
  await until(() => view.webContents.executeJavaScript('Boolean(window.engine)'), 'engine reload')
  assert.equal((await command({ action: 'snapshot' })).terminals.find(session => session.id === id).state, 'running')
  const second = await command({ action: 'engine.open' })
  await assert.rejects(() => command({ action: 'capture', client: first }), /active/)
  await command({ action: 'engine.activate', id: first })
  assert.equal((await command({ action: 'snapshot' })).active, first)
  await command({ action: 'instance.stop', id: second.id })
  await window.webContents.executeJavaScript("document.querySelector('[data-page=instances]').click()")
  await until(() => window.webContents.executeJavaScript("document.querySelectorAll('.instance').length > 0"), 'instance UI')
  await command({ action: 'terminal.stop', id })
  assert.equal((await command({ action: 'snapshot' })).terminals.find(session => session.id === id).state, 'exited')
  assert.ok(supervisor.events.some(event => event.id === id && event.event === 'closed'))
  const result = { ok: true, bridge: first, terminal: id, reloadPreservedTerminal: true, isolatedGameView: true }
  await fs.writeFile(process.env.ENGINE_DESKTOP_SMOKE, JSON.stringify(result, null, 2))
  // Only the desktop console is captured; game inspection uses the See plugin.
  const [, height] = window.getContentSize()
  const picture = await window.webContents.capturePage({ x: 0, y: height - 300, width: 1000, height: 300 })
  await fs.writeFile(process.env.ENGINE_DESKTOP_SMOKE + '.png', picture.toPNG())
  console.log(JSON.stringify(result))
}
