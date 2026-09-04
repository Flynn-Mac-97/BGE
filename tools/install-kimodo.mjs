#!/usr/bin/env node
/**
 * Check for kimodo.cpp, and install it beside this checkout on request.
 *
 *   node tools/install-kimodo.mjs                 what is present, what is missing
 *   node tools/install-kimodo.mjs --install       clone, patch, build, fetch weights
 *
 * kimodo.cpp is a C++ repository with gigabytes of model weights. It is never
 * copied into this checkout: it is cloned to KIMODO_HOME, which defaults to
 * `kimodo.cpp` beside the checkout, and `tools/make-rig-clip.mjs` reads the same
 * variable. Nothing in the engine depends on it being there.
 *
 * Checking is the default because installing downloads gigabytes and compiles
 * C++. Every step prints the command it runs, so any of it can be run by hand.
 *
 * The build is CPU only and builds `kmd-generate` alone. Vulkan needs the SDK,
 * and the test targets link the Vulkan library whether or not it was built.
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const CHECKOUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HOME = process.env.KIMODO_HOME || path.resolve(CHECKOUT, '..', 'kimodo.cpp')
const REPOSITORY = 'https://github.com/localai-org/kimodo.cpp'
const DEFAULT_MODEL = 'soma-rp-v1.1'
const WINDOWS = process.platform === 'win32'
const PATCH = path.join(CHECKOUT, 'tools', 'kimodo-windows.patch')

/**
 * What a build needs, and what each one is for.
 *
 * `go` builds the demo server only, which is one of three doors to a clip — so
 * it is reported and never required. The C++ compiler is not listed because it
 * is not one command: on Windows it comes from Visual Studio and is found
 * below, and elsewhere cmake finds it.
 */
const NEEDED = [
  { command: 'git', for: 'cloning the repository and its submodules', required: true },
  { command: 'cmake', for: 'configuring the build (3.25 or newer)', required: true },
  { command: 'ninja', for: 'the build itself — pip install ninja', required: true },
  { command: 'python', for: 'the weight conversion scripts', required: true },
  // `hf` since huggingface_hub 1.0; the old `huggingface-cli` name still installs
  // a shim that refuses to run. The download script calls `hf`.
  { command: 'hf', for: 'downloading the GGUF weights — pip install huggingface_hub', required: true },
  { command: 'go', for: 'the demo server — optional, the binary works without it', required: false }
]

/**
 * Whether a command is on PATH.
 *
 * One string through a shell, so Windows finds a `.cmd` or `.bat` shim — pip
 * installs `hf` as one. `--help` is the second try because not every tool
 * answers `--version`.
 */
const found = command => ['--version', '--help'].some(flag =>
  spawnSync(`${command} ${flag}`, { stdio: 'ignore', shell: true }).status === 0)

const GENERATOR = WINDOWS ? 'kmd-generate.exe' : 'kmd-generate'

/**
 * The Visual Studio environment script, or null.
 *
 * cl.exe is not on PATH until this batch file has run, so on Windows every
 * cmake call goes through it. vswhere ships with the Visual Studio installer
 * and is the only supported way to find an installation.
 */
function visualStudio() {
  if (!WINDOWS) return null
  const vswhere = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe'
  if (!fs.existsSync(vswhere)) return null
  const answer = spawnSync(vswhere, [
    '-latest', '-products', '*',
    '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
    '-property', 'installationPath'
  ], { encoding: 'utf8' })
  const root = answer.stdout?.trim()
  if (!root) return null
  const script = path.join(root, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat')
  return fs.existsSync(script) ? script : null
}

/** Where each part of an install would be, and whether it is there. */
function state() {
  const build = ['release', 'debug']
    .map(preset => path.join(HOME, 'build', preset, GENERATOR))
    .find(fs.existsSync)
  return {
    home: HOME,
    cloned: fs.existsSync(path.join(HOME, 'CMakeLists.txt')),
    built: build || null,
    libraries: build ? path.join(path.dirname(build), 'bin') : null,
    weights: fs.existsSync(path.join(HOME, 'models')),
    textBundle: fs.existsSync(path.join(HOME, 'generated', 'llm2vec-text-bundle')),
    compiler: WINDOWS ? visualStudio() : 'cmake finds it'
  }
}

const run = (command, args, cwd) => new Promise((resolve, reject) => {
  console.log(`\n$ ${command} ${args.join(' ')}`)
  // No shell: every command here is a real executable, and a shell would need
  // each argument escaped.
  const child = spawn(command, args, { cwd, stdio: 'inherit' })
  child.on('error', reject)
  child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)))
})

