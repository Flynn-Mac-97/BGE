/**
 * Kernel: draw a frame from frame facts, and land it somewhere useful.
 *
 * Two drawings of the same description: `sketchPixels` fills a raw RGBA
 * buffer for node to encode as a PNG, `sketchOnCanvas` uses a 2D canvas,
 * which encodes its own. Both stamp the mark numbers, because the image and
 * the sidecar must agree about what is tagged. `writeFrameFiles` is the node
 * half of getting frames to disk under agent-runs/see/.
 */
import { typeColour, DIGITS } from './frame-facts.js'

/** The browser sketch: the same facts drawn on a 2D canvas, which encodes its own PNG. */
export function sketchOnCanvas(description, options = {}) {
  if (description.error) return description
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(description.viewport.width / 2)
  canvas.height = Math.round(description.viewport.height / 2)
  const pen = canvas.getContext('2d')
  pen.fillStyle = '#202830'
  pen.fillRect(0, 0, canvas.width, canvas.height)
  for (const entry of [...description.visible].sort((a, b) => b.depth - a.depth)) {
    const [r, g, b] = typeColour(entry.type)
    pen.fillStyle = `rgb(${r},${g},${b})`
    const w = Math.max(1, entry.size[0] / 100 * canvas.width)
    const h = Math.max(1, entry.size[1] / 100 * canvas.height)
    pen.fillRect(entry.at[0] / 100 * canvas.width - w / 2, entry.at[1] / 100 * canvas.height - h / 2, w, h)
  }
  if (options.marks !== false) {
    const tag = Math.max(10, Math.round(canvas.height / 32))
    pen.font = `bold ${tag}px system-ui, sans-serif`
    pen.textAlign = 'center'
    pen.textBaseline = 'middle'
    for (const entry of description.visible) {
      if (!entry.mark) continue
      const x = entry.at[0] / 100 * canvas.width
      const y = Math.max(tag, entry.at[1] / 100 * canvas.height - tag)
      const text = String(entry.mark)
      const w = pen.measureText(text).width + tag * 0.6
      pen.fillStyle = 'rgba(0, 0, 0, 0.85)'
      pen.fillRect(x - w / 2, y - tag * 0.6, w, tag * 1.2)
      pen.fillStyle = '#ffffff'
      pen.fillText(text, x, y)
    }
  }
  return { description, dataUrl: canvas.toDataURL('image/png'), canvas }
}

/**
 * Several views of one moment on one sheet, each cell labelled in large text
 * with a gutter between cells — a vision model reads one composed image far
 * more reliably than it relates several, and cells that touch recreate the
 * overlap failures it is worst at. Cells are canvases or images, in order.
 */
export function composeSheet(cells, options = {}) {
  const columns = options.columns || Math.min(cells.length, 2)
  const rows = Math.ceil(cells.length / columns)
  const cellW = Math.max(...cells.map(cell => cell.image.width))
  const cellH = Math.max(...cells.map(cell => cell.image.height))
  const gutter = Math.max(12, Math.round(cellW / 40))
  const labelH = Math.max(24, Math.round(cellH / 10))

  const sheet = document.createElement('canvas')
  sheet.width = columns * cellW + (columns + 1) * gutter
  sheet.height = rows * (cellH + labelH) + (rows + 1) * gutter
  const pen = sheet.getContext('2d')
  pen.fillStyle = '#101216'
  pen.fillRect(0, 0, sheet.width, sheet.height)
  pen.font = `bold ${Math.round(labelH * 0.6)}px system-ui, sans-serif`
  pen.textBaseline = 'middle'

  cells.forEach((cell, index) => {
    const x = gutter + (index % columns) * (cellW + gutter)
    const y = gutter + Math.floor(index / columns) * (cellH + labelH + gutter)
    pen.fillStyle = '#ffffff'
    pen.fillText(cell.label, x + 4, y + labelH / 2)
    pen.drawImage(cell.image, x, y + labelH)
  })
  return sheet
}

/**
 * The browser cannot write, so a frame travels as `__files` — the CLI lands
 * them under the checkout when the call came from a terminal.
 */
export function browserFiles(name, pngBase64, sidecar) {
  return [
    { path: `agent-runs/see/${name}.png`, base64: pngBase64 },
    { path: `agent-runs/see/${name}.json`, base64: btoa(unescape(encodeURIComponent(JSON.stringify(sidecar)))) }
  ]
}

/**
 * In node the frames land on disk right here, so a test or a plugin gets real
 * paths back, not a payload — the `__files` route exists only for the
 * browser, which cannot write and hands its bytes to the CLI instead.
 */
export async function writeFrameFiles(name, png, description) {
  const { mkdir, writeFile } = await import('node:fs/promises')
  const { join, dirname } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const folder = join(dirname(fileURLToPath(import.meta.url)), '../agent-runs/see')
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, `${name}.png`), png)
  await writeFile(join(folder, `${name}.json`), JSON.stringify(description))
  return {
    files: [`agent-runs/see/${name}.png`, `agent-runs/see/${name}.json`],
    marks: Object.fromEntries((description.visible || []).filter(v => v.mark).map(v => [v.mark, v.id]))
  }
}

export function sketchPixels(description, options = {}) {
  if (description.error) return description
  const scale = 4
  const width = Math.round(description.viewport.width / scale)
  const height = Math.round(description.viewport.height / scale)
  const pixels = Buffer.alloc(width * height * 4)
  for (let at = 0; at < pixels.length; at += 4) pixels.set([32, 40, 48, 255], at)

  const paint = (x, y, colour) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    pixels.set(colour, (y * width + x) * 4)
  }

  // Painter's order: far first, so near covers far the way the renderer would.
  for (const entry of [...description.visible].sort((a, b) => b.depth - a.depth)) {
    const colour = typeColour(entry.type)
    const w = Math.max(1, Math.round(entry.size[0] / 100 * width))
    const h = Math.max(1, Math.round(entry.size[1] / 100 * height))
    const left = Math.round(entry.at[0] / 100 * width - w / 2)
    const top = Math.round(entry.at[1] / 100 * height - h / 2)
    for (let y = top; y < top + h; y++) for (let x = left; x < left + w; x++) paint(x, y, colour)
  }

  if (options.marks !== false) {
    for (const entry of description.visible) {
      if (!entry.mark) continue
      const text = String(entry.mark)
      let left = Math.round(entry.at[0] / 100 * width - text.length * 2)
      const top = Math.round(entry.at[1] / 100 * height - 3)
      for (const digit of text) {
        const stamp = DIGITS[+digit]
        for (let y = -1; y < 6; y++) for (let x = -1; x < 4; x++) {
          const on = y >= 0 && y < 5 && x >= 0 && x < 3 && stamp[y * 3 + x] === '1'
          paint(left + x, top + y, on ? [255, 255, 255, 255] : [0, 0, 0, 255])
        }
        left += 4
      }
    }
  }
  return { description, width, height, pixels }
}
