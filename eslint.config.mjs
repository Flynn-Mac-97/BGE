import js from '@eslint/js'
import globals from 'globals'

/**
 * The kernel's lint gate.
 *
 * Correctness rules are errors everywhere the config covers. The clarity rules
 * bind `engine/**` and `test/core/**` only: the tooling and plugin trees are
 * not shaped to them, and the gate exists to hold the kernel to the engine's
 * own style.
 *
 * `state`, `value`, `result`, `item`, `handle`, `config` and `bar` are absent
 * from the deny list on purpose. Each names a real concept here: world state, a
 * projected value, a command result, a ledger item, a file handle, the server
 * config, and a UI bar.
 */

/** Names that say nothing about what they hold. See `agents/code-style.md`. */
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

/** The shape limits the kernel keeps to. Non-slop, "Functions". */
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
  'id-denylist': ['error', ...NOISE_NAMES]
}

export default [
  js.configs.recommended,
  {
    files: ['eslint.config.mjs', 'prettier.config.mjs', 'scripts/**/*.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.node }
  },
  {
    files: ['engine/**/*.js', 'engine/**/*.mjs', 'test/core/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node }
    },
    rules: CLARITY_RULES
  }
]
