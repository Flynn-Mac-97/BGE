import js from '@eslint/js'
import globals from 'globals'
import style from './scripts/eslint-style-rules.mjs'

/**
 * The kernel's lint gate: every rule in `agents/code-style.md` a tool can check.
 *
 * Correctness rules are errors everywhere the config covers. The style rules
 * bind `engine/**`, `test/core/**` and the gate's own scripts: the tooling
 * and plugin trees are not shaped to them yet.
 *
 * `state`, `value`, `result`, `item`, `handle`, `config` and `bar` are absent
 * from the deny list on purpose. Each names a real concept here: world state, a
 * projected value, a command result, a ledger item, a file handle, the server
 * config, and a UI bar.
 */

/** Names that say nothing about what they hold. Code style: "Names". */
const NOISE_NAMES = [
  'data',
  'info',
  'foo',
  'baz',
  'obj',
  'thing',
  'stuff',
  'misc',
  'tmp',
  'temp',
  'helper',
  'utils',
  'ctx',
  'manager'
]

/**
 * The only names shorter than three letters: coordinates, an id, the UI, and
 * Node's own module names.
 */
const SHORT_NAMES = ['x', 'y', 'z', 'id', 'ui', 'fs', 'os']

/** Shapes the code style bans, each with the rule it breaks. */
const BANNED_SHAPES = [
  { selector: 'SwitchStatement', message: 'Use a lookup table, not a switch. Code style: "Branching".' },
  {
    selector: 'IfStatement[alternate.type="IfStatement"][alternate.alternate.type="IfStatement"]',
    message: 'Use a lookup table, not an else-if ladder. Code style: "Branching".'
  },
  {
    selector: ':function > AssignmentPattern[right.type="Literal"][right.raw=/^(true|false)$/]',
    message: 'Write two named functions, not a true/false flag parameter. Code style: "Functions".'
  }
]

/**
 * A call that adds to or fires the event bus. Code style bans observers; the
 * bus is the plugin channel, which the plugin rewrite replaces.
 */
const BUS_CALL = {
  selector:
    'CallExpression[callee.property.name=/^(on|once|off|emit)$/]:matches([callee.object.name="bus"], [callee.object.property.name="bus"])',
  message: 'No observers. Code style: "Architecture".'
}

/** Files that use the event bus today. The list only shrinks. */
const BUS_FILES = [
  'engine/checkpoint.js',
  'engine/files.js',
  'engine/index.js',
  'engine/inspect.js',
  'engine/loader.js',
  'engine/log.js',
  'engine/plugin-runtime.js',
  'engine/plugin-startup.js',
  'engine/reload-notice-writer.js',
  'engine/reload-projection.js',
  'engine/render.js',
  'engine/rewind.js',
  'engine/shell-shortcuts.js',
  'engine/shell.js',
  'engine/world-context.js',
  'engine/world-editor.js',
  'engine/world-project.js',
  'engine/world.js',
  'test/core/boot/bus-events.test.mjs',
  'test/core/plugin/plugin-contracts.test.mjs',
  'test/core/render/device-loss.test.mjs',
  'test/core/ui/reload-notice.test.mjs'
]

/** The shape limits the kernel keeps to. Code style: "Functions". */
const CLARITY_RULES = {
  complexity: ['error', 20],
  'max-depth': ['error', 4],
  'max-params': ['error', 6],
  'max-lines-per-function': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
  'max-lines': ['error', { max: 800, skipBlankLines: true, skipComments: true }],
  'no-else-return': 'error',
  'no-unused-vars': ['error', { ignoreRestSiblings: true }],
  'consistent-return': 'error',
  'no-shadow': 'error',
  'no-param-reassign': 'error',
  'prefer-const': 'error',
  'no-var': 'error',
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  'no-nested-ternary': 'error',
  'id-denylist': ['error', ...NOISE_NAMES],
  'id-length': ['error', { min: 3, exceptions: SHORT_NAMES, properties: 'never' }],
  'style/export-contract': 'error',
  'style/literal-comment': 'error'
}

/** The files the style rules bind. The gate's scripts are held to the rules they enforce. */
const KERNEL_FILES = [
  'engine/**/*.js',
  'engine/**/*.mjs',
  'test/core/**/*.mjs',
  'scripts/kernel-gate.mjs',
  'scripts/check-codemap.mjs',
  'scripts/check-structure.mjs',
  'scripts/eslint-style-rules.mjs',
  'scripts/test-areas.mjs',
  'scripts/test-mutants.mjs',
  'scripts/project-gate.mjs'
]

/**
 * The style rules as one config block over `files`. The kernel uses it below,
 * and `scripts/project-gate.mjs` uses it over a game's own code.
 */
export const styleConfig = files => ({
  files,
  languageOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    globals: { ...globals.browser, ...globals.node }
  },
  plugins: { style },
  rules: { ...CLARITY_RULES, 'no-restricted-syntax': ['error', ...BANNED_SHAPES, BUS_CALL] }
})

export default [
  js.configs.recommended,
  {
    files: ['eslint.config.mjs', 'prettier.config.mjs', 'scripts/**/*.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.node }
  },
  styleConfig(KERNEL_FILES),
  {
    files: BUS_FILES,
    rules: { 'no-restricted-syntax': ['error', ...BANNED_SHAPES] }
  }
]
