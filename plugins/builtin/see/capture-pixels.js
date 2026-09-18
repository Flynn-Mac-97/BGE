import { convexHull } from '../../../engine/frame-facts.js'

export function studioBounds(raw, canvas) {
  // GPU rows start at the bottom; bounds and spans use image coordinates.
  let left = canvas.width, right = 0, top = canvas.height, bottom = 0
  const spans = new Map()
  for (let y = 0; y < canvas.height; y++) {
    const row = (canvas.height - 1 - y) * canvas.width
    let first = -1, last = -1
    for (let x = 0; x < canvas.width; x++) {
      if (raw[(row + x) * 4 + 3] < 8) continue
      if (first < 0) first = x
      last = x
    }
    if (first < 0) continue
    spans.set(y, [first, last])
    if (first < left) left = first
    if (last > right) right = last
    if (y < top) top = y
    bottom = y
  }
  return { left, right, top, bottom, spans }
}

export function studioSilhouette(spans, crop) {
  const points = []
  for (const [y, [first, last]] of spans) {
    for (const x of [first, last + 1]) {
      points.push([(x - crop.x) / crop.w * 100, (y - crop.y) / crop.h * 100])
      points.push([(x - crop.x) / crop.w * 100, (y + 1 - crop.y) / crop.h * 100])
    }
  }
  const traced = convexHull(points)
  return traced.length >= 3 ? traced.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]) : null
}

export function cropPixels(raw, canvas, crop, image) {
  for (let y = 0; y < crop.h; y++) {
    const from = ((canvas.height - 1 - (crop.y + y)) * canvas.width + crop.x) * 4
    image.data.set(raw.subarray(from, from + crop.w * 4), y * crop.w * 4)
  }
}

export function encodeColours(image) {
  // Readback is linear, while delivered PNG colours must be sRGB.
  const bits = image.data
  for (let at = 0; at < bits.length; at += 4) {
    for (let channel = 0; channel < 3; channel++) {
      const linear = bits[at + channel] / 255
      bits[at + channel] = Math.round(255 * (linear <= 0.0031308
        ? linear * 12.92
        : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055))
    }
  }
}

export function measureLight(pixels, width, height) {
  // Transparent samples are absent, not dark. Keep empty grid cells null.
  const cells = []
  let litSum = 0, litSeen = 0, looked = 0
  const cellW = Math.floor(width / 4), cellH = Math.floor(height / 4)
  for (let gy = 0; gy < 4; gy++) for (let gx = 0; gx < 4; gx++) {
    let sum = 0, seen = 0
    for (let y = gy * cellH; y < (gy + 1) * cellH; y += 8) {
      for (let x = gx * cellW; x < (gx + 1) * cellW; x += 8) {
        const at = (y * width + x) * 4
        looked++
        if (pixels[at + 3] < 8) continue
        sum += 0.2126 * pixels[at] + 0.7152 * pixels[at + 1] + 0.0722 * pixels[at + 2]
        seen++
      }
    }
    litSum += sum
    litSeen += seen
    cells.push(seen ? Math.round(sum / seen / 2.55) : null)
  }
  const drawnCells = cells.filter(cell => cell !== null)
  return {
    mean: litSeen ? Math.round(litSum / litSeen / 2.55) : 0,
    darkestCell: drawnCells.length ? Math.min(...drawnCells) : null,
    brightestCell: drawnCells.length ? Math.max(...drawnCells) : null,
    grid: cells,
    over: litSeen === looked
      ? 'every pixel of the frame'
      : 'the pixels the draw put down — a transparent background is not darkness',
    measuredFraction: Math.round(litSeen / Math.max(1, looked) * 100) / 100
  }
}

export function hasPixels(pixels) {
  let anything = false
  const stride = Math.max(4, Math.floor(pixels.length / 4 / 400) * 4)
  for (let at = 3; at < pixels.length; at += stride) {
    if (pixels[at] > 0) { anything = true; break }
  }
  return anything
}
