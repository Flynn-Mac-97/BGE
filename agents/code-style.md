# Code style

The one set of rules for how code and comments are written here. Every packet
carries it. `node bin/engine.mjs check` enforces each rule marked *(checked)*
over `engine/**`, `test/core/**` and the gate's own scripts; a reviewer holds
the rest.

## Work

- Write the intent as one testable sentence before the code. If you cannot, it is research, not a change.
- A metric shows where to look. A requirement and its check say when you are done.
- Choose where the change lands before you edit. Never grow the central function.
- Add a case as a new unit or a new table entry, not a new branch in a hub.
- Abstract at the second real use, with both callers in hand. Two similar lines are fine.
- Write the least code: no unasked feature, no single-use abstraction, no handling of impossible cases.
- Delete unused parameters, options and branches.
- Every changed line traces to the request.
- Search for a helper before you write one. *(checked: no duplicated code)*

## Names

- Full words: `context`, not `ctx`; `entity`, not `e`; `index`, not `i`. Only `x`, `y`, `z`, `id`, `ui`, `fs` and `os` are shorter. *(checked)*
- No placeholder names such as `data`, `info` or `manager`. *(checked: the list in `eslint.config.mjs`)*
- A name makes sense outside its file: qualify a generic noun with its domain.
- Name the result, not the method: not `handle`, `process` or `do`.
- One word for one idea, everywhere.
- A true/false name reads as a question: `isOpen`, `hasBody`.

## Functions

- One job. A function directs work or does work, not both.
- Handle edge cases first and return; keep the main path flat. *(checked: depth 4, no `else` after `return`)*
- No true/false flag parameter: write two named functions. *(checked)*
- Return one shape. Pick one empty value, not `null` on one path and `[]` on another.

## Data

- One factory for each record shape. Do not repeat an object literal.
- Build a record whole. Do not add it and change it later.
- Use one `kind` field, not several true/false fields that can disagree.
- The record shape is the contract. Write it down. Change it on purpose and update every reader.

## Branching

- Use a lookup table, not a ladder: no `switch`, and at most one `else if`. *(checked)*

## Architecture

- Plain records, and functions over them. Prefer `data → data` to objects that change themselves.
- Side effects at the edges: file access, the wall clock and random stay in the shell. Game logic uses engine time and `context.random`.
- A class only for state with a rule it must keep. Compose; never inherit.
- Dependencies go one way. No observers and no links both ways. Two things that must connect share records, joined by a function. *(checked: the event bus files in `eslint.config.mjs` are the only exception, and the plugin rewrite removes them)*
- No import cycles. *(checked)*
- The kernel imports nothing outside itself except packages. *(checked)*
- Make a module deep: a small interface over much behaviour. Before you add a parameter or method, ask if the interface can shrink.
- If deleting a module only moves its code into its callers, it is a pass-through. Do not add one.
- Put an interface between two implementations only when both are real.
- Test through the interface.

## Comments

- A comment says what the code cannot: why, a contract, a limit, an order that matters. If a reader can see it in the code, delete it.
- `/** */` above each module and each export: its contract. *(checked for exports)* `//` inside a body: the reason.
- Short and true. Delete a comment that no longer matches the code.
- No metaphor, analogy or story. State the fact and the reason, not the mistake that taught it.
- Literal verbs: a file is in a directory, a value is stored. *(checked: "lives" and "sits")*
- Active voice, short words. Write for the weakest reader.

## Project files

A project may replace these rules for its own files, with a manifest node that
overrides `code-style`.
