# Mobile game controls

Use the existing Keyboard Input and Game UI plugins. Mobile controls belong to a game panel, not the editor's UI. Keep the panel non-interactive so only its controls take touches.

```js
const kit = context.gameUi.kit
context.gameUi.show('controls', {
  html: kit.mobileControls([
    kit.joystick(),
    kit.actionButton('Fire', { action: 'fire' })
  ])
})
```

`joystick({ left, right, up, down, deadZone, label, isDisabled })` maps an eight-way stick to named actions. The defaults are the four direction actions and a 0.2 dead zone. Read `input.axis('x')` and `input.axis('y')`; up is positive. This first version uses digital directions, not analog speed. Set all four names for a game's alternate movement bindings.

`actionButton(label, { action, isDisabled })` holds a named game action for as long as its pointer is down. A second finger can use it while the stick moves. Mobile holds use separate recorded codes, so lifting a finger does not release a keyboard key or another control. `input.holdAction(action, source)` and `input.releaseAction(action, source)` provide the same route without a browser. Keep source names stable and bounded, one per control.

`gestureArea(children, { action, label })` reports `tap` and `swipe` through the panel's usual `on` table on a fixed step. A tap is at most 12 pixels and 350 ms. A swipe is at least 40 pixels and at most 700 ms; its value is `{ type: 'swipe', direction, x, y }`, where x/y are the total movement in CSS pixels. A tap's x/y are client coordinates. Cancellation never produces a gesture. Use `gameUi.click(id, action, value, 'swipe')` in a headless test.

Pointer capture keeps a hold alive outside its original hit area. Pointer cancellation, lost capture, hidden pages, window blur, panel removal, disabled controls and level changes release held inputs. Hiding a panel releases immediately, including one with a leave animation.

Style `.ui-mobile-controls`, `.ui-joystick`, `.ui-joystick-thumb`, `.ui-action-button` and `.ui-gesture-area` in the game's theme. Control targets are at least 44 CSS pixels; the default action button is 64. The layout respects safe-area insets. Touch-action suppression applies only to these controls. Pinch/rotate and analog sticks are not part of this version.
