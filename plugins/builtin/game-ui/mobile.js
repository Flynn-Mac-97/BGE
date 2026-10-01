/** Mobile controls own each pointer until release, cancellation, removal or page suspension. */

/** A joystick's normalized position, with up positive, clamped to its circular radius. */
export function joystickPosition(rect, x, y) {
  const radius = Math.max(1, Math.min(rect.width, rect.height) / 2)
  const horizontal = (x - rect.left - rect.width / 2) / radius
  const vertical = (rect.top + rect.height / 2 - y) / radius
  const length = Math.max(1, Math.hypot(horizontal, vertical))
  return { x: horizontal / length, y: vertical / length }
}

/** A short, stationary contact is a tap; a sufficiently long movement is a swipe. */
export function contactGesture(start, end) {
  const x = end.x - start.x
  const y = end.y - start.y
  const distance = Math.hypot(x, y)
  const duration = end.time - start.time
  if (distance <= 12 && duration <= 350) return { type: 'tap', x: end.x, y: end.y }
  if (distance < 40 || duration > 700) return null
  const horizontal = x < 0 ? 'left' : 'right'
  const vertical = y < 0 ? 'up' : 'down'
  return { type: 'swipe', direction: Math.abs(x) >= Math.abs(y) ? horizontal : vertical, x, y }
}

/** Attach mobile kit controls to a panel; return release and disposal hooks for its lifecycle. */
export function watchMobile(root, input, report) {
  const contacts = new Map()
  const controller = new AbortController()
  const options = { signal: controller.signal }
  const point = event => ({ x: event.clientX, y: event.clientY, time: event.timeStamp })

  function release(contact) {
    for (const action of contact.held) input?.releaseAction(action, contact.source)
    contact.held.clear()
    contact.control.removeAttribute('data-held')
    const thumb = contact.control.querySelector('.ui-joystick-thumb')
    if (thumb) thumb.style.transform = ''
  }

  function setActions(contact, actions) {
    const wanted = new Set(actions.filter(Boolean))
    for (const action of contact.held) if (!wanted.has(action)) input?.releaseAction(action, contact.source)
    for (const action of wanted) if (!contact.held.has(action)) input?.holdAction(action, contact.source)
    contact.held = wanted
  }

  function moveStick(contact, event) {
    const position = joystickPosition(contact.control.getBoundingClientRect(), event.clientX, event.clientY)
    const directions = JSON.parse(contact.control.dataset.directions)
    const deadZone = Number(contact.control.dataset.deadZone)
    const actions = []
    if (position.x < -deadZone) actions.push(directions.left)
    if (position.x > deadZone) actions.push(directions.right)
    if (position.y > deadZone) actions.push(directions.up)
    if (position.y < -deadZone) actions.push(directions.down)
    setActions(contact, actions)
    const thumb = contact.control.querySelector('.ui-joystick-thumb')
    if (thumb) thumb.style.transform = `translate(${position.x * 35}px, ${-position.y * 35}px)`
  }

  function press(event) {
    const control = event.target.closest?.('[data-mobile]')
    if (!control || control.hasAttribute('data-disabled') || event.button > 0) return
    if ([...contacts.values()].some(contact => contact.control === control)) return
    event.preventDefault()
    const source = `panel:${root.host.dataset.gameUi}:${[...root.querySelectorAll('[data-mobile]')].indexOf(control)}`
    const contact = { control, source, held: new Set(), start: point(event), last: event, kind: control.dataset.mobile }
    contacts.set(event.pointerId, contact)
    control.setPointerCapture(event.pointerId)
    control.setAttribute('data-held', '')
    if (contact.kind === 'button') setActions(contact, [control.dataset.action])
    if (contact.kind === 'joystick') moveStick(contact, event)
  }

  function move(event) {
    const contact = contacts.get(event.pointerId)
    if (!contact) return
    event.preventDefault()
    contact.last = event
    if (contact.kind === 'joystick') moveStick(contact, event)
  }

  function end(event) {
    const contact = contacts.get(event.pointerId)
    if (!contact) return
    contacts.delete(event.pointerId)
    release(contact)
    if (contact.control.hasPointerCapture?.(event.pointerId)) contact.control.releasePointerCapture(event.pointerId)
    if (event.type !== 'pointerup' || contact.kind !== 'gesture') return
    const gesture = contactGesture(contact.start, point(event))
    if (gesture) report({ action: contact.control.dataset.action, value: gesture, kind: 'gesture', type: gesture.type, x: event.clientX, y: event.clientY })
  }

  function cancel() {
    for (const [pointerId, contact] of [...contacts]) end({ pointerId, type: 'pointercancel' })
  }

  function reconcile() {
    for (const [pointerId, contact] of [...contacts]) {
      if (!root.contains(contact.control) || contact.control.hasAttribute('data-disabled')) end({ pointerId, type: 'pointercancel' })
      else if (contact.kind === 'joystick') moveStick(contact, contact.last)
    }
  }

  root.addEventListener('pointerdown', press, options)
  root.addEventListener('pointermove', move, options)
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) root.addEventListener(type, end, options)
  globalThis.window?.addEventListener?.('blur', cancel, options)
  globalThis.document?.addEventListener?.('visibilitychange', () => { if (document.hidden) cancel() }, options)
  return { cancel, reconcile, dispose() { cancel(); controller.abort() } }
}

/** Mobile controls take only their own hit areas and leave the rest of the game reachable. */
export const MOBILE_CSS = `
.ui-mobile { pointer-events:auto; touch-action:none; user-select:none; -webkit-user-select:none; -webkit-touch-callout:none }
.ui-mobile-controls { position:absolute; inset:0; pointer-events:none; padding:max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left)); box-sizing:border-box; display:flex; align-items:flex-end; justify-content:space-between; gap:20px }
.ui-joystick { width:140px; height:140px; border:2px solid #ffffff70; border-radius:50%; background:#18243b99; display:grid; place-items:center }
.ui-joystick-thumb { width:54px; height:54px; border-radius:50%; background:#d8eaffaa; pointer-events:none }
.ui-action-button { min-width:64px; min-height:64px; border-radius:50%; border:2px solid #ffffff90; background:#254565dd; color:white; font:600 16px system-ui }
.ui-action-button[data-held] { background:#437b9e }
.ui-mobile[data-disabled] { opacity:.4; pointer-events:none }
.ui-gesture-area { min-width:44px; min-height:44px }
`
