/** Drive the public plugin interface with engine-kit controls and fixed simulation time. */
import plugin from '../plugins/bell.js'
import { kit } from '../../plugins/builtin/game-ui/components.js'
/** `hub` keeps the Descent start screen; otherwise the fixture enters the older company flow, and `tavern` stops in its tavern. */
export function fixture({ hub = false, tavern = false, storage } = {}) {
  let start, panel
  const context = { companyStorage: storage, random: () => 0.25, bus: { on(name, callback) { start = callback } }, gameUi: { kit, show(id, value) { panel = value } } }
  plugin.onLoad(context); start()
  if (!hub && context.blackBell.read().screen === 'hub') context.blackBell.action('oldCompany')
  if (!tavern && context.blackBell.read().screen === 'tavern') { context.blackBell.action('hire', 'rook'); context.blackBell.action('embark', 'rook') }
  return { context, panel, read: context.blackBell.read, tick: (count = 1, seconds = 1) => { for (let index = 0; index < count; index++) plugin.systems[0].run(null, seconds, context) } }
}
