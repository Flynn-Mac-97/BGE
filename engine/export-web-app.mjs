/** Add an opt-in installable web app and a versioned offline cache to a completed game export. */
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'

/** Write the manifest, registration and worker when game.web.installable is enabled. */
export async function writeWebApp(out, game) {
  if (!game.web?.installable) return
  const manifest = {
    id: './',
    name: game.title || 'BGE Game',
    short_name: game.web.shortName || game.title || 'BGE Game',
    start_url: './',
    scope: './',
    display: 'standalone',
    background_color: '#102034',
    theme_color: '#102034',
    icons: []
  }
  const icon = game.web.icon
  if (icon) {
    if (!/^assets\/[\w/.-]+\.png$/.test(icon) || icon.split('/').includes('..')) {
      throw new Error('web.icon must name a PNG under the project assets directory')
    }
    await fs.access(path.join(out, 'project', icon))
    manifest.icons.push({ src: `./project/${icon}`, sizes: '512x512', type: 'image/png', purpose: 'any' })
  }
  await fs.writeFile(path.join(out, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2))
  const page = path.join(out, 'index.html')
  const links =
    '<link rel="manifest" href="./manifest.webmanifest">\n<meta name="theme-color" content="#102034">' +
    (icon ? `\n<link rel="apple-touch-icon" href="./project/${icon}">` : '')
  const register =
    '<script>if ("serviceWorker" in navigator && window.isSecureContext) { navigator.serviceWorker.register("./sw.js").catch(console.error) }</script>'
  const html = await fs.readFile(page, 'utf8')
  await fs.writeFile(page, html.replace('</head>', `${links}\n</head>`).replace('</body>', `${register}\n</body>`))
  const entries = await fs.readdir(out, { recursive: true, withFileTypes: true })
  const files = entries
    .filter(entry => entry.isFile() && entry.name !== 'sw.js' && !entry.name.startsWith('.'))
    .map(entry => path.relative(out, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
    .sort()
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(file)
    hash.update(await fs.readFile(path.join(out, file)))
  }
  const version = hash.digest('hex').slice(0, 16)
  await fs.writeFile(path.join(out, 'sw.js'), workerSource(files, version))
}

/** A worker owns only its scope's cache; an update waits until the old app closes. */
function workerSource(files, version) {
  return `const prefix = 'bge:' + self.registration.scope + ':';
const cacheName = prefix + ${JSON.stringify(version)};
const files = ${JSON.stringify(files)}.map(file => new URL(file.split('/').map(encodeURIComponent).join('/'), self.registration.scope).href);
self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(files)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(names => Promise.all(names.filter(name => name.startsWith(prefix) && name !== cacheName).map(name => caches.delete(name)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.registration.scope)) return;
  event.respondWith(caches.open(cacheName).then(async cache => {
    const cached = await cache.match(event.request, { ignoreSearch: true });
    if (cached) return cached;
    if (event.request.mode === 'navigate') return (await cache.match(new URL('index.html', self.registration.scope))) || fetch(event.request);
    return fetch(event.request);
  }));
});
`
}
