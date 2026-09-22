import test from 'node:test'
import assert from 'node:assert/strict'
import elk from '../plugins/builtin/elk-layout.js'
import rapier2d from '../plugins/builtin/rapier-2d.js'
import rapier3d from '../plugins/builtin/rapier-3d.js'
import consolePlugin from '../plugins/builtin/console.js'
import { applyFocus } from '../plugins/builtin/play-focus.js'

test('ELK service routes function ports and returns separate deterministic graph data',async()=>{
  let layout
  elk.onLoad({}, {provide(key,value){layout=value},defer(){}})
  const graph={nodes:[{id:'a',title:'A',width:300,height:130,functions:[{name:'start',line:1,endLine:5,start:0}]},{id:'b',title:'B',width:300,height:130,functions:[{name:'run',line:8,endLine:9,start:20}]}],edges:[{id:'call',from:'a',to:'b',evidence:{line:2},target:{line:8}}]}
  const before=JSON.stringify(graph),result=await layout.arrange(graph)
  assert.equal(JSON.stringify(graph),before)
  assert.ok(result.nodes[0].x<result.nodes[1].x)
  assert.equal(result.edges[0].sourcePort,'a:out:0')
  assert.equal(result.edges[0].targetPort,'b:in:0')
  assert.ok(result.edges[0].sections.length)
  assert.deepEqual(await layout.arrange(graph),result)
})

/** The smallest `ui` that lets a panel build a tree. */
const stubUi = {
  stack: children => ({ children }),
  row: children => ({ children }),
  spacer: () => ({ spacer: true }),
  toggle: options => options,
  text: (text, options) => ({ text, options }),
  label: text => ({ text }),
  value: value => ({ value }),
  glyph: (text, options) => ({ glyph: text, options }),
  meta: text => ({ meta: text }),
  empty: text => ({ empty: text }),
  button: (label, run) => ({ label, run })
}

/**
 * A panel whose render throws loses its whole plugin's commands, and only when
 * a person opens it. Rendering every panel before a world has hashed or loaded
 * is what catches a name that was never declared.
 */
test('the Rapier panels render before a world has hashed or loaded', () => {
  const context = { loader: { plugins: new Map() } }
  for (const plugin of [rapier2d, rapier3d]) {
    for (const panel of plugin.panels) {
      assert.doesNotThrow(() => panel.render(stubUi, context), `${plugin.name} panel "${panel.id}" renders`)
    }
  }
})

/**
 * Play fills the page with the game, and it must not seize the whole screen.
 * Full screen is the FOCUS button's job, because only a real click can ask.
 */
test('play collapses the frame and does not ask for the whole screen', () => {
  const shell = { focused: false, focus(on) { this.focused = on }, root: {} }
  const collapsed = applyFocus({ shell }, true, { fullscreen: false })
  assert.equal(shell.focused, true, 'the docks collapse to the viewport')
  assert.equal(collapsed.fullscreen, false, 'no full screen was asked for')
  assert.equal(collapsed.why, null, 'so there is no refusal to complain about')
})

/**
 * The console is the engine's view of the host, so it must render without one
 * and read a published list when there is one.
 */
test('the Console leaves terminal ownership to the desktop and supports headless discovery', async () => {
  assert.equal(consolePlugin.panels, undefined)
  assert.deepEqual(await consolePlugin.commands[0].run(), { supported: false, instances: [] })
})
