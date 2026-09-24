/**
 * Game UI: panels a game shows, read back as text with no browser, and gone
 * when the run that showed them ends.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { makeBus } from '../engine/bus.js'
import gameUi from '../plugins/builtin/game-ui.js'

function loaded() {
  const context = { bus: makeBus() }
  gameUi.onLoad(context)
  return context
}

test('a panel reads back as its text, tags and styles dropped', () => {
  const context = loaded()
  context.gameUi.show('sheet', { css: 'h1 { color: red }', html: '<h1>Loadout</h1><p>sword &amp; shield</p>' })
  assert.equal(context.gameUi.read('sheet'), 'Loadout sword & shield')
})

test('a panel built by a function shows its value this moment', () => {
  const context = loaded()
  let health = 100
  context.gameUi.show('hud', { html: () => `<b>${health}</b>` })
  health = 85
  assert.equal(context.gameUi.read('hud'), '85')
})

test('a panel whose builder throws reads as empty instead of breaking the reader', () => {
  const context = loaded()
  const quiet = console.error
  console.error = () => {}
  context.gameUi.show('broken', { html: () => { throw new Error('no') } })
  assert.equal(context.gameUi.read('broken'), '')
  console.error = quiet
})

test('hide takes a panel down, and stopping play takes them all down', () => {
  const context = loaded()
  context.gameUi.show('one', { html: 'a' })
  context.gameUi.show('two', { html: 'b' })
  assert.equal(context.gameUi.hide('one'), true)
  assert.deepEqual(context.gameUi.shown(), ['two'])
  context.bus.emit('play:stopped')
  assert.deepEqual(context.gameUi.shown(), [])
})