/** cmake, through the Visual Studio environment when there is one. */
function cmake(args, cwd) {
  const script = visualStudio()
  if (!script) return run('cmake', args, cwd)
  return run('cmd', ['/c', `"${script}" >nul && cmake ${args.join(' ')}`], cwd)
}

/**
 * Make the source build on Windows.
 *
 * Upstream is written for Linux: three files reach `std::runtime_error` through
 * a header MSVC does not include for them, one passes a `std::filesystem::path`
 * where a `const char *` is wanted, and one calls the Vulkan backend outside the
 * guard that decides whether it was built. Skipped when it is already applied.
 */
async function patch() {
  if (!WINDOWS || !fs.existsSync(PATCH)) return
  const clean = spawnSync('git', ['apply', '--check', PATCH], { cwd: HOME })
  if (clean.status !== 0) { console.log('\nwindows patch: already applied, or refused — skipping'); return }
  await run('git', ['apply', PATCH], HOME)
}

async function install(model, vulkan) {
  const missing = NEEDED.filter(one => one.required && !found(one.command))
  if (missing.length) throw new Error(`install these first: ${missing.map(one => one.command).join(', ')}`)
  if (WINDOWS && !visualStudio()) {
    throw new Error('no Visual Studio with the C++ tools — install the "Desktop development with C++" workload')
  }

  if (!state().cloned) await run('git', ['clone', '--recurse-submodules', '--depth', '1', REPOSITORY, HOME], CHECKOUT)
  else await run('git', ['submodule', 'update', '--init', '--recursive'], HOME)
  await patch()

  await cmake([
    '-S', HOME, '-B', path.join(HOME, 'build', 'release'), '-G', 'Ninja',
    '-DCMAKE_BUILD_TYPE=Release',
    `-DKIMODO_ENABLE_VULKAN=${vulkan ? 'ON' : 'OFF'}`,
    '-DKIMODO_BUILD_TESTS=OFF'
  ], HOME)
  await cmake(['--build', path.join(HOME, 'build', 'release'), '--target', 'kmd-generate'], HOME)

  // A shell script, so it needs a shell — Git Bash provides one on Windows.
  await run('bash', ['scripts/download_gguf_weights.sh', '--output', HOME, '--model', model], HOME)
}

export async function main(argv = process.argv.slice(2)) {
  const model = argv.includes('--model') ? argv[argv.indexOf('--model') + 1] : DEFAULT_MODEL
  if (argv.includes('--install')) await install(model, argv.includes('--vulkan'))

  const now = state()
  console.log(`\nKIMODO_HOME  ${now.home}`)
  console.log(`repository   ${now.cloned ? 'cloned' : 'missing'}`)
  console.log(`weights      ${now.weights ? 'present' : 'missing'}`)
  console.log(`text bundle  ${now.textBundle ? 'present' : 'missing'}`)
  console.log(`generator    ${now.built || 'not built'}`)
  console.log(`compiler     ${now.compiler || 'none — install Visual Studio with the C++ tools'}`)
  console.log('')
  for (const one of NEEDED) {
    console.log(`${(found(one.command) ? 'yes' : one.required ? 'MISSING' : 'no').padEnd(8)} ${one.command.padEnd(8)} ${one.for}`)
  }

  if (!now.built || !now.weights) {
    console.log(`\nto install:  node tools/install-kimodo.mjs --install --model ${model}`)
    console.log('to use another location, set KIMODO_HOME first')
  } else {
    console.log('\nmake a clip: node tools/make-rig-clip.mjs --prompt "a person walks forward" --name walk')
  }
  return now
}

if (typeof process !== 'undefined' && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exit(1) })
}
