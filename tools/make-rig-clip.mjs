#!/usr/bin/env node
/**
 * Make a rig clip from a text prompt, through kimodo.cpp.
 *
 *   node tools/make-rig-clip.mjs --prompt "a person walks forward" --name walk
 *
 * Three doors to the same clip, in the order to try them:
 *
 *   --server http://127.0.0.1:8094   the demo server, if one is running
 *   --generator <path to kmd-generate>   the binary the demo itself shells to
 *   --from <directory>               buffers already written, no generator at all
 *
 * kimodo is not part of this checkout and is never downloaded by it. Install it
 * with `node tools/install-kimodo.mjs` and this reads KIMODO_HOME for its paths.
 * `plugins/builtin/kimodo.agent.md` is the guide.
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildClip, writeClip, readFloats, skeletonFor } from './lib/motion-clip.mjs'

const CHECKOUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HOME = process.env.KIMODO_HOME || path.resolve(CHECKOUT, '..', 'kimodo.cpp')

const DEFAULTS = {
  prompt: null,
  name: 'clip',
  out: null,
  project: process.env.ENGINE_PROJECT || 'project',
  // The demo server's own defaults. Fewer diffusion steps is the first thing to
  // reach for when a run is slow, and the first thing that makes motion mush.
  frames: 150,
  steps: 100,
  seed: 0,
  model: 'soma-rp-v1.1',
  server: null,
  generator: null,
  from: null,
  motionGguf: null,
  textBundle: null,
  skeleton: null,
  map: null,
  fps: 30,
  loop: true,
  up: 'y',
  scale: 1
}

/** `--key value`, and `--once` and `--loop` for the one boolean. */
function options(argv) {
  const settings = { ...DEFAULTS }
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index]
    if (key === '--once') { settings.loop = false; continue }
    if (key === '--loop') { settings.loop = true; continue }
    if (!key.startsWith('--')) throw new Error(`unexpected argument ${key}`)
    const name = key.slice(2).replace(/-(.)/g, (_, letter) => letter.toUpperCase())
    if (!(name in settings)) throw new Error(`unknown option ${key}`)
    const value = argv[++index]
    if (value === undefined) throw new Error(`${key} needs a value`)
    settings[name] = typeof DEFAULTS[name] === 'number' ? Number(value) : value
  }
  return settings
}

/** The two raw buffers and how many frames and joints they hold. */
async function generate(settings) {
  if (settings.from) return fromDirectory(settings.from, settings)
  if (settings.server) return fromServer(settings)
  return fromGenerator(settings)
}

/** The prompt a generator run left beside its buffers, when it left one. */
function promptIn(directory) {
  const file = path.join(directory, 'prompt.txt')
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : null
}

function fromDirectory(directory, settings) {
  const rotations = readFloats(path.join(directory, 'local_rotations_xyzw.f32'))
  const rootFile = path.join(directory, 'root_positions.f32')
  const root = fs.existsSync(rootFile) ? readFloats(rootFile) : null
  const frames = root ? root.length / 3 : settings.frames
  return { rotations, root, frames, joints: rotations.length / 4 / frames }
}

/**
 * The demo server: ask, wait, then take the buffers.
 *
 * The status word is printed rather than matched, because the server decides
 * what it says and a tool that matches the wrong word waits for ever.
 */
async function fromServer(settings) {
  const base = settings.server.replace(/\/$/, '')
  const asked = await post(`${base}/api/generate`, {
    prompt: settings.prompt,
    frames: settings.frames,
    steps: settings.steps,
    seed: settings.seed,
    model: settings.model
  })
  const id = asked.id
  if (!id) throw new Error(`server returned no animation id: ${JSON.stringify(asked)}`)

  const working = new Set(['pending', 'queued', 'running', 'generating'])
  let animation = asked
  for (let attempt = 0; working.has(animation.status); attempt++) {
    if (attempt > 600) throw new Error(`animation ${id} still ${animation.status} after 10 minutes`)
    await new Promise(resume => setTimeout(resume, 1000))
    const list = await get(`${base}/api/animations`)
    animation = (Array.isArray(list) ? list : list.animations || []).find(one => one.id === id) || animation
    process.stdout.write(`\r${animation.status}${animation.progress ? ' ' + animation.progress : ''}   `)
  }
  process.stdout.write('\n')
  if (animation.error) throw new Error(`${animation.status}: ${animation.error}`)

  const rotations = await floats(`${base}/api/animations/${id}/rotations.f32`)
  const root = await floats(`${base}/api/animations/${id}/root.f32`)
  const frames = animation.frames || root.length / 3
  return { rotations, root, frames, joints: rotations.length / 4 / frames }
}

