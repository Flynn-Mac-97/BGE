/** Black Bell's data-driven grid rules are available to headless tools and the game. */
import { createRules, vocabulary } from './grid-game/api.js'

export default {
  name: 'Black Bell Grid', category: 'game',
  onLoad(context) { context.gridGame = { createRules, vocabulary } },
  commands: [
    { id: 'gridGame.vocabulary', title: 'Grid rule vocabulary', run: () => vocabulary },
    { id: 'gridGame.validate', title: 'Validate grid catalog', run(context, catalog) { const rules = createRules(catalog); return { items: Object.keys(rules.catalog.items), statuses: Object.keys(rules.catalog.statuses) } } },
    { id: 'gridGame.resolve', title: 'Resolve a grid cycle', run(context, request) { return createRules(request.catalog).resolveCycle(request.state, request.options) } }
  ]
}
