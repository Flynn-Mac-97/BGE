---
name: glass-choice-screen
description: Choice Screen — Stops the world and offers a row of cards to pick from. `context.choiceScreen.offer({ title, subtitle, options, onPick })`. An option is `{ id, title, line, glyph, rank, tag, color ...
---
<!-- generated from plugins/builtin/choice-screen.agent.md at server start; edits are lost -->

# Choice Screen

- Stops the world and offers a row of cards to pick from.
- `context.choiceScreen.offer({ title, subtitle, options, onPick })`.
  An option is `{ id, title, line, glyph, rank, tag, color }` — `line` is the one
  sentence saying what it does.
- Offers **queue**. Three level-ups at once means three choices in a row, not one.
- The pause is `loop.hold('choice-screen')`: the clock stops, every system still
  runs with a step of zero seconds, so the screen draws and the keys are read.
  Released the moment the queue empties.
- Keys: `1`–`9` take a card, `←` `→` move, Enter or Space confirms. Every path
  ends at `pick(index)`, so a bot and a player play the same game.
- Reads: `.isOpen` `.waiting` `.view()`; `cancel()` drops everything unanswered
  and gives the world back — call it on death.
- Announces `choice:offered`, `choice:picked`, `choice:closed`.
- Commands: `choice.show`, `choice.pick <number>`.
- Draws through **Screen**; without it the offer still queues, holds and picks.
