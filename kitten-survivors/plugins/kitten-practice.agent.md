# Kitten Practice

- Straw kittens to hit while the horde lane is still building the real ones. Nothing here runs on its own — both verbs are commands.
- `kitten.dummies 8` stands a ring of targets around the player; `kitten.clear` takes them away.
- `kitten.proof '[10, 8]'` is the evidence command: it stands eight targets up, runs ten seconds of simulation, and answers with what died, which weapon did it, how much damage each dealt, and how many numbers and impacts were produced.
- Kills are counted off the bus, not by comparing entity lists, because a body lingers before it is removed and would otherwise be counted as a survivor.
- Run it with no dev server and no screen:
  `node bin/engine.mjs --headless --project kitten-survivors run kitten.proof '[10, 8]'`
- Delete this file and the game is unchanged.
