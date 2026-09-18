/**
 * The viewport tool: select, move, scale, rotate — with no modes.
 *
 * The handle you grab IS the choice, so the mode can never be wrong. Drag inside
 * to move, a corner to scale, the arc outside a corner to rotate.
 *
 * Also solves the pile problem: right-click lists everything under the cursor,
 * front to back, and hovering a row outlines it in the scene.
 */
const GRID = 0.5
const SNAP_PX = 7

export default {
  name: 'Transform Tool',

  category: 'editor',
  tools: [{ id: 'select', label: 'Select and transform', icon: '⌖', key: 'v' }],

  commands: [
    { id: 'view.frameSelection', label: 'Frame selection', run: context => frame(context, false) },
    { id: 'view.frameAll',       label: 'Frame everything', run: context => frame(context, true) },
    {
      id: 'edit.duplicate', label: 'Duplicate selection',
      run: context => {
        const made = context.selection.map(e =>
          context.spawn(e.type, { at: [e.x + GRID, e.y - GRID, e.z], properties: pick(e.properties, e.overrides) }))
        context.select(made.map(e => e.id))
        context.save()
      }
    }
  ],

  onLoad(context) {
    context.bus.on('shell:ready', () => attach(context))
  }
}

const pick = (obj, keys) => Object.fromEntries(keys.map(k => [k, obj[k]]))

function frame(context, all) {
  const list = all || !context.selection.length ? context.world.entities : context.selection
  if (!list.length) return
  const b = bounds(context, list)
  const { w, h } = context.renderer.size
  context.renderer.view.x = (b.x0 + b.x1) / 2
  context.renderer.view.y = (b.y0 + b.y1) / 2
  context.renderer.view.zoom = Math.max(6, Math.min(240,
    Math.min(w / (b.x1 - b.x0 + 2), h / (b.y1 - b.y0 + 2))))
}

function bounds(context, list) {
  const xs = [], ys = []
  for (const e of list) {
    const { w, h } = context.renderer.bounds(e)
    xs.push(e.x - w / 2, e.x + w / 2)
    ys.push(e.y - h / 2, e.y + h / 2)
  }
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }
}

/**
 * The closest of one box's three centres to any of the moving box's three
 * positions, within `tol`, or the best found so far.
 *
 * Nine comparisons an axis: two edges and a centre on each side. `best` is
 * carried across every other box, so the nearest of all of them wins.
 */
function nearestSnap(best, centres, targets, tol, other) {
  for (const centre of centres)
    for (const target of targets) {
      const d = centre - target
      if (Math.abs(d) < tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, c: centre, o: other }
    }
  return best
}

