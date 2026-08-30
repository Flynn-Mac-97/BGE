#!/usr/bin/env node
// Claude Code SessionStart and SubagentStart hook. Puts the engine's always-on
// rules in context when a session opens, before the agent chooses to fetch
// them.
//
// The text comes from `node bin/engine.mjs agent.context`, so whatever the
// manifest marks always-on arrives here. Widening the always-on set needs no
// change to this file.
//
// SessionStart also fires after a compaction, which is where rules are lost,
// so the same call restores them.
//
// Claude Code only. A Codex or local-model user gets nothing from this file;
// their rules come from the packet directly.
//
// Any error exits 0 with no output, so a broken engine cannot stop a session
// opening.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const supportedEvents = new Set(['SessionStart', 'SubagentStart']);

// A node is also selected when the task text contains one of its trigger
// words, matched as a substring. "start" holds "art" and would pull the art
// rules in, so the task says none of them.
const packetTask = 'load the always-on rules';

function readHookInput() {
  return JSON.parse(readFileSync(0, 'utf8'));
}

function alwaysOnRules() {
  const reply = execFileSync(
    process.execPath,
    ['bin/engine.mjs', 'agent.context', JSON.stringify({ task: packetTask })],
    { cwd: repositoryRoot, encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] }
  );
  const text = JSON.parse(reply).text;
  if (typeof text !== 'string') return '';
  // Drop the packet's Task heading. The task above is this hook's, not the
  // agent's, and stating it would mislead.
  return text.replace(/^# Task\n\n[\s\S]*?\n\n(?=# )/, '').trim();
}

function main() {
  const hookInput = readHookInput();
  const eventName = hookInput.hook_event_name;
  if (!supportedEvents.has(eventName)) return;

  const rules = alwaysOnRules();
  if (!rules) return;

  const heading =
    'Rules for this workspace, from `node bin/engine.mjs agent.context`. ' +
    'They apply to every task here.';

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: eventName,
      additionalContext: `${heading}\n\n${rules}`
    }
  }));
}

try {
  main();
} catch {
  // Fail open and stay quiet.
}
