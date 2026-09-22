/** Bundle the trusted desktop console. */
import { build } from 'esbuild'

await build({
  entryPoints: ['electron/console.js'], bundle: true, platform: 'browser',
  target: 'chrome140', outfile: 'electron/console.bundle.js', logLevel: 'info'
})
