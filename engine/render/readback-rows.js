/**
 * Readback row order. `drawInto` promises bottom-up rows and a region measured
 * from the bottom left, as WebGL reads back. WebGPU reads back top-down from
 * the top left, so on that backend the region is turned over before the read
 * and the rows after it. Without this a picture read on WebGPU is upside down.
 */

/** A bottom-left region as the backend reads it: the same, or measured from the top when rows come back top-down. */
export const regionAsRead = (region, targetHeight, isTopDown) =>
  isTopDown ? { ...region, y: targetHeight - region.y - region.height } : region

/** RGBA rows of `width` × `height` put bottom-up; the same bytes when they already are. */
export function bottomUpRows(pixels, width, height, isTopDown) {
  if (!isTopDown) return pixels
  const rowBytes = width * 4
  const turned = new Uint8Array(rowBytes * height)
  for (let row = 0; row < height; row++) {
    turned.set(pixels.subarray(row * rowBytes, (row + 1) * rowBytes), (height - 1 - row) * rowBytes)
  }
  return turned
}
