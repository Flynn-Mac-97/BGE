/** Drive the public plugin interface with engine-kit controls and fixed simulation time. */
import plugin from '../plugins/bell.js'
import { kit } from '../../plugins/builtin/game-ui/components.js'
export function fixture() {
  let start, panel
  const context = { random: () => 0.25, bus: { on(name, callback) { start = callback } }, gameUi: { kit, show(id, value) { panel = value } } }
  plugin.onLoad(context); start()
  return { context, panel, read: context.blackBell.read, tick: (count = 1, seconds = 1) => { for (let index = 0; index < count; index++) plugin.systems[0].run(null, seconds, context) } }
}
