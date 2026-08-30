# CLI and tool work

## Writing or updating an instruction

- Write the rule an agent must follow, in imperative form. Never include the
  mistake, run, or incident that taught it — history goes in git and the pain
  ledger, and a retold mistake is paid for on every packet and primes the
  failure it describes.
- Distill: one insight becomes one or two sentences of rule, not a paragraph
  of context.
- Update the existing node or file; do not add a second one about the same job.
- After editing, check what a real task pulls:
  `node bin/engine.mjs agent.context '{"task":"...","files":["..."]}'`.

- Read-only commands must work without a browser.
- Keep JSON output small and stable.
- Exit `0` for success, `1` for failure, and `2` when no editor is attached.
- Use the browser only to inspect drawing or live editor state.
- Use git only in the CLI layer.

## The folder rule for tools

The same split plugins follow: **the machinery is the engine's, the art
direction is the game's.**

- `tools/lib/` — anything a second game would want. Seeded random, noise, colour,
  PNG and WAV encoding, seam checks. No game nouns.
- `tools/make-<game>-<thing>.mjs` — what *this* game's surfaces look like. Its
  palette, its structures, its list. Name the game here; that is the point.
- **Look in `tools/lib/` before writing a generator.** It already holds the
  random, noise, colour, and encoding helpers. Copies drift, and a fix lands in
  only one of them.
- Extract when you copy the second time, not the third. A tool is a small file:
  moving a helper costs minutes, and the next agent pays for every copy.
- Prove an extraction by regenerating and diffing the output. Same bytes, or it
  was not a refactor.
- Before writing a generator at all, read `agents/art.md` — a generator is the
  most expensive row in the table, and it is only right when you can say what a
  downloaded or generated asset would get wrong.
