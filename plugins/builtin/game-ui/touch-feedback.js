/** Presentation-only gesture feedback follows pointer events without waiting for a fixed step. */
export function drawTouchFeedback(control, snapshot) {
  const target = control.querySelector('[data-touch-object]')
  if (!target) return
  const mode = control.dataset.touchFeedback
  const transform = snapshot.transform
  const last = snapshot.last
  let x = 0
  let y = 0
  let scale = 1
  let rotation = 0
  if (mode === 'pinch' || mode === 'transform') scale = Math.max(0.1, Math.min(8, transform.scale))
  if (mode === 'rotate' || mode === 'transform') rotation = transform.rotation
  if (mode === 'pan' || mode === 'transform') { x = transform.x; y = transform.y }
  if (mode === 'drag' && ['dragstart', 'drag', 'dragend', 'swipe'].includes(last.type)) { x = last.x; y = last.y }
  target.style.transform = `translate3d(${x}px,${y}px,0) rotate(${rotation}deg) scale(${scale})`
}
