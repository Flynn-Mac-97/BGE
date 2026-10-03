/** Authoring and simulation commands use shared game rules without altering the current run. */
import { actors, recipes, costs } from './npc-lab/definitions.js'
import { generateLoadout, validateLoadout } from './npc-lab/loadouts.js'
import { simulateDuel, evaluateLoadout } from './npc-lab/simulation.js'
import { exhaustiveBatch } from './npc-lab/exhaustive.js'
import { searchCombos } from './npc-lab/combo-search.js'
import { searchLoadouts } from './npc-lab/search.js'

export default {
  name: 'Black Bell NPC Lab', category: 'game', needs: ['Black Bell Grid'],
  onLoad(context) { context.npcLab = { generateLoadout, validateLoadout, simulateDuel, evaluateLoadout, searchLoadouts, searchCombos, exhaustiveBatch } },
  commands: [
    { id: 'npc.exhaustive', title: 'Enumerate and simulate every legal loadout', run: (context, request) => exhaustiveBatch(request) },
    { id: 'npc.discover', title: 'Discover powerful item combinations', run: (context, request) => searchCombos(request) },
    { id: 'npc.catalog', title: 'Read actor and loadout recipes', run: () => structuredClone({ actors, recipes, costs }) },
    { id: 'npc.generate', title: 'Generate a seeded loadout', run: (context, request) => generateLoadout(request) },
    { id: 'npc.validate', title: 'Validate a loadout', run: (context, request) => validateLoadout(request) },
    { id: 'npc.simulate', title: 'Simulate two loadouts', run: (context, request) => simulateDuel(request.first, request.second, request.options) },
    { id: 'npc.evaluate', title: 'Measure against reference kits', run: (context, request) => evaluateLoadout(request.candidate, request.references, request.options) },
    { id: 'npc.search', title: 'Search measured enemy loadouts', run: (context, request) => searchLoadouts(request) }
  ]
}
