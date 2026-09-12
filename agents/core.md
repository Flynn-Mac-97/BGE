# Shared rules

- Files on disk are true. Do not add a save-only copy.
- Use plain, exact names. Say what a thing does.
- Keep instructions short. Put one rule in one sentence.
- Preserve work you did not make.
- Write scratch files and run output in agent-runs/, never at the root. Nothing there is committed and `agent.sweep` deletes it after a week.
- A finding that must outlive the run goes in the pain ledger, the insight ledger, the guide it is about, or a test. Never a new markdown file.
- Write a test only for a behaviour that would break silently. A one-off proof is scratch and is deleted.
- One writer may use the current workspace. Parallel writers need separate git worktrees.
- Run every check named in your task packet.
- Before solving something hard, check whether it is solved: `node bin/engine.mjs insight.list <words>`.
- Record engine friction: `node bin/engine.mjs pain "<what was hard>" --cost <tokens>`.
- Record a solution worth reusing: `node bin/engine.mjs insight "<what worked>" --problem "<when to use it>" --saves <tokens>`.