/** The binary the demo server shells to, run straight. */
async function fromGenerator(settings) {
  const name = process.platform === 'win32' ? 'kmd-generate.exe' : 'kmd-generate'
  const generator = settings.generator || path.join(HOME, 'build', 'release', name)
  const motion = settings.motionGguf || path.join(HOME, 'models', `kimodo-${settings.model}-f32.gguf`)
  const bundle = settings.textBundle || path.join(HOME, 'generated', 'llm2vec-text-bundle')
  for (const [what, where] of [['generator', generator], ['motion model', motion], ['text bundle', bundle]]) {
    if (!fs.existsSync(where)) {
      throw new Error(`no ${what} at ${where} — run node tools/install-kimodo.mjs, or pass --server`)
    }
  }

  const workspace = path.join(CHECKOUT, 'agent-runs', 'rig-clips', settings.name)
  fs.mkdirSync(workspace, { recursive: true })
  const promptFile = path.join(workspace, 'prompt.txt')
  fs.writeFileSync(promptFile, settings.prompt)

  await run(generator, [
    motion, bundle, promptFile,
    String(settings.frames), String(settings.steps), String(settings.seed), workspace
  ], path.join(path.dirname(generator), 'bin'))
  return fromDirectory(workspace, settings)
}

const get = async url => {
  const answer = await fetch(url)
  if (!answer.ok) throw new Error(`${url} — ${answer.status} ${answer.statusText}`)
  return answer.json()
}

const post = async (url, body) => {
  const answer = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  })
  if (!answer.ok) throw new Error(`${url} — ${answer.status} ${answer.statusText}`)
  return answer.json()
}

const floats = async url => {
  const answer = await fetch(url)
  if (!answer.ok) throw new Error(`${url} — ${answer.status} ${answer.statusText}`)
  return new Float32Array(await answer.arrayBuffer())
}

/**
 * Run the generator, with `libraries` on PATH.
 *
 * The build puts ggml's shared libraries in a `bin` directory beside the
 * binary, not next to it, so it will not start without them on PATH.
 */
const run = (command, args, libraries) => new Promise((resolve, reject) => {
  const environment = libraries
    ? { ...process.env, PATH: `${libraries}${path.delimiter}${process.env.PATH}` }
    : process.env
  const child = spawn(command, args, { stdio: 'inherit', env: environment })
  child.on('error', reject)
  child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)))
})

export async function main(argv = process.argv.slice(2)) {
  const settings = options(argv)
  if (!settings.prompt && !settings.from) throw new Error('--prompt is required, or --from <directory>')

  const { rotations, root, frames, joints } = await generate(settings)
  if (!Number.isInteger(joints)) throw new Error(`${rotations.length} rotation values is not ${frames} frames of whole joints`)

  const skeleton = settings.skeleton || skeletonFor(joints)
  if (!skeleton) throw new Error(`no skeleton has ${joints} joints — name one with --skeleton`)

  const clip = buildClip({
    rotations, root, joints, frames, skeleton,
    map: settings.map ? JSON.parse(fs.readFileSync(settings.map, 'utf8')) : null,
    upAxis: settings.up,
    rootScale: settings.scale,
    framesPerSecond: settings.fps,
    loop: settings.loop,
    name: settings.name,
    // Only what actually made these buffers. With --from, the generation flags
    // are whatever this run happened to default to and did not produce
    // anything, so they are left out rather than written as fact. The frame
    // count is the buffer's own.
    source: settings.from
      ? { generator: 'kimodo.cpp', skeleton, frames, prompt: promptIn(settings.from), from: settings.from }
      : {
          generator: 'kimodo.cpp', model: settings.model, skeleton, frames,
          prompt: settings.prompt, steps: settings.steps, seed: settings.seed
        }
  })

  const out = settings.out || path.join(CHECKOUT, settings.project, 'assets', 'motion', `${settings.name}.json`)
  writeClip(out, clip)

  console.log(`${path.relative(CHECKOUT, out).replaceAll('\\', '/')} — ${clip.rotations.length} frames, ${clip.nodes.length} nodes, ${skeleton}`)
  // A type names a clip the way it names a texture: relative to the project's
  // assets. An --out anywhere else has no such name and cannot be declared.
  const reference = path.relative(path.join(CHECKOUT, settings.project, 'assets'), out).replaceAll('\\', '/')
  if (reference.startsWith('..')) console.log(`\nnot under ${settings.project}/assets, so no type can name it`)
  else console.log(`\ndeclare it on the type:\n  rig: { clips: { ${settings.name}: '${reference}' } }`)
  return out
}

if (typeof process !== 'undefined' && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exit(1) })
}
