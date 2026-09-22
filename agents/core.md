# Shared rules

- Files on disk are true; no save-only copy. Plain, exact names; one rule per sentence.
- Change only what the task needs; preserve work you did not make.
- Name both readings of an ambiguous request and the simpler route, then ask. Write the least code.
- Turn the task into a runnable check; loop until it passes.
- Scratch goes in agent-runs/, never the root. A finding that outlives the run goes in a ledger, guide or test.
- Test only behaviour that would break silently. A fan-out is a by-hand tool under `tools/`.
- One writer per workspace; parallel writers need worktrees.
- Run every check your packet names. Search `insight.list`; record `pain` and `insight`.
- Improve the engine while building games: make small compatible fixes directly, with a reproduction, regression check, and owning-guide update. Ask before breaking changes, new dependencies, migrations, or broad redesigns.
- Use `evolve <id or words>` for relevant friction or one milestone review; follow `docs/evolution.md`. Keep unrelated engine work out of the game task.
