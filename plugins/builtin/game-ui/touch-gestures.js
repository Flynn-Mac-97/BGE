/** Pointer-based gesture recognition. Browser timing classifies input; reports enter the UI's fixed-step queue. */

/** Classify a completed single contact by distance and elapsed input time. */
export function contactGesture(start, end, moved = Math.hypot(end.x - start.x, end.y - start.y)) {
  const x = end.x - start.x
  const y = end.y - start.y
  const distance = Math.hypot(x, y)
  const duration = end.time - start.time
  if (moved <= 12 && duration <= 350) return { type: 'tap', x: end.x, y: end.y }
  if (distance < 40 || duration > 700) return null
  const horizontal = x < 0 ? 'left' : 'right'
  const vertical = y < 0 ? 'up' : 'down'
  return { type: 'swipe', direction: Math.abs(x) >= Math.abs(y) ? horizontal : vertical, x, y, distance, duration }
}

/** The separation, angle and centre of two contact points. */
function pairOf(contacts) {
  const [first, second] = [...contacts.values()].map(contact => contact.point)
  return { distance: Math.hypot(second.x - first.x, second.y - first.y), angle: Math.atan2(second.y - first.y, second.x - first.x), x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
}

/** One area's gesture state, independent from other areas and controls. */
export function makeTouchGestures({ report, draw = () => {}, schedule = setTimeout, clear = clearTimeout }) {
  const contacts = new Map()
  let trails = []
  let baseline = null
  let previousTap = null
  let last = { type: 'ready' }
  let transform = { scale: 1, rotation: 0, x: 0, y: 0 }

  const snapshot = () => ({ contacts: [...contacts.values()].map(contact => ({ id: contact.id, point: contact.point, trail: contact.trail })), trails, last, transform })
  const paint = () => draw(snapshot())
  const emit = value => { last = value; report(value); paint() }
  const clearHold = contact => { if (contact.timer !== null) clear(contact.timer); contact.timer = null }

  function down(id, point) {
    if (contacts.has(id) || contacts.size >= 2) return false
    const contact = { id, start: point, point, trail: [point], moved: 0, dragging: false, held: false, multiple: false, timer: null }
    contacts.set(id, contact)
    if (contacts.size === 1) {
      trails = []
      contact.timer = schedule(() => {
        contact.timer = null
        if (!contacts.has(id) || contact.moved > 8 || contact.multiple) return
        contact.held = true
        previousTap = null
        emit({ type: 'longpress', x: contact.point.x, y: contact.point.y, duration: 500 })
      }, 500)
    }
    if (contacts.size === 2) {
      previousTap = null
      for (const item of contacts.values()) { clearHold(item); item.multiple = true }
      baseline = pairOf(contacts)
      transform = { scale: 1, rotation: 0, x: 0, y: 0 }
      emit({ type: 'transformstart', ...transform })
    }
    paint()
    return true
  }

  function move(id, point) {
    const contact = contacts.get(id)
    if (!contact) return
    contact.point = point
    contact.trail.push(point)
    if (contact.trail.length > 80) contact.trail.splice(1, 1)
    contact.moved = Math.max(contact.moved, Math.hypot(point.x - contact.start.x, point.y - contact.start.y))
    if (contact.moved > 8) clearHold(contact)
    if (baseline && contacts.size === 2) {
      const pair = pairOf(contacts)
      const radians = pair.angle - baseline.angle
      transform = { scale: pair.distance / Math.max(1, baseline.distance), rotation: Math.atan2(Math.sin(radians), Math.cos(radians)) * 180 / Math.PI, x: pair.x - baseline.x, y: pair.y - baseline.y }
      emit({ type: 'transform', ...transform })
      return
    }
    if (!contact.multiple && contact.moved > 8) {
      const type = contact.dragging ? 'drag' : 'dragstart'
      contact.dragging = true
      emit({ type, x: point.x - contact.start.x, y: point.y - contact.start.y })
      return
    }
    paint()
  }

  function up(id, point, reason = 'release') {
    const contact = contacts.get(id)
    if (!contact) return
    clearHold(contact)
    contacts.delete(id)
    if (reason !== 'release') {
      baseline = null
      previousTap = null
      emit({ type: 'cancel' })
      return
    }
    contact.point = point
    contact.trail.push(point)
    trails = [...trails.slice(-1), { id, point, trail: contact.trail }]
    if (contact.multiple) {
      if (baseline) emit({ type: 'transformend', ...transform })
      baseline = null
      paint()
      return
    }
    if (contact.dragging) emit({ type: 'dragend', x: point.x - contact.start.x, y: point.y - contact.start.y })
    if (contact.held) { paint(); return }
    const gesture = contactGesture(contact.start, point, contact.moved)
    if (!gesture || (contact.dragging && gesture.type === 'tap')) { paint(); return }
    if (gesture.type === 'tap' && previousTap && point.time - previousTap.time <= 300 && Math.hypot(point.x - previousTap.x, point.y - previousTap.y) <= 24) {
      previousTap = null
      emit({ ...gesture, type: 'doubletap' })
      return
    }
    previousTap = gesture.type === 'tap' ? point : null
    emit(gesture)
  }

  function cancel() {
    for (const contact of contacts.values()) clearHold(contact)
    const hadContacts = contacts.size > 0
    contacts.clear()
    baseline = null
    previousTap = null
    if (hadContacts) emit({ type: 'cancel' })
  }

  return { down, move, up, cancel, snapshot, paint }
}
