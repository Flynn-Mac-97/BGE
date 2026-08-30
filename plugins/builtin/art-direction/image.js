/**
 * Pixels in and out, for Art Direction.
 *
 * A reference is a file somebody downloaded and a game frame is a file See
 * wrote, and both have to reach the same measuring code or the numbers are not
 * comparable. That is the whole job of this file.
 *
 * Two ways in, because the two runtimes can do different things:
 *
 *   browser  fetch the bytes and let the platform decode them. PNG, JPEG,
 *            WebP, anything the tab can draw.
 *   node     read the bytes and decode PNG here. There is no JPEG decoder
 *            in this project and writing one is not worth it — save a
 *            reference as PNG, or measure it with a tab open.
 *
 * Every reply names which path answered, so a number is never mistaken for one
 * measured a different way.
 */

/** How many pixels a measurement reads at most. Above this it samples on a stride. */
const SAMPLE_BUDGET = 200000

/** An image, however it was decoded: RGBA bytes and the size they describe. */
const asImage = (width, height, data, how) => ({ width, height, data, how })

// ------------------------------------------------------------------ reading

/**
 * Read an image from a path relative to the checkout root.
 *
 * `<project>/art/references/x.png` and `agent-runs/see/y.png` are both valid,
 * because a reference and a frame are the same kind of thing here.
 */
export async function readImage(path) {
  if (typeof document !== 'undefined') return readInBrowser(path)
  return readInNode(path)
}

async function readInBrowser(path) {
  const response = await fetch('/' + String(path).replace(/^\/+/, ''))
  if (!response.ok) throw new Error(`cannot read ${path} — ${response.status} ${response.statusText}`)
  const bitmap = await createImageBitmap(await response.blob())
  // Read before closing: close() sets the bitmap's width and height to zero,
  // and a zero-sized image measures as no pixels rather than as an error.
  const { width, height } = bitmap
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const pen = canvas.getContext('2d', { willReadFrequently: true })
  pen.drawImage(bitmap, 0, 0)
  const pixels = pen.getImageData(0, 0, width, height)
  bitmap.close?.()
  return asImage(width, height, pixels.data, 'browser canvas')
}

async function readInNode(path) {
  const { readFile } = await import('node:fs/promises')
  const { join, dirname } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')
  const bytes = await readFile(join(root, path))
  if (!/\.png$/i.test(path)) {
    throw new Error(`${path} is not a PNG, and headless node decodes PNG only. `
      + 'Convert it, or run this with an editor tab open so the browser decodes it.')
  }
  return decodePng(bytes)
}

// ------------------------------------------------------------- PNG decoding

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

/** Split a PNG into its chunks. Nothing here validates the CRC; a corrupt file fails later. */
function chunksOf(bytes) {
  const chunks = []
  let at = 8
  while (at + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(at)
    const type = bytes.toString('ascii', at + 4, at + 8)
    chunks.push({ type, data: bytes.subarray(at + 8, at + 8 + length) })
    at += 12 + length
  }
  return chunks
}

export async function decodePng(bytes) {
  if (bytes.length < 8 || bytes.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')
  const chunks = chunksOf(bytes)
  const header = chunks.find(chunk => chunk.type === 'IHDR')
  if (!header) throw new Error('PNG has no IHDR')

  const width = header.data.readUInt32BE(0)
  const height = header.data.readUInt32BE(4)
  const depth = header.data[8]
  const colourType = header.data[9]
  const interlace = header.data[12]

  // Named one by one, because "unsupported PNG" sends the reader to a hex dump.
  if (depth !== 8) throw new Error(`PNG bit depth ${depth} — this decoder reads 8 only`)
  if (interlace !== 0) throw new Error('interlaced PNG — this decoder reads non-interlaced only')
  const channels = CHANNELS[colourType]
  if (!channels) throw new Error(`PNG colour type ${colourType} — this decoder does not read it`)

  const { inflateSync } = await import('node:zlib')
  const compressed = Buffer.concat(chunks.filter(chunk => chunk.type === 'IDAT').map(chunk => chunk.data))
  const raw = inflateSync(compressed)
  const palette = chunks.find(chunk => chunk.type === 'PLTE')?.data
  if (colourType === 3 && !palette) throw new Error('indexed PNG with no palette')

  return asImage(width, height,
    toRGBA(unfilter(raw, width, height, channels), width, height, colourType, channels, palette),
    'node PNG decoder')
}

/**
 * Undo the per-scanline filter each row declares in its first byte.
 *
 * The filters predict a byte from the ones left, above and up-left of it, so
 * every row has to be reconstructed before the next can be.
 */
function unfilter(raw, width, height, channels) {
  const stride = width * channels
  const out = Buffer.alloc(stride * height)
  for (let row = 0; row < height; row++) {
    const filter = raw[row * (stride + 1)]
    const source = row * (stride + 1) + 1
    const target = row * stride
    const above = target - stride
    for (let at = 0; at < stride; at++) {
      const byte = raw[source + at]
      const left = at >= channels ? out[target + at - channels] : 0
      const up = row > 0 ? out[above + at] : 0
      const upLeft = row > 0 && at >= channels ? out[above + at - channels] : 0
      let value = byte
      if (filter === 1) value = byte + left
      else if (filter === 2) value = byte + up
      else if (filter === 3) value = byte + ((left + up) >> 1)
      else if (filter === 4) value = byte + paeth(left, up, upLeft)
      out[target + at] = value & 255
    }
  }
  return out
}

/** The PNG spec's predictor: whichever neighbour the gradient is nearest. */
function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft
  const toLeft = Math.abs(estimate - left)
  const toUp = Math.abs(estimate - up)
  const toUpLeft = Math.abs(estimate - upLeft)
  if (toLeft <= toUp && toLeft <= toUpLeft) return left
  return toUp <= toUpLeft ? up : upLeft
}

