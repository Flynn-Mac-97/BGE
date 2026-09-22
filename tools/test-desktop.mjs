/** Exercise the desktop, real terminal input, bridge, reload, and cleanup. */
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs/promises'
import electron from 'electron'

const root = await fs.mkdtemp(path.resolve('.engine/desktop-test-'))
if (process.env.ENGINE_BRIDGE_FIXTURE) await fs.cp(process.env.ENGINE_BRIDGE_FIXTURE, path.join(root, 'project'), { recursive: true })
const packaged = process.argv.includes('--packaged')
const executable = packaged ? path.resolve('release/Engine-win32-x64/Engine.exe') : electron
const child = spawn(executable, packaged ? [] : ['electron/main.mjs'], {
  cwd: process.cwd(), windowsHide: true, stdio: 'inherit',
  env: { ...process.env, ENGINE_DESKTOP_SMOKE: path.join(root, 'result.json'), ENGINE_STATE_ROOT: path.join(root, 'state'), ENGINE_PROJECT: path.join(root, 'project'), ENGINE_PROJECTS_ROOT: root }
})
const timer = setTimeout(() => { child.kill(); process.exitCode = 1 }, process.env.ENGINE_BRIDGE_FIXTURE ? 600000 : 120000)
child.on('exit', (code, signal) => { clearTimeout(timer); console.log(`Desktop exited: ${code}, signal: ${signal}`); process.exitCode = code ?? 1 })
