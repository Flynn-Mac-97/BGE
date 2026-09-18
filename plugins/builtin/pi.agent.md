---
description: Driving the pi coding agent in this checkout — the context and skill files it reads, one-shot flags, and project trust. Use when running pi as a sub-agent, changing .pi settings or skills, or checking a pi flag before trusting it.
match: .pi/**
triggers: pi agent, pi harness, pi coding agent, pi-coding-agent, pi skills, pi extension, pi settings
category: harnesses
---

# Pi

What this project needs to drive `pi`. Checked against **0.85.1**, 2026-09-18.
Run `pi --help` before trusting an old line.

## What it reads

- Context files: `AGENTS.md` or `CLAUDE.md`, walking up from the working
  directory, plus `~/.pi/agent/AGENTS.md`. An `AGENTS.override.md` in a
  directory replaces both there.
- `AGENTS.md` is generated from `agents/bootstrap.md`; `CLAUDE.md` carries the
  same text. `node bin/engine.mjs check` holds both to the source.
- Skills: `~/.pi/agent/skills/`, `~/.agents/skills/`, the project's `.pi/skills/`
  and `.agents/skills/`, packages, the `skills` setting, and `--skill <path>`.
- `.pi/settings.json` sets `"skills": ["../.claude/skills"]`, so pi lists the
  engine's generated `glass-*` skills. `node bin/engine.mjs agent.skills`, or a
  dev-server start, rewrites them from the guides.

## Project trust

`.pi/settings.json` is a project resource. An interactive start asks before it
loads. A non-interactive run (`-p`, `--mode json`) ignores it unless
`--approve` (`-a`) is passed or `defaultProjectTrust` is `"always"` in
`~/.pi/agent/settings.json`. Without trust pi runs with no project settings and
no `glass-*` skills, and says nothing — the listing is short and reads complete.

## One-shot

```sh
pi -p --approve "<task>"
```

`-p` prints the response and exits. Piped stdin merges into the prompt.

`--mode json` writes every session event as one JSON object per line, not one
envelope. The final assistant message is the last `message_end`, or `messages`
on `agent_end`.

## Flags that matter

- `--model provider/id[:level]`, and `--thinking off|minimal|low|medium|high|xhigh|max`.
- `--tools <list>` / `--exclude-tools <list>` — comma lists, built-in and extension tools alike.
- `--skill <path>` adds one; `--no-skills` and `--no-context-files` turn discovery off.
- `--extension <path>` loads an extension; `--no-session` stays out of history.
- `--session-dir <dir>` chooses where sessions are stored.

## Windows

npm installs a `pi.cmd` shim. `spawn('pi')` gives ENOENT and `spawn('pi.cmd')`
throws EINVAL. Spawn `node <npm-prefix>/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js`,
or use `cmd.exe /d /s /c` with `windowsVerbatimArguments`.
