#!/usr/bin/env node
/**
 * dsh-agent — one-shot DeepSeek Harness agent, the subagent interface for
 * external orchestrators (Claude Code, scripts, CI).
 *
 * Wraps `dsh --profile headless "<task>"`: boots a fresh persisted Agent,
 * submits the task as an ordinary user message, waits for quiescence, prints
 * the final assistant text to stdout, and exits 0 on completion / 1 on error.
 * Adds orchestration ergonomics the bare CLI lacks: JSON envelopes, cwd,
 * timeout, permission mode, and model override.
 *
 * Usage:
 *   dsh-agent "task"                           run; print final text; exit 0/1
 *   dsh-agent --json "task"                    run; print a JSON envelope
 *   dsh-agent --cwd <dir> "task"               run with that working directory
 *   dsh-agent --timeout <seconds> "task"       abort after N seconds (exit 124)
 *   dsh-agent --permission-mode <mode> "task"  read-only | workspace-write | danger-full-access
 *   dsh-agent --model <name> "task"            override the model (default: the harness's own, deepseek-flash)
 *   dsh-agent --help
 *
 * Exit codes: 0 completed, 1 agent error / unexpected failure, 2 usage error,
 * 124 timed out.
 *
 * The task text is the remaining positional arguments joined by spaces — quote
 * it when it contains spaces: dsh-agent "run the tests".
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const WRAPPER_DIR = dirname(fileURLToPath(import.meta.url));
// The dsh app package sits at <npm-bin>/node_modules/@deepseek-ai/dsh when this
// wrapper lives in the npm global bin. Also probe relative to the wrapper and
// resolve the `dsh` shim on PATH (dsh.cmd on Windows, dsh elsewhere) so the
// wrapper works from a repo checkout too.
function resolveDshBin() {
  const candidates = [
    join(WRAPPER_DIR, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"),
    join(WRAPPER_DIR, "..", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"),
    join(WRAPPER_DIR, "..", "..", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js")
  ];
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  const shimNames = process.platform === "win32" ? ["dsh.cmd", "dsh.bat", "dsh"] : ["dsh"];
  for (const dirEntry of (process.env.PATH ?? "").split(";").filter(Boolean)) {
    for (const shimName of shimNames) {
      const shim = join(dirEntry, shimName);
      if (!existsSync(shim)) continue;
      for (const candidate of [
        join(dirEntry, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"),
        join(dirEntry, "..", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js")
      ]) if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}
const DSH_BIN = resolveDshBin();
const DEFAULT_PERMISSION_MODE = "workspace-write";
const VALID_PERMISSION_MODES = new Set(["read-only", "workspace-write", "danger-full-access"]);

function usage(stream, error) {
  const message = [
    error ?? "",
    "Usage: dsh-agent [options] \"task\"",
    "",
    "Options:",
    "  --json                    print a JSON envelope instead of raw text",
    "  --cwd <dir>               working directory for the agent (default: current dir)",
    "  --timeout <seconds>       abort the run after N seconds (exit 124)",
    "  --permission-mode <mode>  read-only | workspace-write | danger-full-access",
    "  --model <name>            override the model (default: the harness default, deepseek-flash)",
    "  --task-file <path>        read the task from a file, for a task past the command line limit",
    "  --help                    show this help",
    "",
    "Examples:",
    '  dsh-agent "run the tests and report failures"',
    '  dsh-agent --json --cwd "C:\\repo" "fix the failing test in engine/foo.test.js"',
    '  dsh-agent --permission-mode danger-full-access "refactor engine/render.js"'
  ].filter(Boolean).join("\n");
  stream.write(message + "\n");
}

function usageError(message) {
  usage(process.stderr, message);
  process.exit(2);
}

/** Resolve $DSH_HOME the same way the harness does. */
function dshHome() {
  return process.env.DSH_HOME || join(homedir(), ".dsh");
}

/**
 * Best-effort session discovery: the headless runner creates
 * session-<uuid> dirs under $DSH_HOME/sessions/<workspace-slug>/. Snapshot
 * before the run, diff after, return the newest new one.
 */
