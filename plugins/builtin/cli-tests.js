/**
 * CLI Tests — make the engine's own CLI test suite inspectable.
 *
 * The suite lives in test/cli.bridge.mjs and runs outside the browser (it spawns
 * the real CLI), so this plugin contributes no runner — it makes the suite
 * visible in the plugin surface and answers how to run it.
 */
const info = () => ({
  suite: 'test/cli.bridge.mjs',
  run: 'node test/cli.bridge.mjs',
  full: 'npm test',
  offline: 'node --test test/cli.offline.test.mjs && node --test test/agent-workspace.test.mjs',
  needs: ['a dev server', 'one open editor tab', 'the editor on level1 (the demo level)'],
  covers: ['argument coercion', 'exit codes', 'command fallback', 'determinism', 'bridge failure modes'],
  note: 'the bridge suite needs the editor; the offline suite runs with nothing — exit codes, coercion, the lint, and the pain lifecycle'
})

export default {
  name: 'CLI Tests',
  category: 'agents',
  about: 'Inspect the engine\'s own CLI test suites — the bridge suite and the offline door suite.',
  inspect: () => [
    { title: 'How to run', rows: [['bridge', 'node test/cli.bridge.mjs'], ['offline', 'node --test test/cli.offline.test.mjs'], ['full', 'npm test']] },
    { title: 'Needs', rows: info().needs.map(n => [n, '']) }
  ],
  commands: [{
    id: 'tests.cli',
    label: 'Inspect the CLI test suite',
    run: () => info()
  }]
}
