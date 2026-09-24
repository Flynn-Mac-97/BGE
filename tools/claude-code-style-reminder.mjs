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

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const javascriptExtensions = new Set(['.js', '.mjs', '.cjs']);

// The rules are read from this file on every call, so the reminder cannot
// drift from it. `agents/code-style.md` is the one set of style rules.
const styleFile = 'agents/code-style.md';

// The sections a writer needs at the moment of writing. The rest is in the
// packet, and a lint rule catches most of it.
const sectionsForJavascript = ['Names', 'Functions', 'Comments'];
const sectionsForMarkdown = ['Comments'];

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

// The bullet lines under one `## ` heading of the style file.
function section(styleText, heading) {
  const start = styleText.indexOf(`## ${heading}\n`);
  if (start < 0) return '';
  const rest = styleText.slice(start + heading.length + 4);
  const end = rest.indexOf('\n## ');
  return (end < 0 ? rest : rest.slice(0, end)).trim();
}

function reminderFor(relativePath, extension) {
  const packetCall =
    `node bin/engine.mjs agent.context '{"task":"...","files":["${relativePath}"]}'`;
  const headings = extension === '.md' ? sectionsForMarkdown : sectionsForJavascript;
  const lines = [`Writing ${relativePath}. The engine's style rules apply (${styleFile}).`];
  let styleText;
  try {
    styleText = normalise(readFileSync(path.join(repositoryRoot, styleFile), 'utf8'));
  } catch {
    lines.push(`${styleFile} is missing. Read the packet for the rules.`);
  }
  if (styleText) {
    for (const heading of headings) lines.push(`${heading}:\n${section(styleText, heading)}`);
  }
  lines.push(`A project may replace these for its own files. The set that applies: ${packetCall}`);
  return lines.join('\n');
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