function toRGBA(rows, width, height, colourType, channels, palette) {
  const out = new Uint8ClampedArray(width * height * 4)
  for (let pixel = 0; pixel < width * height; pixel++) {
    const from = pixel * channels
    const to = pixel * 4
    if (colourType === 0) out.set([rows[from], rows[from], rows[from], 255], to)
    else if (colourType === 4) out.set([rows[from], rows[from], rows[from], rows[from + 1]], to)
    else if (colourType === 2) out.set([rows[from], rows[from + 1], rows[from + 2], 255], to)
    else if (colourType === 6) out.set([rows[from], rows[from + 1], rows[from + 2], rows[from + 3]], to)
    else {
      const entry = rows[from] * 3
      out.set([palette[entry], palette[entry + 1], palette[entry + 2], 255], to)
    }
  }
  return out
}

// ------------------------------------------------------------------ walking

/**
 * Visit up to SAMPLE_BUDGET opaque pixels, as (red, green, blue) 0 to 1.
 *
 * A reference photograph can be eight megapixels and the statistics do not
 * improve past a couple of hundred thousand samples, so a big image is read on
 * a stride rather than in full. Transparent pixels are skipped: a studio frame
 * of one model on a transparent background is mostly nothing, and counting
 * nothing as black would report every model as dark.
 */
export function eachPixel(image, visit) {
  const total = image.width * image.height
  const stride = Math.max(1, Math.floor(total / SAMPLE_BUDGET))
  let counted = 0
  for (let pixel = 0; pixel < total; pixel += stride) {
    const at = pixel * 4
    if (image.data[at + 3] < 128) continue
    visit(image.data[at] / 255, image.data[at + 1] / 255, image.data[at + 2] / 255, pixel)
    counted++
  }
  return counted
}

/** Luminance of two pixels compared, for the edge count. Neighbours, not samples. */
export function neighbourStep(image, pixel) {
  const width = image.width
  const x = pixel % width
  if (x + 1 >= width) return null
  const here = image.data
  const at = pixel * 4
  const right = at + 4
  if (here[at + 3] < 128 || here[right + 3] < 128) return null
  const grey = offset => (0.2126 * here[offset] + 0.7152 * here[offset + 1] + 0.0722 * here[offset + 2]) / 255
  return Math.abs(grey(at) - grey(right))
}

// ------------------------------------------------------------------ writing

/**
 * Two images side by side at one height, left first.
 *
 * The comparison is the point, so neither side is scaled to flatter the other:
 * both are drawn at the same height and the wider one takes more width. Which
 * side is which is named in the reply and never drawn on the sheet — text would
 * need a font raster here, and a caption on a frame is one more thing a vision
 * model reads instead of the picture.
 */
export function composePair(left, right, gutter = 24) {
  const height = Math.max(left.image.height, right.image.height)
  const widthOf = cell => Math.round(cell.image.width * (height / cell.image.height))
  const widths = [widthOf(left), widthOf(right)]
  const sheet = { width: widths[0] + widths[1] + gutter * 3, height: height + gutter * 2, data: null }
  sheet.data = new Uint8ClampedArray(sheet.width * sheet.height * 4)
  for (let at = 0; at < sheet.data.length; at += 4) sheet.data.set([16, 18, 22, 255], at)

  let x = gutter
  for (const [index, cell] of [left, right].entries()) {
    drawScaled(sheet, cell.image, x, gutter, widths[index], height)
    x += widths[index] + gutter
  }
  return sheet
}

/** Nearest-neighbour, because a comparison sheet must not invent pixels neither side has. */
function drawScaled(sheet, image, atX, atY, width, height) {
  for (let y = 0; y < height; y++) {
    const sourceY = Math.min(image.height - 1, Math.floor(y * image.height / height))
    for (let x = 0; x < width; x++) {
      const sourceX = Math.min(image.width - 1, Math.floor(x * image.width / width))
      const from = (sourceY * image.width + sourceX) * 4
      const to = ((atY + y) * sheet.width + atX + x) * 4
      if (to + 3 >= sheet.data.length) continue
      const alpha = image.data[from + 3] / 255
      for (let channel = 0; channel < 3; channel++) {
        sheet.data[to + channel] = Math.round(sheet.data[to + channel] * (1 - alpha) + image.data[from + channel] * alpha)
      }
      sheet.data[to + 3] = 255
    }
  }
}

/**
 * Write a PNG under agent-runs/art/, in whichever runtime is asking.
 *
 * The browser encodes through a canvas, because `encodePng` is node code —
 * Buffer and zlib. It hands the bytes back as a `__files` reply for the CLI to
 * write, the same route See's captures take.
 */
export async function writeImage(name, image) {
  const path = `agent-runs/art/${name}.png`
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    canvas.getContext('2d').putImageData(
      new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0)
    return { __files: [{ path, base64: canvas.toDataURL('image/png').split(',')[1] }], file: path }
  }
  const { encodePng } = await import(/* @vite-ignore */ '../../../tools/lib/texture.mjs')
  const png = encodePng(image.width, image.height, Buffer.from(image.data.buffer || image.data))
  const { mkdir, writeFile } = await import('node:fs/promises')
  const { join, dirname } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')
  await mkdir(join(root, 'agent-runs/art'), { recursive: true })
  await writeFile(join(root, path), png)
  return { file: path }
}
