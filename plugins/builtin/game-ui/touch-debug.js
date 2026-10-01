/** Optional SVG feedback for gesture areas: real contact trails, endpoints and transform values. */
export function drawTouchDebug(control, snapshot) {
  const svg = control.querySelector('[data-touch-debug]')
  if (!svg) return
  const rect = control.getBoundingClientRect()
  const width = Math.max(1, rect.width)
  const height = Math.max(1, rect.height)
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
  const records = [...snapshot.trails, ...snapshot.contacts]
  const shapes = records.map((record, index) => {
    const colour = index % 2 ? '#a991ff' : '#61e6bd'
    const points = record.trail.map(point => `${(point.x - rect.left).toFixed(1)},${(point.y - rect.top).toFixed(1)}`).join(' ')
    const first = record.trail[0]
    const x = record.point.x - rect.left
    const y = record.point.y - rect.top
    return `<polyline points="${points}" fill="none" stroke="${colour}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${first.x - rect.left}" cy="${first.y - rect.top}" r="6" fill="none" stroke="${colour}" stroke-width="2"/><circle cx="${x}" cy="${y}" r="18" fill="${colour}" fill-opacity=".14" stroke="${colour}" stroke-width="2"/><circle cx="${x}" cy="${y}" r="4" fill="${colour}"/>`
  }).join('')
  const last = snapshot.last
  const names = { ready: 'TOUCH TO BEGIN', tap: 'TAP', doubletap: 'DOUBLE TAP', longpress: 'LONG PRESS', dragstart: 'DRAG', drag: 'DRAG', dragend: 'DRAG END', swipe: 'SWIPE', transformstart: 'TWO FINGERS', transform: 'PINCH · ROTATE · PAN', transformend: 'TRANSFORM END', cancel: 'CANCELLED' }
  const direction = { left: '←', right: '→', up: '↑', down: '↓' }[last.direction] || ''
  let details = `${names[last.type] || ''} ${direction}`
  if (last.type === 'swipe') details += ` · ${Math.round(last.distance)} px · ${Math.round(last.duration)} ms`
  if (last.type.startsWith('transform')) details += ` · ${snapshot.transform.scale.toFixed(2)}× · ${Math.round(snapshot.transform.rotation)}°`
  svg.innerHTML = shapes + `<text x="18" y="${height - 20}" fill="#dbe7ee" font-size="12" font-family="ui-monospace,monospace">${details}</text>`
}
