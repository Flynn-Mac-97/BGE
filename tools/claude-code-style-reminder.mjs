#!/usr/bin/env node
// Claude Code PreToolUse hook. Puts the style rules in front of the agent
// before every write to a JavaScript or Markdown file.
//
// A rule read once at the start of a session decays over hours. A tool schema
// does not decay, because it is present every turn. This hook gives the style
// rules that property.
//
// Claude Code only. A Codex or local-model user gets nothing from this file;
// their rules come from the packet, `node bin/engine.mjs agent.context`.
//
// Never blocks: the output carries no permission decision. Any error exits 0
// with no output, so a broken repository cannot stop an agent working.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const javascriptExtensions = new Set(['.js', '.mjs', '.cjs']);

// The summary below is written from these two documents. The hashes prove it
// still matches them. On a mismatch the hook sends the changed document whole,
// so a stale summary can never be the only thing the agent sees.
const styleDocumentHashes = {
  'agents/comment-style.md': '9f45f405a0183736',
  'agents/code-style.md': 'a1d391808d55ae86'
};

const commentRules =
  'Comments: say why, not what; short and true; no metaphor, analogy or story; ' +
  'state the rule, not the mistake that taught it; literal verbs, short words, ' +
  'active voice; cut any word doing no work; delete comments that no longer ' +
  'match the code.';

const nameRules =
  'Names: in full — `context`, not `ctx`. Plain words for what a thing does. ' +
  'One idea in one small function.';

function readHookInput() {
  return JSON.parse(readFileSync(0, 'utf8'));
}

function writtenFilePath(hookInput) {
  const toolInput = hookInput.tool_input;
  if (!toolInput) return null;
  return toolInput.file_path || toolInput.notebook_path || null;
}

function normalise(text) {
  return text.replace(/\r/g, '').trim();
}

function shortHash(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

// A document that cannot be read, or that no longer matches its recorded hash,
// is returned whole. Silence here would read as "there is no more law".
function driftedStyleDocuments() {
  const drifted = [];
  for (const [relativePath, recordedHash] of Object.entries(styleDocumentHashes)) {
    let text;
    try {
      text = normalise(readFileSync(path.join(repositoryRoot, relativePath), 'utf8'));
    } catch {
      drifted.push(`${relativePath} is missing. The summary above may be wrong.`);
      continue;
    }
    if (shortHash(text) !== recordedHash) {
      drifted.push(`${relativePath} changed after this summary was written. Full text:\n\n${text}`);
    }
  }
  return drifted;
}

function reminderFor(relativePath, extension) {
  const packetCall =
    `node bin/engine.mjs agent.context '{"task":"...","files":["${relativePath}"]}'`;
  const lines = [`Writing ${relativePath}. The engine's style rules apply.`];
  if (extension === '.md') {
    lines.push(`${commentRules} (agents/comment-style.md)`);
  } else {
    lines.push(`${commentRules} (agents/comment-style.md)`);
    lines.push(`${nameRules} (agents/code-style.md)`);
  }
  lines.push(`A project may replace these for its own files. The set that applies: ${packetCall}`);
  return lines.concat(driftedStyleDocuments()).join('\n');
}

function main() {
  const hookInput = readHookInput();
  const writtenPath = writtenFilePath(hookInput);
  if (!writtenPath) return;

  const extension = path.extname(writtenPath).toLowerCase();
  if (extension !== '.md' && !javascriptExtensions.has(extension)) return;

  const relativePath = path.relative(repositoryRoot, path.resolve(writtenPath));
  // A file outside this repository is governed by some other project's rules.
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) return;

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: reminderFor(relativePath.replace(/\\/g, '/'), extension)
    }
  }));
}

try {
  main();
} catch {
  // Fail open and stay quiet.
}
