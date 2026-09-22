import { nativeImage } from 'electron'

export async function captureEditor(window, views, active, options = {}) {
  const { scope = 'editor', client = active, name = 'editor' } = options
  if (!['editor', 'window'].includes(scope)) throw new Error('scope must be editor or window')
  if (typeof name !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('name must contain only letters, numbers, underscores or hyphens')
  if (!window || window.isDestroyed() || window.isMinimized()) throw new Error('Restore the engine window before capturing it')
  const item = views.get(client)
  if (!item || client !== active) throw new Error('Capture requires the active engine view; activate the requested view first')
  const windowSize = window.getContentSize()
  const bounds = item.view.getBounds()
  let picture = await item.view.webContents.capturePage()
  if (picture.isEmpty()) throw new Error('The editor returned an empty capture')
  picture = picture.resize({ width: bounds.width, height: bounds.height })
  if (scope === 'window') {
    const [width, height] = window.getContentSize()
    const shell = await window.webContents.capturePage()
    if (shell.isEmpty()) throw new Error('The desktop returned an empty capture')
    const pixels = shell.resize({ width, height }).toBitmap({ scaleFactor: 1 })
    const editor = picture.toBitmap({ scaleFactor: 1 })
    // WebContentsView is a separate surface; the shell capture omits its pixels.
    for (let row = 0; row < bounds.height; row++) {
      editor.copy(pixels, ((bounds.y + row) * width + bounds.x) * 4, row * bounds.width * 4, (row + 1) * bounds.width * 4)
    }
    picture = nativeImage.createFromBitmap(pixels, { width, height, scaleFactor: 1 })
  }
  if (JSON.stringify(bounds) !== JSON.stringify(item.view.getBounds()) || JSON.stringify(windowSize) !== JSON.stringify(window.getContentSize())) {
    throw new Error('The window layout changed during capture; try again')
  }
  const { width, height } = picture.getSize()
  const description = { scope, client, size: [width, height], method: 'electron.capturePage', includes: scope === 'window' ? ['editor', 'tabs', 'console'] : ['editor'] }
  return {
    ...description,
    __files: [
      { path: 'agent-runs/see/' + name + '.png', base64: picture.toPNG().toString('base64') },
      { path: 'agent-runs/see/' + name + '.json', base64: Buffer.from(JSON.stringify(description)).toString('base64') }
    ]
  }
}