function attach(context) {
  const { renderer, world, editor, bus } = context
  const viewport = context.shell.viewport
  const layer = context.shell.overlay

  let drag = null, marquee = null, guides = [], readout = null
  let menu = null, peek = null, space = false
  let cycleAt = null, cycleIdx = 0
  const mods = { shift: false, meta: false, alt: false }

  const pt = event => { const r = viewport.getBoundingClientRect(); return { x: event.clientX - r.left, y: event.clientY - r.top } }
  const sel = () => context.selection
  // In the 3D view this tool is a flat overlay drawing 2D math, which is the
  // wrong vocabulary for a perspective scene — the 3D Transform Gizmo plugin
  // owns the viewport there, and this tool's overlay, drags and zoom stand
  // down until the view is ortho again.
  const in3d = () => context.view.mode === '3d'

  // ---------------------------------------------------------------- overlay
  function paint() {
    let html = ''
    const list = sel()

    if (list.length && !context.loop.running && !in3d()) {
      const b = bounds(context, list)
      const tl = renderer.toScreen(b.x0, b.y1)
      const br = renderer.toScreen(b.x1, b.y0)
      const w = br.x - tl.x, h = br.y - tl.y
      const single = list.length === 1 ? list[0] : null

      const H = [['nw', 0, 0], ['n', .5, 0], ['ne', 1, 0], ['e', 1, .5],
                 ['se', 1, 1], ['s', .5, 1], ['sw', 0, 1], ['w', 0, .5]]
      const cursor = k => k.length === 2
        ? (k === 'nw' || k === 'se' ? 'nwse-resize' : 'nesw-resize')
        : (k === 'n' || k === 's' ? 'ns-resize' : 'ew-resize')

      html += `<div class="gizmo" style="left:${tl.x}px;top:${tl.y}px;width:${w}px;height:${h}px;
        transform:rotate(${single ? single.rotation || 0 : 0}deg)">
        <div class="frame"></div>
        ${single ? [['nw',0,0,-1,-1],['ne',1,0,1,-1],['se',1,1,1,1],['sw',0,1,-1,1]].map(([k,fx,fy,ox,oy]) =>
          `<span class="rot" data-r="${k}" title="drag to rotate"
             style="left:${fx*100}%;top:${fy*100}%;margin-left:${ox>0?4:-24}px;margin-top:${oy>0?4:-24}px">⟳</span>`).join('') : ''}
        ${single ? H.map(([k,fx,fy]) =>
          `<span class="hd" data-h="${k}" style="left:${fx*100}%;top:${fy*100}%;cursor:${cursor(k)}"></span>`).join('') : ''}
      </div>`
    }

    for (const g of guides) {
      html += g.axis === 'v'
        ? `<div class="guide v" style="left:${g.p}px;top:${g.a}px;height:${g.b - g.a}px"></div>`
        : `<div class="guide h" style="top:${g.p}px;left:${g.a}px;width:${g.b - g.a}px"></div>`
    }

    if (marquee) {
      const x = Math.min(marquee.x0, marquee.x1), y = Math.min(marquee.y0, marquee.y1)
      html += `<div class="marquee" style="left:${x}px;top:${y}px;
        width:${Math.abs(marquee.x1 - marquee.x0)}px;height:${Math.abs(marquee.y1 - marquee.y0)}px"></div>`
    }
    if (readout) html += `<div class="readout" style="left:${readout.x}px;top:${readout.y}px">${readout.t}</div>`

    if (menu) {
      html += `<div class="stackmenu" style="left:${menu.x}px;top:${menu.y}px">
        <div class="mh">under cursor · ${menu.items.length}</div>
        ${menu.items.map((e, i) => `<div class="mrow" data-pick="${e.id}">
          ${e.id}${i === 0 ? ' <span class="z">front</span>' : `<span class="z">${e.type}</span>`}</div>`).join('')}
      </div>`
    }

    layer.innerHTML = html
    layer.style.pointerEvents = menu ? 'auto' : 'none'
  }

  // ---------------------------------------------------------------- snapping
  function snapped(list, dx, dy) {
    guides = []
    if (mods.meta) return { dx, dy }

    const moved = list.map(e => ({ ...e, x: e.x + dx, y: e.y + dy }))
    const mb = bounds(context, moved)
    const tol = SNAP_PX / renderer.view.zoom
    const others = world.entities.filter(e => !editor.selection.has(e.id))

    let bX = null, bY = null
    for (const o of others) {
      const { w, h } = renderer.bounds(o)
      bX = nearestSnap(bX, [o.x - w / 2, o.x, o.x + w / 2], [mb.x0, (mb.x0 + mb.x1) / 2, mb.x1], tol, o)
      bY = nearestSnap(bY, [o.y - h / 2, o.y, o.y + h / 2], [mb.y0, (mb.y0 + mb.y1) / 2, mb.y1], tol, o)
    }

    let ndx = dx, ndy = dy
    if (bX) {
      ndx += bX.d
      const { h } = renderer.bounds(bX.o)
      guides.push({ axis: 'v', p: renderer.toScreen(bX.c, 0).x,
        a: Math.min(renderer.toScreen(0, bX.o.y + h / 2).y, renderer.toScreen(0, mb.y1).y) - 10,
        b: Math.max(renderer.toScreen(0, bX.o.y - h / 2).y, renderer.toScreen(0, mb.y0).y) + 10 })
    } else {
      const c = (mb.x0 + mb.x1) / 2
      ndx += Math.round(c / GRID) * GRID - c
    }
    if (bY) {
      ndy += bY.d
      const { w } = renderer.bounds(bY.o)
      guides.push({ axis: 'h', p: renderer.toScreen(0, bY.c).y,
        a: Math.min(renderer.toScreen(bY.o.x - w / 2, 0).x, renderer.toScreen(mb.x0, 0).x) - 10,
        b: Math.max(renderer.toScreen(bY.o.x + w / 2, 0).x, renderer.toScreen(mb.x1, 0).x) + 10 })
    } else {
      const c = (mb.y0 + mb.y1) / 2
      ndy += Math.round(c / GRID) * GRID - c
    }
    return { dx: ndx, dy: ndy }
  }

  // ---------------------------------------------------------------- input
  layer.addEventListener('pointerdown', event => {
    const row = event.target.closest('[data-pick]')
    if (!row) return
    event.stopPropagation()
    context.select(row.getAttribute('data-pick'))
    menu = null; peek = null
    paint(); context.redraw()
  })
  layer.addEventListener('pointerover', event => {
    const row = event.target.closest('[data-pick]')
    if (!row) return
    const e = world.byId(row.getAttribute('data-pick'))
    if (peek) peek.opacity = 1
    peek = e
    if (e) e.opacity = 0.45
  })

  viewport.addEventListener('contextmenu', event => {
    event.preventDefault()
    const p = pt(event)
    const items = renderer.pick(world, p.x, p.y)
    menu = items.length ? { x: p.x, y: p.y, items } : null
    paint()
  })

  viewport.addEventListener('pointerdown', event => {
    if (in3d()) return
    if (event.button === 2) return
    if (menu) { menu = null; if (peek) { peek.opacity = 1; peek = null } }
    viewport.setPointerCapture(event.pointerId)
    const p = pt(event)

    if (space || event.button === 1) { drag = { kind: 'pan', p, view: { ...renderer.view } }; return }

    const r = event.target.closest?.('[data-r]')
    if (r && sel().length === 1) {
      const e = sel()[0]
      const c = renderer.toScreen(e.x, e.y)
      drag = { kind: 'rotate', e, p, start: e.rotation || 0, a0: Math.atan2(p.y - c.y, p.x - c.x) }
      return
    }
    const hd = event.target.closest?.('[data-h]')
    if (hd && sel().length === 1) {
      const e = sel()[0]
      drag = { kind: 'scale', e, h: hd.getAttribute('data-h'), p, s: { x: e.x, y: e.y, scale: e.scale ?? 1 } }
      return
    }

    const stack = renderer.pick(world, p.x, p.y)

    if (event.altKey && stack.length) {
      const near = cycleAt && Math.hypot(cycleAt.x - p.x, cycleAt.y - p.y) < 6
      cycleIdx = near ? (cycleIdx + 1) % stack.length : 0
      cycleAt = p
      context.select(stack[cycleIdx].id)
      paint(); context.redraw()
      return
    }
    cycleAt = null

    const hit = stack[0]
    if (hit) {
      if (event.shiftKey) {
        editor.selection.has(hit.id) ? editor.selection.delete(hit.id) : editor.selection.add(hit.id)
        bus.emit('selection:changed')
      } else if (!editor.selection.has(hit.id)) context.select(hit.id)
      drag = { kind: 'move', p, orig: sel().map(e => ({ id: e.id, x: e.x, y: e.y })) }
    } else {
      if (!event.shiftKey) context.select([])
      marquee = { x0: p.x, y0: p.y, x1: p.x, y1: p.y }
      drag = { kind: 'marquee', p }
    }
    paint(); context.redraw()
  })

  viewport.addEventListener('pointermove', event => {
    if (!drag) return
    const p = pt(event)

    if (drag.kind === 'pan') {
      renderer.view.x = drag.view.x - (p.x - drag.p.x) / renderer.view.zoom
      renderer.view.y = drag.view.y + (p.y - drag.p.y) / renderer.view.zoom
      paint(); return
    }

    if (drag.kind === 'marquee') {
      marquee.x1 = p.x; marquee.y1 = p.y
      const a = renderer.toWorld(Math.min(marquee.x0, marquee.x1), Math.max(marquee.y0, marquee.y1))
      const b = renderer.toWorld(Math.max(marquee.x0, marquee.x1), Math.min(marquee.y0, marquee.y1))
      context.select(world.entities.filter(e => {
        const { w, h } = renderer.bounds(e)
        return e.x + w / 2 > a.x && e.x - w / 2 < b.x && e.y + h / 2 > a.y && e.y - h / 2 < b.y
      }).map(e => e.id))
      paint(); return
    }

    if (drag.kind === 'move') {
      let dx = (p.x - drag.p.x) / renderer.view.zoom
      let dy = -(p.y - drag.p.y) / renderer.view.zoom
      if (mods.shift) { Math.abs(dx) > Math.abs(dy) ? dy = 0 : dx = 0 }
      const base = drag.orig.map(o => ({ ...world.byId(o.id), x: o.x, y: o.y }))
      const s = snapped(base, dx, dy)
      for (const o of drag.orig) {
        const e = world.byId(o.id)
        e.x = o.x + s.dx; e.y = o.y + s.dy
      }
      readout = { x: p.x, y: p.y, t: `${sign(s.dx)}, ${sign(s.dy)}` }
      paint(); return
    }

    if (drag.kind === 'scale') {
      const e = drag.e
      const d = (p.x - drag.p.x + (drag.p.y - p.y)) / 2 / renderer.view.zoom
      const base = renderer.bounds({ ...e, scale: 1 }).w || 1
      let next = Math.max(0.05, drag.s.scale + d / base)
      if (!mods.meta) next = Math.round(next * 20) / 20
      e.scale = next
      readout = { x: p.x, y: p.y, t: `×${next.toFixed(2)}` }
      paint(); return
    }

    if (drag.kind === 'rotate') {
      const e = drag.e
      const c = renderer.toScreen(e.x, e.y)
      let deg = drag.start + (Math.atan2(p.y - c.y, p.x - c.x) - drag.a0) * 180 / Math.PI
      if (mods.shift) deg = Math.round(deg / 15) * 15
      const n = ((deg % 360) + 360) % 360
      e.rotation = n > 180 ? n - 360 : n
      readout = { x: p.x, y: p.y, t: `${Math.round(e.rotation)}°` }
      paint(); return
    }
  })

  function end() {
    const was = drag
    drag = null; marquee = null; readout = null; guides = []
    if (was && was.kind !== 'pan' && was.kind !== 'marquee') context.save()
    paint(); context.redraw()
  }
  viewport.addEventListener('pointerup', end)
  viewport.addEventListener('pointercancel', end)

  viewport.addEventListener('wheel', event => {
    if (in3d()) return
    event.preventDefault()
    const p = pt(event)
    const before = renderer.toWorld(p.x, p.y)
    renderer.view.zoom = Math.min(400, Math.max(4, renderer.view.zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12)))
    const after = renderer.toWorld(p.x, p.y)
    renderer.view.x += before.x - after.x
    renderer.view.y += before.y - after.y
    menu = null
    paint(); context.redraw()
  }, { passive: false })

  addEventListener('keydown', event => {
    if (['INPUT', 'TEXTAREA'].includes(event.target.tagName)) return
    mods.shift = event.shiftKey; mods.meta = event.metaKey || event.ctrlKey; mods.alt = event.altKey
    if (event.code === 'Space' && !space) { space = true; event.preventDefault() }
    if (event.key === 'Escape') { menu = null; paint() }

    const step = event.shiftKey ? GRID * 10 : GRID
    if (event.key.startsWith('Arrow') && sel().length) {
      event.preventDefault()
      for (const e of sel()) {
        if (event.key === 'ArrowLeft') e.x -= step
        if (event.key === 'ArrowRight') e.x += step
        if (event.key === 'ArrowUp') e.y += step
        if (event.key === 'ArrowDown') e.y -= step
      }
      context.save(); paint(); context.redraw()
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && sel().length) {
      sel().forEach(e => context.destroy(e)); context.select([]); context.save(); paint(); context.redraw()
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd' && sel().length) {
      event.preventDefault(); context.run('edit.duplicate'); paint(); context.redraw()
    }
    if (event.key.toLowerCase() === 'f') { frame(context, event.shiftKey); paint(); context.redraw() }
  })

  addEventListener('keyup', event => {
    mods.shift = event.shiftKey; mods.meta = event.metaKey || event.ctrlKey; mods.alt = event.altKey
    if (event.code === 'Space') space = false
  })

  bus.on('selection:changed', paint)
  bus.on('world:changed', paint)
  bus.on('level:loaded', paint)
  // keep the gizmo glued to the entity while the camera or simulation moves
  const spin = () => { if (drag || sel().length) paint(); requestAnimationFrame(spin) }
  spin()
  setInterval(() => { if (document.hidden && sel().length) paint() }, 100)
}

const sign = n => (n >= 0 ? '+' : '') + n.toFixed(2)
