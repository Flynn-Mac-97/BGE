# Writing the guide

- Keep authored rules in the guide. Read the generated interface in
  `<plugin>.agent/interface.generated.md`; do not edit it. The server refreshes
  it on plugin edits, and packet creation refreshes a stale file before it
  includes it.
- Check command arguments and declared schemas in the interface. Follow detail
  links for usage and limits. If an interface is unavailable or a declaration is
  dynamic, read the named source before calling the command.
- `<plugin>.agent.md` is the prose: what it owns, what it refuses, when to reach
  for it. Keep it under 3000 characters.
- `<plugin>.agent/<topic>.md` holds the detail: argument tables, worked
  examples, edge cases, troubleshooting. One file per topic.
- End the guide with a `## Detail` index naming each file and what it answers, so
  an agent opens only the one its task needs.
- `plugin.sizes` names every guide over the limit.

# About and determinism

- `about` is optional; `plugin.facts` derives one. `inspect` is sections of
  `{ title, rows }`.
- Use engine time, random and timers; a plugin must not break determinism.
- Editing a plugin reloads the page. Reconnect before testing it.
- Declare `match:` on the guide when it applies beyond its own plugin.
