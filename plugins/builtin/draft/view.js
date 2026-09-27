/**
 * Draft view — the canvas and its pointer handling.
 *
 * Kept apart from the plugin so the model and the commands hold no DOM and a
 * headless test runs them. Nothing here is saved: it mutates the document the
 * caller owns and calls `commit`, which writes through the document store.
 */
import { assetURL } from '../../../engine/asset-path.js'
import {
  addEdge, fitBoard, nodeBox, removeEdge, removeNode, wrapText,
  DEFAULT_WIDTH, FONT_SIZE, LINE_HEIGHT, PADDING
} from './model.js'
import { clamp } from '../game-maths/vectors.js'

const BACKDROP = '#101014'
const GRID = '#23232c'
const PANEL = '#262633'
const RULE = '#4a4a5c'
const INK = '#f2f2f8'
const DIM = '#a0a0b0'
const SELECT = '#5cc8ff'
const EDGE = '#7a7a90'
const GROUP_FILL = 'rgba(255,255,255,0.06)'

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif'
const font = (size, weight = '') => `${weight} ${size}px ${FONT}`

export function mountStage({ stage, canvas, state, actions }) {
  const pen = canvas.getContext('2d')
  const images = new Map()

  const measure = (text, size = 13) => {
    pen.font = font(size)
    return pen.measureText(String(text ?? '')).width
  }

  // ---------------------------------------------------------------- painting
  function paint() {
    const doc = state.doc
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (!doc || !width || !height) return
    const ratio = window.devicePixelRatio || 1
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
    }
    pen.setTransform(ratio, 0, 0, ratio, 0, 0)
    pen.fillStyle = BACKDROP
    pen.fillRect(0, 0, width, height)
    drawGrid(width, height)

    const view = state.view
    pen.save()
    pen.translate(view.x, view.y)
    pen.scale(view.zoom, view.zoom)
    const boxes = new Map(doc.nodes.map((node) => [node.id, nodeBox(node, measure)]))
    for (const node of doc.nodes) if (node.kind === 'group') drawNode(node, boxes.get(node.id))
    for (const edge of doc.edges) drawEdge(edge, boxes, state.selected === `e:${edge.id}`)
    for (const node of doc.nodes) if (node.kind !== 'group') drawNode(node, boxes.get(node.id))
    if (state.connecting && boxes.get(state.connecting.from)) drawConnecting(boxes.get(state.connecting.from))
    pen.restore()
    if (!doc.nodes.length) {
      pen.fillStyle = DIM
      pen.font = font(13)
      pen.textAlign = 'center'
      pen.fillText('empty board — add a Text, Note, Image or Group, then drag from a box edge to draw an arrow',
        width / 2, height / 2)
      pen.textAlign = 'left'
    }
  }

  function drawGrid(width, height) {
    const step = 26 * state.view.zoom
    if (step < 7) return
    pen.fillStyle = GRID
    const startX = ((state.view.x % step) + step) % step
    const startY = ((state.view.y % step) + step) % step
    for (let x = startX; x < width; x += step) {
      for (let y = startY; y < height; y += step) pen.fillRect(x, y, 1, 1)
    }
  }

  function roundRect(box, radius) {
    pen.beginPath()
    pen.roundRect(box.x, box.y, box.w, box.h, radius)
  }

  function drawNode(node, box) {
    if (!box) return
    const selected = state.selected === `n:${node.id}`
    pen.save()
    if (node.kind === 'group') {
      roundRect(box, 12)
      pen.fillStyle = node.colour || GROUP_FILL
      pen.fill()
      pen.setLineDash([6, 5])
      pen.lineWidth = selected ? 2 : 1
      pen.strokeStyle = selected ? SELECT : RULE
      pen.stroke()
      pen.setLineDash([])
      pen.fillStyle = DIM
      pen.font = font(11, '600')
      pen.fillText(node.text || 'group', box.x + PADDING, box.y + PADDING + 8, box.w - PADDING * 2)
      pen.restore()
      return
    }
    roundRect(box, 8)
    pen.fillStyle = node.colour || PANEL
    pen.fill()
    pen.lineWidth = selected ? 2 : 1
    pen.strokeStyle = selected ? SELECT : RULE
    pen.stroke()

    if (node.kind === 'image') {
      const entry = imageFor(node)
      if (entry?.ready) drawCover(entry.image, box)
      else placeholder(entry?.failed ? `missing: ${node.text}` : node.text || 'image — set a path', box)
    } else {
      pen.fillStyle = INK
      const size = FONT_SIZE[node.kind]
      pen.font = font(size)
      const lines = wrapText(node.text, box.w - PADDING * 2, measure, size)
      lines.forEach((line, index) => {
        pen.fillText(line, box.x + PADDING, box.y + PADDING + LINE_HEIGHT[node.kind] * (index + 0.8), box.w - PADDING * 2)
      })
    }
    if (selected) {
      pen.beginPath()
      pen.arc(box.x + box.w, box.y + box.h / 2, 5, 0, Math.PI * 2)
      pen.fillStyle = SELECT
      pen.fill()
    }
    pen.restore()
  }

  function placeholder(text, box) {
    pen.fillStyle = DIM
    pen.font = font(11)
    pen.fillText(String(text).slice(0, 40), box.x + PADDING, box.y + PADDING + 20, box.w - PADDING * 2)
  }

  /** Fit the image into the box, cropping the overhang. */
  function drawCover(image, box) {
    const inset = 2
    const inner = { x: box.x + inset, y: box.y + inset, w: box.w - inset * 2, h: box.h - inset * 2 }
    const scale = Math.max(inner.w / image.width, inner.h / image.height)
    const w = image.width * scale
    const h = image.height * scale
    pen.save()
    roundRect({ ...box, w: box.w, h: box.h }, 8)
    pen.clip()
    pen.drawImage(image, box.x + (box.w - w) / 2, box.y + (box.h - h) / 2, w, h)
    pen.restore()
  }

  function imageFor(node) {
    if (!node.text) return null
    const key = node.text
    if (!images.has(key)) {
      const entry = { ready: false, failed: false, image: null }
      const image = new Image()
      entry.image = image
      image.onload = () => { entry.ready = true; adoptHeight(node, image); paint() }
      image.onerror = () => { entry.failed = true; paint() }
      image.src = assetURL(key)
      images.set(key, entry)
    }
    return images.get(key)
  }

  /** The aspect the browser measured settles the height the model could not know. */
  function adoptHeight(node, image) {
    if (!image.width) return
    const w = node.w ?? DEFAULT_WIDTH.image
    const h = Math.round(w * image.height / image.width)
    if (node.h !== h) node.h = h
  }

  /** The point where a ray from one box's centre leaves it, on the way to another. */
  function anchor(from, to) {
    const x = from.x + from.w / 2
    const y = from.y + from.h / 2
    const dx = to.x + to.w / 2 - x
    const dy = to.y + to.h / 2 - y
    if (!dx && !dy) return [x, y]
    const scale = Math.min(
      dx ? (from.w / 2) / Math.abs(dx) : Infinity,
      dy ? (from.h / 2) / Math.abs(dy) : Infinity
    )
    return [x + dx * scale, y + dy * scale]
  }

  function drawEdge(edge, boxes, selected) {
    const from = boxes.get(edge.from)
    const to = boxes.get(edge.to)
    if (!from || !to) return
    const start = anchor(from, to)
    const end = anchor(to, from)
    pen.save()
    pen.strokeStyle = selected ? SELECT : EDGE
    pen.fillStyle = selected ? SELECT : EDGE
    pen.lineWidth = selected ? 2 : 1.25
    pen.beginPath()
    pen.moveTo(start[0], start[1])
    pen.lineTo(end[0], end[1])
    pen.stroke()
    const angle = Math.atan2(end[1] - start[1], end[0] - start[0])
    const head = 9
    pen.beginPath()
    pen.moveTo(end[0], end[1])
    pen.lineTo(end[0] - head * Math.cos(angle - 0.4), end[1] - head * Math.sin(angle - 0.4))
    pen.lineTo(end[0] - head * Math.cos(angle + 0.4), end[1] - head * Math.sin(angle + 0.4))
    pen.closePath()
    pen.fill()
    if (edge.text) {
      pen.font = font(11)
      pen.textAlign = 'center'
      const mx = (start[0] + end[0]) / 2
      const my = (start[1] + end[1]) / 2 - 6
      const width = measure(edge.text, 11)
      pen.fillStyle = BACKDROP
      pen.fillRect(mx - width / 2 - 4, my - 10, width + 8, 14)
      pen.fillStyle = DIM
      pen.fillText(edge.text, mx, my)
      pen.textAlign = 'left'
    }
    pen.restore()
  }

  function drawConnecting(from) {
    if (!state.connecting.at) return
    pen.save()
    pen.strokeStyle = SELECT
    pen.setLineDash([4, 4])
    pen.beginPath()
    pen.moveTo(from.x + from.w, from.y + from.h / 2)
    pen.lineTo(state.connecting.at[0], state.connecting.at[1])
    pen.stroke()
    pen.restore()
  }

  // ------------------------------------------------------------- hit testing
  function toWorld(event) {
    const rect = canvas.getBoundingClientRect()
    return [
      (event.clientX - rect.left - state.view.x) / state.view.zoom,
      (event.clientY - rect.top - state.view.y) / state.view.zoom
    ]
  }

  function hitNode(x, y) {
    const doc = state.doc
    for (let index = doc.nodes.length - 1; index >= 0; index--) {
      const node = doc.nodes[index]
      const box = nodeBox(node, measure)
      if (x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h) return { node, box }
    }
    return null
  }

  function onGrip(box, x, y) {
    return Math.abs(x - (box.x + box.w)) <= 8 && Math.abs(y - (box.y + box.h / 2)) <= 12
  }

  function hitEdge(x, y) {
    for (const edge of state.doc.edges) {
      const from = nodeBox(state.doc.nodes.find((node) => node.id === edge.from), measure)
      const to = nodeBox(state.doc.nodes.find((node) => node.id === edge.to), measure)
      const a = anchor(from, to)
      const b = anchor(to, from)
      if (distanceToSegment(x, y, a, b) <= 6) return edge
    }
    return null
  }

  function distanceToSegment(x, y, a, b) {
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const length = dx * dx + dy * dy
    const t = length ? clamp(((x - a[0]) * dx + (y - a[1]) * dy) / length, 0, 1) : 0
    return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy))
  }

  // ------------------------------------------------------------ interaction
  let gesture = null

  function onPointerDown(event) {
    if (event.button !== 0) return
    canvas.focus()
    if (state.editing) { actions.redraw(); return }
    const [x, y] = toWorld(event)
    const hit = hitNode(x, y)
    gesture = null
    canvas.setPointerCapture(event.pointerId)
    if (hit && onGrip(hit.box, x, y)) {
      gesture = { kind: 'connect', from: hit.node.id, at: [x, y], moved: false }
      state.connecting = gesture
    } else if (hit) {
      state.selected = `n:${hit.node.id}`
      gesture = { kind: 'drag', id: hit.node.id, dx: x - hit.node.at[0], dy: y - hit.node.at[1], moved: false }
    } else {
      const edge = hitEdge(x, y)
      state.selected = edge ? `e:${edge.id}` : null
      gesture = edge ? { kind: 'select' } : { kind: 'pan', x0: event.clientX, y0: event.clientY, vx: state.view.x, vy: state.view.y }
    }
    paint()
  }

  function onPointerMove(event) {
    if (!gesture) return
    if (gesture.kind === 'pan') {
      state.view.x = gesture.vx + (event.clientX - gesture.x0)
      state.view.y = gesture.vy + (event.clientY - gesture.y0)
      paint()
      return
    }
    const [x, y] = toWorld(event)
    if (gesture.kind === 'drag') {
      const node = state.doc.nodes.find((entry) => entry.id === gesture.id)
      if (!node) return
      gesture.moved = gesture.moved || Math.hypot(x - (node.at[0] + gesture.dx), y - (node.at[1] + gesture.dy)) > 0
      node.at = [Math.round(x - gesture.dx), Math.round(y - gesture.dy)]
      paint()
      return
    }
    if (gesture.kind === 'connect') {
      gesture.at = [x, y]
      gesture.moved = true
      paint()
    }
  }

  function onPointerUp(event) {
    if (!gesture) return
    const done = gesture
    gesture = null
    try { canvas.releasePointerCapture(event.pointerId) } catch { /* capture may be gone */ }
    if (done.kind === 'connect') {
      const [x, y] = toWorld(event)
      const hit = hitNode(x, y)
      state.connecting = null
      if (hit && hit.node.id !== done.from) {
        try { addEdge(state.doc, { from: done.from, to: hit.node.id }) }
        catch (error) { state.error = error.message }
        actions.commit()
        return
      }
      paint()
      return
    }
    if (done.kind === 'drag' && done.moved) { actions.commit(); return }
    actions.redraw()
  }

  function onDoubleClick(event) {
    const [x, y] = toWorld(event)
    const hit = hitNode(x, y)
    if (!hit) return
    if (hit.node.kind === 'image') { state.selected = `n:${hit.node.id}`; actions.redraw(); return }
    state.selected = `n:${hit.node.id}`
    state.editing = hit.node.id
    actions.redraw()
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') {
      event.stopPropagation()
      state.selected = null
      state.editing = null
      actions.redraw()
      return
    }
    if (event.key !== 'Delete' && event.key !== 'Backspace') return
    if (!state.selected) return
    event.preventDefault()
    event.stopPropagation()
    try {
      if (state.selected.startsWith('n:')) removeNode(state.doc, state.selected.slice(2))
      else removeEdge(state.doc, state.selected.slice(2))
      state.selected = null
      actions.commit()
    } catch (error) {
      state.error = error.message
      actions.redraw()
    }
  }

  function onWheel(event) {
    event.preventDefault()
    const rect = canvas.getBoundingClientRect()
    const px = event.clientX - rect.left
    const py = event.clientY - rect.top
    const before = [(px - state.view.x) / state.view.zoom, (py - state.view.y) / state.view.zoom]
    state.view.zoom = clamp(state.view.zoom * Math.exp(-event.deltaY * 0.0015), 0.25, 3)
    state.view.x = px - before[0] * state.view.zoom
    state.view.y = py - before[1] * state.view.zoom
    paint()
  }

  // ------------------------------------------------------- inline text editor
  function openTextEditor() {
    const node = state.doc?.nodes.find((entry) => entry.id === state.editing)
    if (!node) return
    const box = nodeBox(node, measure)
    const scale = state.view.zoom
    const area = document.createElement('textarea')
    area.value = node.text
    const left = box.x * scale + state.view.x
    const top = box.y * scale + state.view.y
    area.style.cssText = `position:absolute;left:${left}px;top:${top}px;`
      + `width:${Math.max(90, box.w * scale)}px;height:${Math.max(30, box.h * scale)}px;`
      + 'z-index:6;box-sizing:border-box;resize:none;outline:none;padding:6px;'
      + `font:12px ${FONT};background:#101014;color:${INK};border:1px solid ${SELECT};border-radius:6px`
    stage.append(area)
    area.focus()
    area.select()
    let finished = false
    const finish = (save) => {
      if (finished) return
      finished = true
      if (save) node.text = area.value
      state.editing = null
      if (save) actions.commit()
      else actions.redraw()
    }
    area.addEventListener('keydown', (event) => {
      event.stopPropagation()
      if (event.key === 'Escape') { event.preventDefault(); finish(false) }
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); finish(true) }
    })
    area.addEventListener('blur', () => finish(true))
  }

  // ------------------------------------------------------------------- mount
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerUp)
  canvas.addEventListener('dblclick', onDoubleClick)
  canvas.addEventListener('keydown', onKeyDown)
  canvas.addEventListener('wheel', onWheel, { passive: false })

  // The canvas is sized by CSS. This observer only reads: writing a size here
  // would resize what it watches and loop.
  const observer = new ResizeObserver(() => resize())
  observer.observe(stage)

  function resize() {
    // Before the panel is in the document the canvas reads its intrinsic size.
    // Fitting to that would frame the board for a size it never has.
    if (!stage.isConnected || !canvas.clientWidth) return
    state.stageSize = { width: canvas.clientWidth, height: canvas.clientHeight }
    if (state.fitPending) { fitBoard(state); state.fitPending = false }
    if (state.editing && !stage.querySelector('textarea')) openTextEditor()
    paint()
  }

  resize()
  // The mount runs before the panel is in the document, so the first read of
  // the canvas is the intrinsic 300x150. One frame later the CSS size is real.
  const firstPaint = requestAnimationFrame(() => resize())

  return {
    dispose() {
      observer.disconnect()
      cancelAnimationFrame(firstPaint)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      canvas.removeEventListener('dblclick', onDoubleClick)
      canvas.removeEventListener('keydown', onKeyDown)
      canvas.removeEventListener('wheel', onWheel)
    }
  }
}
