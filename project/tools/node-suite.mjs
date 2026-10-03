/** Run the same Node assertions through node --test and the engine's headless test command. */
import nodeTest from 'node:test'

export function defineSuite(name) {
  const cases = []
  return {
    test(name, run) {
      cases.push({ name, run })
      if (process.env.NODE_TEST_CONTEXT) nodeTest(name, run)
    },
    suite: { name, level: 'main', async run(test) {
      for (const entry of cases) {
        try { await entry.run(); test.ok(true, entry.name) }
        catch (error) { test.ok(false, `${entry.name}: ${error.message}`) }
      }
    } }
  }
}
