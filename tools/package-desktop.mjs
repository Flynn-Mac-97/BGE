/** Package the built desktop for Windows. */
import { packager } from '@electron/packager'
import path from 'node:path'
import fs from 'node:fs/promises'

const destination = path.resolve('release')
const results = await packager({
  dir: process.cwd(), out: destination, name: 'Engine', executableName: 'Engine',
  platform: 'win32', arch: 'x64', overwrite: true, asar: false,
  tmpdir: path.resolve('.engine/package-tmp'),
  download: { cacheRoot: path.resolve('.engine/electron-cache') },
  ignore: [/^\/\.(?!claude(?:\/|$))/, /^\/(?:agent-runs|archive|release|test|project)(?:\/|$)/, /\/node_modules\/\.vite(?:\/|$)/],
  prune: true
})
for (const directory of results) {
  await fs.writeFile(path.join(directory, 'README.txt'), 'Double-click Engine.exe. Choose a project, then open a shell or an installed agent in the console.\r\n')
  console.log(path.join(directory, 'Engine.exe'))
}