function sessionDirsSnapshot() {
  const sessionsRoot = join(dshHome(), "sessions");
  const found = [];
  let entries;
  try {
    entries = readdirSync(sessionsRoot, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const slugDir = join(sessionsRoot, entry.name);
    let children;
    try {
      children = readdirSync(slugDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const child of children) {
      if (!child.isDirectory() || !child.name.startsWith("session-")) continue;
      const dir = join(slugDir, child.name);
      let mtimeMs;
      try {
        mtimeMs = statSync(dir).mtimeMs;
      } catch {
        continue;
      }
      found.push({ dir, name: child.name, mtimeMs });
    }
  }
  return found;
}

function newestSession(snapshotBefore, snapshotAfter, startedAtMs) {
  const before = new Set(snapshotBefore.map((s) => s.dir));
  return snapshotAfter
    .filter((s) => !before.has(s.dir) && s.mtimeMs >= startedAtMs - 5000)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
}

/**
 * Write a temporary --patch overlay overriding the agent's default model.
 * The launcher applies --patch files after the profile layer, so a later
 * agent-default-model config wins over dsh-base's.
 */
function writeModelPatch(provider, model) {
  const patchPath = join(tmpdir(), `dsh-agent-model-${process.pid}-${Date.now()}.yml`);
  writeFileSync(patchPath, `- id: agent-default-model
  config:
    provider: ${provider}
    model: ${model}
`, "utf8");
  return patchPath;
}

function parseArgs(argv) {
  const options = {
    json: false,
    cwd: process.cwd(),
    timeoutSeconds: 0,
    permissionMode: DEFAULT_PERMISSION_MODE,
    provider: "deepseek-official",
    model: undefined,
    taskFile: undefined,
    task: []
  };
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--help":
      case "-h":
        help = true;
        break;
      case "--json":
        options.json = true;
        break;
      case "--cwd":
        options.cwd = argv[++i];
        if (options.cwd === undefined) usageError("error: --cwd needs a directory");
        break;
      case "--timeout":
        options.timeoutSeconds = Number(argv[++i]);
        if (!Number.isFinite(options.timeoutSeconds) || options.timeoutSeconds <= 0) {
          usageError("error: --timeout needs a positive number of seconds");
        }
        break;
      case "--permission-mode":
        options.permissionMode = argv[++i];
        if (!VALID_PERMISSION_MODES.has(options.permissionMode)) {
          usageError(`error: unknown permission mode ${JSON.stringify(options.permissionMode)}`);
        }
        break;
      case "--model":
        options.model = argv[++i];
        if (options.model === undefined) usageError("error: --model needs a model name");
        break;
      case "--task-file":
        options.taskFile = argv[++i];
        if (options.taskFile === undefined) usageError("error: --task-file needs a path");
        break;
      case "--provider":
        options.provider = argv[++i];
        if (options.provider === undefined) usageError("error: --provider needs a provider name");
        break;
      default:
        options.task.push(arg);
    }
  }
  return { options, help };
}

async function main() {
  const { options, help } = parseArgs(process.argv.slice(2));
  if (help) {
    usage(process.stdout);
    process.exit(0);
  }
  // Windows caps a command line at about 32767 characters, so a long task is
  // handed over as a file instead of an argument.
  const task = options.taskFile ? readFileSync(options.taskFile, "utf8") : options.task.join(" ");
  if (task.trim() === "") usageError("error: a task is required, for example: dsh-agent \"run the tests\"");
  if (!existsSync(options.cwd)) usageError(`error: --cwd directory does not exist: ${options.cwd}`);
  if (!DSH_BIN) usageError(`error: cannot locate dsh lib/bin.js near ${WRAPPER_DIR}; is @deepseek-ai/dsh installed?`);

  const startedAtMs = Date.now();
  const sessionBefore = sessionDirsSnapshot();

  const args = ["--profile", "headless"];
  const patchFiles = [];
  if (options.model !== undefined) {
    patchFiles.push(writeModelPatch(options.provider, options.model));
  }
  for (const patch of patchFiles) args.push("--patch", patch);
  args.push(task);

  const env = {
    ...process.env,
    DSH_PERMISSION_MODE: options.permissionMode
  };

  const child = spawn(process.execPath, [DSH_BIN, ...args], {
    cwd: options.cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  const timeoutMs = options.timeoutSeconds > 0 ? options.timeoutSeconds * 1000 : 0;
  let timedOut = false;
  const timer = timeoutMs > 0 ? setTimeout(() => {
    timedOut = true;
    child.kill();
  }, timeoutMs) : null;

  const exitCode = await new Promise((resolve) => {
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", (error) => {
      stderr += `dsh-agent: failed to spawn dsh: ${error.message}\n`;
      resolve(1);
    });
  });

  if (timer !== null) clearTimeout(timer);
  for (const patch of patchFiles) {
    try { rmSync(patch, { force: true }); } catch { /* best effort */ }
  }

  const text = stdout.trimEnd();
  const session = newestSession(sessionBefore, sessionDirsSnapshot(), startedAtMs);
  const durationMs = Date.now() - startedAtMs;

  if (options.json) {
    const envelope = {
      ok: !timedOut && exitCode === 0,
      status: timedOut ? "timeout" : exitCode === 0 ? "completed" : "error",
      exitCode: timedOut ? 124 : exitCode,
      text,
      error: stderr.trim() || null,
      sessionId: session?.name ?? null,
      sessionDir: session?.dir ?? null,
      durationMs,
      task
    };
    process.stdout.write(JSON.stringify(envelope, null, 2) + "\n");
    process.exit(envelope.exitCode);
  }

  if (text !== "") process.stdout.write(text + "\n");
  if (stderr.trim() !== "") process.stderr.write(stderr);
  process.exit(timedOut ? 124 : exitCode);
}

main().catch((error) => {
  process.stderr.write(`dsh-agent: unexpected failure: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
