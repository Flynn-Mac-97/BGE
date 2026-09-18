/**
 * Kernel: a plugin's own canvas over the frame, inside the viewport.
 *
 * Two plugins paint 2D over the GL frame — the HUD and a game screen — and each
 * gets its own canvas. Transform Tool rewrites `shell.overlay` wholesale on every
 * redraw, so a container two plugins drew into would lose one of them silently.
 * The canvas goes directly after the GL canvas: over the frame, under the
 * editor's own overlays.
 */

/**
 * The layer belonging to `context[owner]`, made once and reused while attached.
 *
 * `document.contains` rather than a plain cache check, because another plugin can
 * legitimately rebuild the viewport, and a detached canvas measures zero and
 * paints nothing. No document is no drawing, and that is not an error: a headless
 * world builds its items and has nothing to show them on.
 */
export function canvasLayer(context, { owner, className }) {
  if (typeof document === 'undefined') return null
  const holder = context[owner]
  const existing = holder?._layer
  if (existing && document.contains(existing.canvas)) return existing

  const host = context.shell?.viewport
  if (!host) return null

  const canvas = existing?.canvas || document.createElement('canvas')
  canvas.className = className
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none'
  host.prepend(canvas)
  const gl = host.querySelector('#gl')
  if (gl) gl.after(canvas)

  const layer = { canvas, g: canvas.getContext('2d'), last: null }
  holder._layer = layer
  return layer
}
