# Which folder — capability is the engine's, rules are the game's

Building a game and need something the engine does not have — a 2D trigger,
damage, a minimap, pathfinding? **Write it as a builtin, not as game code.** The
next game needs it too, and a capability written inside one game has to be found
and rebranded before anyone else can use it.

- `plugins/builtin/` — anything another game would want. `<project>/plugins/` — this game's rules.
- The test: *would a second game want this, and would you have to rename it first?* If yes, it is a builtin.
- **A project plugin SHOULD be game-branded.** Call it `Buy Menu`, `Bomb`, `Radar`; say bombsite, terrorist, headshot. It speaks its game's language, and stripping that out would make it worse. Only a builtin has to stay neutral.
- Do not promote a project plugin just because it sounds generic. `Damage` and `Bot Navigation` read generic and are full of one game's rules; the cost of pulling those apart is real and the benefit is not. Promote when a second game actually needs it.
- Check the known gaps in `docs/design.md` before writing. If it is listed there, it is engine work you happen to be doing from a game.
- Name it for what it does: `Damage`, `Trigger Volume`, `Minimap`. Never for the game.
- No game nouns in a builtin — no team, weapon, map or character names, and no number tuned to one game. Those come from the level or the type.
- Behaviour is the engine's, data is the game's. A builtin reads its numbers; it does not hold them.
- Writing the game's name inside a builtin means one of two things: wrong folder, or a game-specific part that has to come out as configuration.
- Promoting a project plugin: move the `.js` and its `.agent.md`, strip the game nouns, turn its constants into properties, and leave the game's own tuning behind in the project.
