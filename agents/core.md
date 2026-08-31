# Shared rules

- Files on disk are true. Do not add a save-only copy.
- Use plain, exact names. Say what a thing does.
- Keep instructions short. Put one rule in one sentence.
- Preserve work you did not make.
- Write scratch files and run output in agent-runs/, never at the root.
- One writer may use the current workspace. Parallel writers need separate git worktrees.
- Run every check named in your task packet.
- Before solving something hard, check whether it is solved: `node bin/engine.mjs insight.list <words>`.
- Record engine friction: `node bin/engine.mjs pain "<what was hard>" --cost <tokens>`.
- Record a solution worth reusing: `node bin/engine.mjs insight "<what worked>" --problem "<when to use it>" --saves <tokens>`.
