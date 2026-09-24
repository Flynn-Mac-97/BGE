// src/contract/clone-evidence.ts
import { z as z3 } from "zod";

// src/contract/finding.ts
import { z as z2 } from "zod";

// src/contract/primitives.ts
import { z } from "zod";
var dottedIdSchema = z.string().regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/, "must be a dotted identifier (lowercase segments joined by '.')");
function isRepoRelativePath(path) {
  if (path.length === 0 || path.startsWith("/") || path.includes("\\"))
    return false;
  if (/^[A-Za-z]:/.test(path))
    return false;
  return path.split("/").every((segment) => segment.length > 0 && segment !== "..");
}
var relativePathSchema = z.string().min(1).refine(isRepoRelativePath, "must be a repo-relative POSIX path");
var versionStringSchema = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/, "must be a semantic version (X.Y.Z with optional prerelease suffix)");
var finiteNumberSchema = z.number().finite();

// src/contract/finding.ts
var positionSchema = z2.strictObject({
  line: z2.number().int().min(1),
  column: z2.number().int().min(1).optional()
});
var rangeSchema = z2.strictObject({
  start: positionSchema,
  end: positionSchema
}).superRefine((range, ctx) => {
  if (range.end.line < range.start.line) {
    ctx.addIssue({
      code: "custom",
      message: "range end must not precede range start",
      path: ["end"]
    });
    return;
  }
  if (range.end.line === range.start.line && range.start.column !== undefined && range.end.column !== undefined && range.end.column < range.start.column) {
    ctx.addIssue({
      code: "custom",
      message: "range end column must not precede start column on the same line",
      path: ["end", "column"]
    });
  }
});
var findingSchema = z2.strictObject({
  kind: dottedIdSchema,
  path: relativePathSchema,
  range: rangeSchema,
  summary: z2.string().min(1),
  facts: z2.record(z2.string(), z2.unknown()).optional()
});

// src/contract/clone-evidence.ts
var CLONE_MATCH_MODES = ["exact", "normalized", "near"];
var cloneMatchModeSchema = z3.enum(CLONE_MATCH_MODES);
var cloneLocationSchema = z3.strictObject({
  path: relativePathSchema,
  range: rangeSchema
});
function compareCloneLocations(a, b) {
  if (a.path !== b.path) {
    return a.path < b.path ? -1 : 1;
  }
  if (a.range.start.line !== b.range.start.line) {
    return a.range.start.line - b.range.start.line;
  }
  const aColumn = a.range.start.column ?? 0;
  const bColumn = b.range.start.column ?? 0;
  if (aColumn !== bColumn) {
    return aColumn - bColumn;
  }
  return a.range.end.line - b.range.end.line;
}
var clonePairSchema = z3.strictObject({
  kind: z3.literal("pair"),
  matchMode: cloneMatchModeSchema,
  members: z3.tuple([cloneLocationSchema, cloneLocationSchema])
}).superRefine((pair, ctx) => {
  const [first, second] = pair.members;
  if (compareCloneLocations(first, second) === 0) {
    ctx.addIssue({
      code: "custom",
      message: "a clone pair's members must be two distinct locations",
      path: ["members"]
    });
    return;
  }
  if (compareCloneLocations(first, second) > 0) {
    ctx.addIssue({
      code: "custom",
      message: "clone pair members must be in deterministic location order",
      path: ["members"]
    });
  }
});
var groupMatchModeSchema = cloneMatchModeSchema.exclude(["near"]);
var cloneGroupEvidenceSchema = z3.strictObject({
  kind: z3.literal("group"),
  matchMode: groupMatchModeSchema,
  members: z3.array(cloneLocationSchema).min(2)
}).superRefine((group, ctx) => {
  for (let i = 1;i < group.members.length; i++) {
    const previous = group.members[i - 1];
    const current = group.members[i];
    if (previous === undefined || current === undefined) {
      continue;
    }
    if (compareCloneLocations(previous, current) >= 0) {
      ctx.addIssue({
        code: "custom",
        message: "clone group members must be distinct and in deterministic location order",
        path: ["members", i]
      });
      return;
    }
  }
});
var cloneEvidenceSchema = z3.discriminatedUnion("kind", [
  clonePairSchema,
  cloneGroupEvidenceSchema
]);

// src/syntax/functions.ts
import ts2 from "typescript";

// src/syntax/parse.ts
import ts from "typescript";
function scriptVariantForPath(path) {
  if (/\.(?:js|mjs|cjs)$/.test(path))
    return "js";
  return path.endsWith(".tsx") ? "tsx" : "ts";
}
function positionAt(sourceFile, pos) {
  const { line, character } = ts.getLineAndCharacterOfPosition(sourceFile, pos);
  return { line: line + 1, column: character + 1 };
}
function rangeAt(sourceFile, startPos, endPos) {
  return { start: positionAt(sourceFile, startPos), end: positionAt(sourceFile, endPos) };
}
function toDiagnostic(sourceFile, path, diagnostic) {
  const start = diagnostic.start;
  const length = diagnostic.length ?? 0;
  return {
    path,
    range: rangeAt(sourceFile, start, start + length),
    code: `TS${diagnostic.code}`,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, `
`)
  };
}
function parseDiagnosticsOf(sourceFile) {
  return sourceFile.parseDiagnostics ?? [];
}
function parseSource(path, text) {
  const scriptKind = scriptVariantForPath(path);
  const sourceFile = ts.createSourceFile(path, text, ts.ScriptTarget.ESNext, true, scriptKind === "js" ? ts.ScriptKind.JS : scriptKind === "tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  return {
    sourceFile,
    scriptKind,
    diagnostics: parseDiagnosticsOf(sourceFile).map((diagnostic) => toDiagnostic(sourceFile, path, diagnostic))
  };
}

// src/syntax/functions.ts
var FUNCTION_LIKE_KINDS = new Map([
  [ts2.SyntaxKind.FunctionDeclaration, "function-declaration"],
  [ts2.SyntaxKind.FunctionExpression, "function-expression"],
  [ts2.SyntaxKind.ArrowFunction, "arrow-function"],
  [ts2.SyntaxKind.MethodDeclaration, "method"],
  [ts2.SyntaxKind.Constructor, "constructor"],
  [ts2.SyntaxKind.GetAccessor, "get-accessor"],
  [ts2.SyntaxKind.SetAccessor, "set-accessor"]
]);
function asFunctionLike(node) {
  const kind = FUNCTION_LIKE_KINDS.get(node.kind);
  return kind === undefined ? null : { kind, fn: node };
}
function propertyNameText(name) {
  if (name === undefined)
    return;
  if (ts2.isIdentifier(name) || ts2.isPrivateIdentifier(name))
    return name.text;
  if (ts2.isStringLiteral(name) || ts2.isNumericLiteral(name))
    return name.text;
  return;
}
function contextualName(node) {
  const parent = node.parent;
  if (ts2.isVariableDeclaration(parent) && ts2.isIdentifier(parent.name))
    return parent.name.text;
  if (ts2.isPropertyAssignment(parent))
    return propertyNameText(parent.name);
  return;
}
function nameOf(kind, fn) {
  if (kind === "constructor")
    return { name: "constructor", nameOrigin: "declared" };
  if (!ts2.isArrowFunction(fn)) {
    const declared = propertyNameText(fn.name);
    if (declared !== undefined)
      return { name: declared, nameOrigin: "declared" };
  }
  const contextual = contextualName(fn);
  if (contextual !== undefined)
    return { name: contextual, nameOrigin: "contextual" };
  return { name: "(anonymous)", nameOrigin: "anonymous" };
}
function addFunction(state, pending, kind, fn, body) {
  const { name, nameOrigin } = nameOf(kind, fn);
  const parentIndex = state.stack.length === 0 ? null : state.stack[state.stack.length - 1] ?? null;
  state.facts.push({
    kind,
    name,
    nameOrigin,
    node: fn,
    range: rangeAt(state.sourceFile, fn.getStart(state.sourceFile), fn.getEnd()),
    bodyRange: rangeAt(state.sourceFile, body.getStart(state.sourceFile), body.getEnd()),
    depth: state.stack.length,
    parentIndex,
    overloadSignatures: pending.get(name) ?? 0
  });
}
function visitChildren(state, node) {
  const pending = new Map;
  for (const child of node.getChildren(state.sourceFile)) {
    const match = asFunctionLike(child);
    if (match === null) {
      visitChildren(state, child);
      continue;
    }
    const body = match.fn.body;
    if (body === undefined) {
      state.signatures += 1;
      const key = nameOf(match.kind, match.fn).name;
      pending.set(key, (pending.get(key) ?? 0) + 1);
      continue;
    }
    addFunction(state, pending, match.kind, match.fn, body);
    state.stack.push(state.facts.length - 1);
    visitChildren(state, child);
    state.stack.pop();
  }
}
function collectFunctions(sourceFile) {
  const state = { sourceFile, facts: [], stack: [], signatures: 0 };
  visitChildren(state, sourceFile);
  return { functions: state.facts, signatureCount: state.signatures };
}
function walkOwnNodes(fn, visit) {
  const sourceFile = fn.node.getSourceFile();
  const walk = (node) => {
    visit(node);
    if (node !== fn.node && asFunctionLike(node) !== null)
      return;
    for (const child of node.getChildren(sourceFile))
      walk(child);
  };
  walk(fn.node);
}
// src/syntax/inventory.ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import ts4 from "typescript";

// src/syntax/sloc.ts
import ts3 from "typescript";
var COMMENT_TRIVIA = new Set([
  ts3.SyntaxKind.SingleLineCommentTrivia,
  ts3.SyntaxKind.MultiLineCommentTrivia
]);
var PLAIN_TRIVIA = new Set([
  ts3.SyntaxKind.WhitespaceTrivia,
  ts3.SyntaxKind.NewLineTrivia,
  ts3.SyntaxKind.ShebangTrivia,
  ts3.SyntaxKind.ConflictMarkerTrivia
]);
function lineOf(lineStarts, pos) {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = lo + hi + 1 >> 1;
    if ((lineStarts[mid] ?? 0) <= pos)
      lo = mid;
    else
      hi = mid - 1;
  }
  return lo;
}
function markLines(flags, lineStarts, start, end, key) {
  const first = lineOf(lineStarts, start);
  const last = lineOf(lineStarts, Math.max(start, end - 1));
  for (let line = first;line <= last; line += 1) {
    const entry = flags[line];
    if (entry !== undefined)
      entry[key] = true;
  }
}
function classifyLines(sourceFile) {
  const lineStarts = sourceFile.getLineStarts();
  const flags = [...lineStarts].map(() => ({ code: false, comment: false }));
  const scanner = ts3.createScanner(ts3.ScriptTarget.ESNext, false, sourceFile.languageVariant, sourceFile.text);
  let token = scanner.scan();
  while (token !== ts3.SyntaxKind.EndOfFileToken) {
    if (COMMENT_TRIVIA.has(token)) {
      markLines(flags, lineStarts, scanner.getTokenStart(), scanner.getTokenEnd(), "comment");
    } else if (!PLAIN_TRIVIA.has(token)) {
      markLines(flags, lineStarts, scanner.getTokenStart(), scanner.getTokenEnd(), "code");
    }
    token = scanner.scan();
  }
  return flags.map((flag) => flag.code ? "code" : flag.comment ? "commentOnly" : "blank");
}
function countLines(sourceFile) {
  const kinds = classifyLines(sourceFile);
  const counts = { total: kinds.length, code: 0, commentOnly: 0, blank: 0 };
  for (const kind of kinds) {
    if (kind === "code")
      counts.code += 1;
    else if (kind === "commentOnly")
      counts.commentOnly += 1;
    else
      counts.blank += 1;
  }
  return counts;
}

// src/syntax/inventory.ts
var FILE_START_RANGE = {
  start: { line: 1, column: 1 },
  end: { line: 1, column: 1 }
};
async function parseClassifiedFile(root, file) {
  const text = await readFile(join(root, file.path), "utf8").catch(() => null);
  const parsed = parseSource(file.path, text ?? "");
  const { functions, signatureCount } = collectFunctions(parsed.sourceFile);
  const diagnostics = [...parsed.diagnostics];
  if (text === null) {
    diagnostics.unshift({
      path: file.path,
      range: FILE_START_RANGE,
      code: "read-error",
      message: `could not read ${file.path}; analyzed as empty`
    });
  }
  return {
    path: file.path,
    packagePath: file.packagePath,
    sourceSet: file.sourceSet,
    scriptKind: parsed.scriptKind,
    sourceFile: parsed.sourceFile,
    functions,
    lines: countLines(parsed.sourceFile),
    signatureCount,
    diagnostics
  };
}
function byLocation(a, b) {
  if (a.path !== b.path)
    return a.path < b.path ? -1 : 1;
  if (a.range.start.line !== b.range.start.line)
    return a.range.start.line - b.range.start.line;
  return (a.range.start.column ?? 1) - (b.range.start.column ?? 1);
}
async function buildSyntaxInventory(source) {
  const files = await Promise.all(source.files.map((file) => parseClassifiedFile(source.root, file)));
  const diagnostics = files.flatMap((file) => file.diagnostics).sort(byLocation);
  return {
    root: source.root,
    compilerVersion: ts4.version,
    files,
    functionCount: files.reduce((sum, file) => sum + file.functions.length, 0),
    diagnostics,
    completeness: diagnostics.length === 0 ? "complete" : "incomplete"
  };
}
// src/metrics/complexity.ts
import ts5 from "typescript";
var BRANCH_KINDS = new Set([
  ts5.SyntaxKind.IfStatement,
  ts5.SyntaxKind.ForStatement,
  ts5.SyntaxKind.ForInStatement,
  ts5.SyntaxKind.ForOfStatement,
  ts5.SyntaxKind.WhileStatement,
  ts5.SyntaxKind.DoStatement,
  ts5.SyntaxKind.CaseClause,
  ts5.SyntaxKind.CatchClause,
  ts5.SyntaxKind.ConditionalExpression
]);
var LOGICAL_OPERATORS = new Set([
  ts5.SyntaxKind.AmpersandAmpersandToken,
  ts5.SyntaxKind.BarBarToken,
  ts5.SyntaxKind.QuestionQuestionToken,
  ts5.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts5.SyntaxKind.BarBarEqualsToken,
  ts5.SyntaxKind.QuestionQuestionEqualsToken
]);
var NESTING_KINDS = new Set([
  ts5.SyntaxKind.IfStatement,
  ts5.SyntaxKind.ForStatement,
  ts5.SyntaxKind.ForInStatement,
  ts5.SyntaxKind.ForOfStatement,
  ts5.SyntaxKind.WhileStatement,
  ts5.SyntaxKind.DoStatement,
  ts5.SyntaxKind.SwitchStatement,
  ts5.SyntaxKind.TryStatement
]);
function decisionsOf(node) {
  if (BRANCH_KINDS.has(node.kind))
    return 1;
  if (ts5.isBinaryExpression(node) && LOGICAL_OPERATORS.has(node.operatorToken.kind))
    return 1;
  if ((ts5.isPropertyAccessExpression(node) || ts5.isCallExpression(node) || ts5.isElementAccessExpression(node)) && node.questionDotToken !== undefined) {
    return 1;
  }
  return 0;
}
function nestingOf(node, stop) {
  let depth = 0;
  let current = node.parent;
  while (current !== undefined && current !== stop) {
    if (NESTING_KINDS.has(current.kind))
      depth += 1;
    current = current.parent;
  }
  return depth;
}
function measureFunctionComplexity(fn) {
  let decisions = 0;
  let maxNesting = 0;
  walkOwnNodes(fn, (node) => {
    decisions += decisionsOf(node);
    const depth = nestingOf(node, fn.node);
    if (depth > maxNesting)
      maxNesting = depth;
  });
  return { cc: 1 + decisions, maxNesting };
}

// src/metrics/types.ts
var EROSION_CC_THRESHOLD = 10;

// src/metrics/erosion.ts
function functionMass(cc, sloc) {
  return cc * Math.sqrt(sloc);
}
function isEroded(cc) {
  return cc > EROSION_CC_THRESHOLD;
}
function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
function nearestRank(sortedAsc, percentile) {
  const n = sortedAsc.length;
  if (n === 0)
    return null;
  const rank = Math.max(1, Math.ceil(percentile / 100 * n));
  return sortedAsc[rank - 1] ?? null;
}
function ccDistribution(ccValues) {
  if (ccValues.length === 0)
    return null;
  const sorted = [...ccValues].sort((a, b) => a - b);
  const p50 = nearestRank(sorted, 50);
  const p90 = nearestRank(sorted, 90);
  const max = sorted[sorted.length - 1];
  if (p50 === null || p90 === null || max === undefined)
    return null;
  return { p50, p90, max };
}
function aggregateMass(files, sloc, contributions) {
  let mass = 0;
  let erodedMass = 0;
  let erodedCount = 0;
  for (const contribution of contributions) {
    mass += contribution.mass;
    if (contribution.eroded) {
      erodedMass += contribution.mass;
      erodedCount += 1;
    }
  }
  return {
    files,
    sloc,
    functionCount: contributions.length,
    mass,
    erodedMass,
    erodedCount,
    erodedShare: mass === 0 ? null : erodedMass / mass
  };
}

// src/metrics/analyze.ts
var MEASURED_SETS = ["production", "test"];
function functionSloc(lines, range) {
  let sloc = 0;
  const last = Math.min(range.end.line, lines.length);
  for (let line = range.start.line;line <= last; line += 1) {
    if (lines[line - 1] === "code")
      sloc += 1;
  }
  return sloc;
}
function measureFile(file) {
  if (file.functions.length === 0)
    return [];
  const lines = classifyLines(file.sourceFile);
  return file.functions.map((fn) => {
    const { cc, maxNesting } = measureFunctionComplexity(fn);
    const sloc = functionSloc(lines, fn.range);
    const mass = functionMass(cc, sloc);
    return {
      path: file.path,
      packagePath: file.packagePath,
      sourceSet: file.sourceSet,
      name: fn.name,
      kind: fn.kind,
      range: fn.range,
      cc,
      maxNesting,
      sloc,
      mass,
      eroded: isEroded(cc)
    };
  });
}
function packageAggregates(files, functions) {
  const packagePaths = [...new Set(files.map((file) => file.packagePath))].sort();
  return packagePaths.map((packagePath) => {
    const ownedFiles = files.filter((file) => file.packagePath === packagePath);
    const ownedFunctions = functions.filter((fn) => fn.packagePath === packagePath);
    return {
      packagePath,
      ...aggregateMass(ownedFiles.length, ownedFiles.reduce((sum, file) => sum + file.lines.code, 0), ownedFunctions)
    };
  });
}
function scopeAggregate(sourceSet, files, functions) {
  const aggregate = aggregateMass(files.length, files.reduce((sum, file) => sum + file.lines.code, 0), functions);
  return {
    sourceSet,
    ...aggregate,
    diagnosticFiles: files.filter((file) => file.diagnostics.length > 0).map((file) => file.path).sort(),
    cc: ccDistribution(functions.map((fn) => fn.cc)),
    maxNesting: functions.length === 0 ? null : Math.max(...functions.map((fn) => fn.maxNesting)),
    packages: packageAggregates(files, functions)
  };
}
function incompleteReason(scope) {
  const n = scope.diagnosticFiles.length;
  return n === 0 ? undefined : `${n} ${scope.sourceSet} file(s) produced parse diagnostics; values are partial`;
}
function stateAndValue(value, reason) {
  if (reason !== undefined) {
    return value === null ? { state: "incomplete", reason } : { state: "incomplete", value, reason };
  }
  return value === null ? { state: "not-applicable" } : { state: "complete", value };
}
function metric(id, unit, value, reason, extra) {
  return { id, unit, ...stateAndValue(value, reason), ...extra };
}
function packageDetail(scope) {
  return scope.packages.map((pkg) => ({
    packagePath: pkg.packagePath,
    functions: pkg.functionCount,
    mass: roundTo(pkg.mass, 3),
    erodedMass: roundTo(pkg.erodedMass, 3),
    erodedShare: pkg.erodedShare === null ? null : roundTo(pkg.erodedShare, 6)
  }));
}
function scopeMetrics(scope) {
  const set = scope.sourceSet;
  const reason = incompleteReason(scope);
  const share = scope.erodedShare === null ? null : roundTo(scope.erodedShare, 6);
  const metrics = [
    metric(`complexity.functions.${set}`, "count", scope.functionCount, reason, {
      detail: { files: scope.files, sloc: scope.sloc }
    }),
    metric(`complexity.cc.p50.${set}`, "cc", scope.cc?.p50 ?? null, reason),
    metric(`complexity.cc.p90.${set}`, "cc", scope.cc?.p90 ?? null, reason),
    metric(`complexity.cc.max.${set}`, "cc", scope.cc?.max ?? null, reason),
    metric(`complexity.nesting.max.${set}`, "depth", scope.maxNesting, reason),
    metric(`erosion.mass.${set}`, "mass", roundTo(scope.mass, 3), reason),
    metric(`erosion.eroded-count.${set}`, "count", scope.erodedCount, reason),
    metric(`erosion.eroded-share.${set}`, "ratio", share, reason, {
      ...scope.mass === 0 ? {} : {
        numerator: roundTo(scope.erodedMass, 3),
        denominator: roundTo(scope.mass, 3)
      },
      detail: { thresholdCc: EROSION_CC_THRESHOLD, packages: packageDetail(scope) }
    })
  ];
  return metrics;
}
function byHotspotRank(a, b) {
  if (a.mass !== b.mass)
    return b.mass - a.mass;
  if (a.path !== b.path)
    return a.path < b.path ? -1 : 1;
  if (a.range.start.line !== b.range.start.line)
    return a.range.start.line - b.range.start.line;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}
function hotspotFindings(functions) {
  return functions.filter((fn) => fn.eroded).sort(byHotspotRank).map((fn, index) => ({
    kind: "complexity.hotspot",
    path: fn.path,
    range: fn.range,
    summary: `CC ${fn.cc}, mass ${roundTo(fn.mass, 3)}, nesting ${fn.maxNesting}, SLOC ${fn.sloc}`,
    facts: {
      rank: index + 1,
      name: fn.name,
      functionKind: fn.kind,
      sourceSet: fn.sourceSet,
      cc: fn.cc,
      maxNesting: fn.maxNesting,
      sloc: fn.sloc,
      mass: roundTo(fn.mass, 3)
    }
  }));
}
function analyzeComplexity(inventory) {
  const measuredFiles = inventory.files.filter((file) => MEASURED_SETS.includes(file.sourceSet));
  const functions = measuredFiles.flatMap((file) => measureFile(file));
  const scopes = {
    production: scopeAggregate("production", measuredFiles.filter((file) => file.sourceSet === "production"), functions.filter((fn) => fn.sourceSet === "production")),
    test: scopeAggregate("test", measuredFiles.filter((file) => file.sourceSet === "test"), functions.filter((fn) => fn.sourceSet === "test"))
  };
  const metrics = [...scopeMetrics(scopes.production), ...scopeMetrics(scopes.test)].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return { functions, scopes, metrics, findings: hotspotFindings(functions) };
}
// src/metrics/cycles.ts
var CYCLE_POLICY_VERSION = "1.0.0";
function compareStrings(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
function buildAdjacency(nodes, edges) {
  const targets = new Map;
  for (const node of nodes)
    targets.set(node, new Set);
  for (const edge of edges)
    targets.get(edge.from)?.add(edge.to);
  const adjacency = new Map;
  for (const [node, set] of targets)
    adjacency.set(node, [...set].sort(compareStrings));
  return adjacency;
}
function pushNode(state, node) {
  state.indexOf.set(node, state.nextIndex);
  state.lowlink.set(node, state.nextIndex);
  state.nextIndex += 1;
  state.stack.push(node);
  state.onStack.add(node);
}
function settleNode(state, node, parent) {
  if (parent !== undefined) {
    const low = Math.min(state.lowlink.get(parent) ?? 0, state.lowlink.get(node) ?? 0);
    state.lowlink.set(parent, low);
  }
  if (state.lowlink.get(node) !== state.indexOf.get(node))
    return;
  const component = [];
  for (;; ) {
    const member = state.stack.pop();
    if (member === undefined)
      break;
    state.onStack.delete(member);
    component.push(member);
    if (member === node)
      break;
  }
  state.components.push(component.sort(compareStrings));
}
function stepFrame(state, frames) {
  const frame = frames[frames.length - 1];
  if (frame === undefined)
    return;
  const targets = state.adjacency.get(frame.node) ?? [];
  if (frame.child >= targets.length) {
    frames.pop();
    settleNode(state, frame.node, frames[frames.length - 1]?.node);
    return;
  }
  const target = targets[frame.child];
  frame.child += 1;
  if (target === undefined)
    return;
  if (!state.indexOf.has(target)) {
    pushNode(state, target);
    frames.push({ node: target, child: 0 });
  } else if (state.onStack.has(target)) {
    const low = Math.min(state.lowlink.get(frame.node) ?? 0, state.indexOf.get(target) ?? 0);
    state.lowlink.set(frame.node, low);
  }
}
function visitFrom(state, root) {
  pushNode(state, root);
  const frames = [{ node: root, child: 0 }];
  while (frames.length > 0)
    stepFrame(state, frames);
}
function stronglyConnectedComponents(nodes, adjacency) {
  const state = {
    adjacency,
    indexOf: new Map,
    lowlink: new Map,
    onStack: new Set,
    stack: [],
    nextIndex: 0,
    components: []
  };
  for (const node of [...nodes].sort(compareStrings)) {
    if (!state.indexOf.has(node))
      visitFrom(state, node);
  }
  return state.components.sort((a, b) => compareStrings(a[0] ?? "", b[0] ?? ""));
}
function tracePath(predecessor, start, end) {
  const chain = [];
  let current = end;
  while (current !== undefined && current !== start) {
    chain.unshift(current);
    current = predecessor.get(current);
  }
  return [start, ...chain, start];
}
function bfsStep(start, node, members, adjacency, predecessor, queue) {
  for (const target of adjacency.get(node) ?? []) {
    if (!members.has(target))
      continue;
    if (target === start)
      return tracePath(predecessor, start, node);
    if (!predecessor.has(target)) {
      predecessor.set(target, node);
      queue.push(target);
    }
  }
  return null;
}
function representativeCycle(start, members, adjacency) {
  const startTargets = (adjacency.get(start) ?? []).filter((target) => members.has(target));
  if (startTargets.includes(start))
    return [start, start];
  const predecessor = new Map;
  const queue = [];
  for (const target of startTargets) {
    if (!predecessor.has(target)) {
      predecessor.set(target, start);
      queue.push(target);
    }
  }
  for (let head = 0;head < queue.length; head += 1) {
    const node = queue[head];
    if (node === undefined)
      break;
    const found = bfsStep(start, node, members, adjacency, predecessor, queue);
    if (found !== null)
      return found;
  }
  return [start];
}
function detectClassGroups(graph, edgeClass) {
  const typeOnly = edgeClass === "type-only";
  const pairs = graph.edges.flatMap((edge) => edge.typeOnly === typeOnly && edge.resolution.status === "local" ? [{ from: edge.from, to: edge.resolution.target }] : []);
  const selfLoops = new Set(pairs.filter((pair) => pair.from === pair.to).map((pair) => pair.from));
  const nodes = graph.nodes.map((node) => node.path);
  const adjacency = buildAdjacency(nodes, pairs);
  const groups = [];
  for (const component of stronglyConnectedComponents(nodes, adjacency)) {
    const first = component[0] ?? "";
    if (component.length === 1 && !selfLoops.has(first))
      continue;
    groups.push({
      edgeClass,
      members: component,
      representativePath: representativeCycle(first, new Set(component), adjacency)
    });
  }
  return groups;
}

// src/metrics/analyze-cycles.ts
function buildGroups(graph) {
  const raws = ["runtime", "type-only"].flatMap((edgeClass) => detectClassGroups(graph, edgeClass));
  raws.sort((a, b) => compareStrings(a.members[0] ?? "", b.members[0] ?? "") || compareStrings(a.edgeClass, b.edgeClass));
  const packageOf = new Map(graph.nodes.map((node) => [node.path, node.packagePath]));
  return raws.map((raw, index) => ({
    id: `cycle-${index + 1}`,
    edgeClass: raw.edgeClass,
    members: raw.members,
    packages: [...new Set(raw.members.map((member) => packageOf.get(member) ?? ""))].sort(compareStrings),
    representativePath: raw.representativePath
  }));
}
function countAffected(groups) {
  const byClass = (edgeClass) => new Set(groups.filter((group) => group.edgeClass === edgeClass).flatMap((group) => group.members)).size;
  return {
    all: new Set(groups.flatMap((group) => group.members)).size,
    runtime: byClass("runtime"),
    typeOnly: byClass("type-only")
  };
}
function packageViews(graph, groups) {
  const totals = new Map;
  const packageOf = new Map;
  for (const node of graph.nodes) {
    totals.set(node.packagePath, (totals.get(node.packagePath) ?? 0) + 1);
    packageOf.set(node.path, node.packagePath);
  }
  const affected = new Map;
  const groupIds = new Map;
  for (const group of groups) {
    for (const pkg of group.packages) {
      const ids = groupIds.get(pkg) ?? [];
      ids.push(group.id);
      groupIds.set(pkg, ids);
    }
    for (const member of group.members) {
      const pkg = packageOf.get(member) ?? "";
      const set = affected.get(pkg) ?? new Set;
      set.add(member);
      affected.set(pkg, set);
    }
  }
  return [...groupIds.keys()].sort(compareStrings).map((pkg) => ({
    packagePath: pkg,
    modules: totals.get(pkg) ?? 0,
    affectedModules: affected.get(pkg)?.size ?? 0,
    groups: groupIds.get(pkg) ?? []
  }));
}
function graphIncompleteness(analysis) {
  if (analysis.graph.completeness !== "incomplete")
    return;
  const reasons = analysis.metrics.flatMap((metric) => metric.state === "incomplete" && metric.reason !== undefined ? [metric.reason] : []);
  const distinct = [...new Set(reasons)];
  return distinct.length === 0 ? "the dependency graph is incomplete" : `dependency graph incomplete: ${distinct.join("; ")}`;
}
function stateAndValue2(value, reason) {
  return reason === undefined ? { state: "complete", value } : { state: "incomplete", value, reason };
}
function densityMetric(nodes, affected, reason) {
  if (nodes === 0) {
    return { id: "import-cycle.density", unit: "ratio", state: "not-applicable" };
  }
  return {
    id: "import-cycle.density",
    unit: "ratio",
    ...stateAndValue2(roundTo(affected / nodes, 6), reason),
    numerator: affected,
    denominator: nodes
  };
}
function cycleMetrics(graph, groups, affected, reason) {
  const runtime = groups.filter((group) => group.edgeClass === "runtime").length;
  const unresolvedEdges = graph.edges.filter((edge) => edge.resolution.status === "unresolved").length;
  const metrics = [
    {
      id: "import-cycle.groups",
      unit: "count",
      ...stateAndValue2(groups.length, reason),
      detail: {
        runtime,
        typeOnly: groups.length - runtime,
        policyVersion: CYCLE_POLICY_VERSION,
        unresolvedEdges
      }
    },
    {
      id: "import-cycle.modules",
      unit: "count",
      ...stateAndValue2(affected.all, reason),
      detail: { runtime: affected.runtime, typeOnly: affected.typeOnly }
    },
    densityMetric(graph.nodes.length, affected.all, reason)
  ];
  return metrics.sort((a, b) => compareStrings(a.id, b.id));
}
function findingRange(graph, group) {
  const from = group.representativePath[0] ?? "";
  const to = group.representativePath[1] ?? from;
  const edge = graph.edges.find((candidate) => candidate.from === from && candidate.typeOnly === (group.edgeClass === "type-only") && candidate.resolution.status === "local" && candidate.resolution.target === to);
  return edge?.range ?? { start: { line: 1 }, end: { line: 1 } };
}
function cycleFinding(graph, group) {
  return {
    kind: "import-cycle",
    path: group.representativePath[0] ?? "",
    range: findingRange(graph, group),
    summary: `${group.edgeClass} import cycle over ${group.members.length} module(s): ${group.representativePath.join(" → ")}`,
    facts: {
      group: group.id,
      edgeClass: group.edgeClass,
      members: group.members.length,
      packages: group.packages,
      representativePath: group.representativePath
    }
  };
}
function analyzeCycles(analysis) {
  const { graph } = analysis;
  const groups = buildGroups(graph);
  const affected = countAffected(groups);
  const reason = graphIncompleteness(analysis);
  return {
    policyVersion: CYCLE_POLICY_VERSION,
    groups,
    packages: packageViews(graph, groups),
    affectedModules: affected.all,
    metrics: cycleMetrics(graph, groups, affected, reason),
    findings: groups.map((group) => cycleFinding(graph, group))
  };
}
// src/metrics/duplication.ts
import ts6 from "typescript";
var DUPLICATION_MIN_TOKENS = 100;
var DUPLICATION_MIN_LINES = 3;
var DEFAULT_DUPLICATION_BUDGET = {
  maxTokens: 2000000,
  maxMatchWork: 1e8
};
var LITERAL_KINDS = new Set([
  ts6.SyntaxKind.StringLiteral,
  ts6.SyntaxKind.NumericLiteral,
  ts6.SyntaxKind.BigIntLiteral,
  ts6.SyntaxKind.RegularExpressionLiteral,
  ts6.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts6.SyntaxKind.TemplateHead,
  ts6.SyntaxKind.TemplateMiddle,
  ts6.SyntaxKind.TemplateTail
]);
var LITERAL_PLACEHOLDER = ts6.SyntaxKind.StringLiteral;
function normalizeKind(kind) {
  if (LITERAL_KINDS.has(kind))
    return LITERAL_PLACEHOLDER;
  return kind;
}
function collectTokenStream(file) {
  const sourceFile = file.sourceFile;
  const kinds = [];
  const startLines = [];
  const endLines = [];
  const stack = [sourceFile];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined)
      continue;
    const children = node.getChildren(sourceFile);
    if (children.length === 0) {
      if (node.kind === ts6.SyntaxKind.EndOfFileToken)
        continue;
      kinds.push(normalizeKind(node.kind));
      startLines.push(positionAt(sourceFile, node.getStart(sourceFile)).line);
      endLines.push(positionAt(sourceFile, node.getEnd()).line);
      continue;
    }
    for (let index = children.length - 1;index >= 0; index -= 1) {
      const child = children[index];
      if (child !== undefined)
        stack.push(child);
    }
  }
  return {
    path: file.path,
    packagePath: file.packagePath,
    sourceSet: file.sourceSet,
    kinds,
    startLines,
    endLines
  };
}

// src/metrics/duplication-groups.ts
function contains(outer, inner) {
  return outer.file === inner.file && outer.start <= inner.start && outer.end >= inner.end && (outer.start < inner.start || outer.end > inner.end);
}
function locateGroup(group, streams, fileStart) {
  const located = [];
  for (const member of group.members.values()) {
    const stream = streams[member.file];
    if (stream === undefined)
      continue;
    const localStart = member.start - (fileStart[member.file] ?? 0);
    const localEnd = member.end - (fileStart[member.file] ?? 0) - 1;
    const startLine = stream.startLines[localStart] ?? 1;
    const endLine = stream.endLines[localEnd] ?? startLine;
    if (endLine - startLine + 1 < DUPLICATION_MIN_LINES)
      continue;
    located.push({ ...member, path: stream.path, startLine, endLine });
  }
  return located.filter((member, index) => !located.some((other, otherIndex) => otherIndex !== index && contains(other, member)));
}
function byMember(a, b) {
  if (a.path !== b.path)
    return a.path < b.path ? -1 : 1;
  if (a.range.start.line !== b.range.start.line)
    return a.range.start.line - b.range.start.line;
  return a.range.end.line - b.range.end.line;
}
function materializeGroup(group) {
  return {
    tokenCount: group.length,
    members: group.members.map((member) => ({
      path: member.path,
      range: {
        start: { line: member.startLine },
        end: { line: member.endLine }
      },
      tokenCount: group.length,
      lineCount: member.endLine - member.startLine + 1
    })).sort(byMember)
  };
}
function byGroup(a, b) {
  const firstA = a.members[0];
  const firstB = b.members[0];
  if (firstA === undefined || firstB === undefined)
    return 0;
  const byLocation = byMember(firstA, firstB);
  if (byLocation !== 0)
    return byLocation;
  if (a.tokenCount !== b.tokenCount)
    return b.tokenCount - a.tokenCount;
  return b.members.length - a.members.length;
}
function finalizeGroups(byLength, streams, fileStart) {
  let groups = [...byLength.values()].flat().map((group) => ({
    length: group.length,
    members: locateGroup(group, streams, fileStart)
  })).filter((group) => group.members.length >= 2);
  groups = groups.filter((group, index) => group.members.some((member) => !groups.some((other, otherIndex) => otherIndex !== index && other.members.some((outer) => contains(outer, member)))));
  return groups.map(materializeGroup).sort(byGroup).map((group, index) => ({ id: `clone-group-${index + 1}`, ...group }));
}

// src/metrics/duplication-detect.ts
function step(work, budget, n = 1) {
  work.count += n;
  if (work.count > budget.maxMatchWork) {
    work.exhausted = true;
    return false;
  }
  return true;
}
function concatenate(streams) {
  const kinds = [];
  const fileOf = [];
  const fileStart = [];
  const fileEnd = [];
  for (const [file, stream] of streams.entries()) {
    fileStart.push(kinds.length);
    for (const kind of stream.kinds) {
      kinds.push(kind);
      fileOf.push(file);
    }
    fileEnd.push(kinds.length);
  }
  return { kinds, fileOf, fileStart, fileEnd };
}
function verifyWindow(kinds, p, q, work, budget) {
  for (let offset = 0;offset < DUPLICATION_MIN_TOKENS; offset += 1) {
    if (!step(work, budget))
      return false;
    if (kinds[p + offset] !== kinds[q + offset])
      return false;
  }
  return true;
}
function extendLeft(data, p, q, work, budget) {
  const { kinds, fileOf, fileStart } = data;
  const fileP = fileOf[p] ?? 0;
  const fileQ = fileOf[q] ?? 0;
  let left = 0;
  while (p - left - 1 >= (fileStart[fileP] ?? 0) && q - left - 1 >= (fileStart[fileQ] ?? 0)) {
    if (!step(work, budget))
      return null;
    if (kinds[p - left - 1] !== kinds[q - left - 1])
      break;
    left += 1;
  }
  return left;
}
function extendRight(data, p, q, work, budget) {
  const { kinds, fileOf, fileEnd } = data;
  const fileP = fileOf[p] ?? 0;
  const fileQ = fileOf[q] ?? 0;
  const baseP = p + DUPLICATION_MIN_TOKENS;
  const baseQ = q + DUPLICATION_MIN_TOKENS;
  let right = 0;
  while (baseP + right < (fileEnd[fileP] ?? 0) && baseQ + right < (fileEnd[fileQ] ?? 0)) {
    if (!step(work, budget))
      return null;
    if (kinds[baseP + right] !== kinds[baseQ + right])
      break;
    right += 1;
  }
  return right;
}
function extendMatch(data, p, q, work, budget) {
  if (!verifyWindow(data.kinds, p, q, work, budget))
    return null;
  const left = extendLeft(data, p, q, work, budget);
  if (left === null)
    return null;
  const right = extendRight(data, p, q, work, budget);
  if (right === null)
    return null;
  const length = DUPLICATION_MIN_TOKENS + left + right;
  const fileP = data.fileOf[p] ?? 0;
  const fileQ = data.fileOf[q] ?? 0;
  return {
    a: { file: fileP, start: p - left, end: p - left + length },
    b: { file: fileQ, start: q - left, end: q - left + length },
    length
  };
}
function addMatch(byLength, kinds, match, work, budget) {
  const candidates = byLength.get(match.length) ?? [];
  for (const group of candidates) {
    let equal = true;
    for (let offset = 0;offset < match.length; offset += 1) {
      if (!step(work, budget))
        return;
      if (kinds[group.rep.start + offset] !== kinds[match.a.start + offset]) {
        equal = false;
        break;
      }
    }
    if (equal) {
      group.members.set(`${match.a.file}:${match.a.start}`, match.a);
      group.members.set(`${match.b.file}:${match.b.start}`, match.b);
      return;
    }
  }
  const group = {
    length: match.length,
    rep: match.a,
    members: new Map([
      [`${match.a.file}:${match.a.start}`, match.a],
      [`${match.b.file}:${match.b.start}`, match.b]
    ])
  };
  candidates.push(group);
  byLength.set(match.length, candidates);
}
var ROLLING_POWER = (() => {
  let power = 1;
  for (let index = 0;index < DUPLICATION_MIN_TOKENS; index += 1)
    power = Math.imul(power, 31);
  return power;
})();
function initialHash(kinds, start) {
  let hash = 0;
  for (let offset = 0;offset < DUPLICATION_MIN_TOKENS; offset += 1) {
    hash = Math.imul(hash, 31) + (kinds[start + offset] ?? 0) | 0;
  }
  return hash;
}
function rollHash(kinds, position, hash) {
  return Math.imul(hash, 31) - Math.imul(kinds[position - 1] ?? 0, ROLLING_POWER) + (kinds[position + DUPLICATION_MIN_TOKENS - 1] ?? 0) | 0;
}
function collectFileWindows(data, file, windows) {
  const start = data.fileStart[file] ?? 0;
  const last = (data.fileEnd[file] ?? 0) - DUPLICATION_MIN_TOKENS;
  if (last < start)
    return;
  let hash = initialHash(data.kinds, start);
  for (let position = start;position <= last; position += 1) {
    if (position > start)
      hash = rollHash(data.kinds, position, hash);
    const positions = windows.get(hash);
    if (positions === undefined)
      windows.set(hash, [position]);
    else
      positions.push(position);
  }
}
function buildWindows(data) {
  const windows = new Map;
  for (const file of data.fileStart.keys())
    collectFileWindows(data, file, windows);
  return windows;
}
function extendPair(data, byLength, pa, pb, work, budget) {
  const match = extendMatch(data, pa, pb, work, budget);
  if (work.exhausted)
    return false;
  if (match !== null)
    addMatch(byLength, data.kinds, match, work, budget);
  return !work.exhausted;
}
function extendClass(data, byLength, positions, work, budget) {
  for (let a = 0;a < positions.length; a += 1) {
    for (let b = a + 1;b < positions.length; b += 1) {
      const pa = positions[a];
      const pb = positions[b];
      if (pa === undefined || pb === undefined)
        continue;
      if (!extendPair(data, byLength, pa, pb, work, budget))
        return false;
    }
  }
  return true;
}
function collectRawGroups(data, windows, work, budget) {
  const byLength = new Map;
  for (const positions of windows.values()) {
    if (positions.length < 2)
      continue;
    if (!extendClass(data, byLength, positions, work, budget))
      break;
  }
  return byLength;
}
function detectClones(streams, budget = DEFAULT_DUPLICATION_BUDGET) {
  const data = concatenate(streams);
  if (data.kinds.length > budget.maxTokens) {
    return {
      groups: [],
      tokenCount: data.kinds.length,
      exhaustion: { kind: "token-count", limit: budget.maxTokens }
    };
  }
  const work = { count: 0, exhausted: false };
  const byLength = collectRawGroups(data, buildWindows(data), work, budget);
  return {
    groups: finalizeGroups(byLength, streams, data.fileStart),
    tokenCount: data.kinds.length,
    exhaustion: work.exhausted ? { kind: "match-work", limit: budget.maxMatchWork } : null
  };
}

// src/metrics/analyze-duplication.ts
var MEASURED_SETS2 = ["production", "test"];
function duplicatedCodeLines(file, groups) {
  const ranges = groups.flatMap((group) => group.members.filter((member) => member.path === file.path).map((member) => ({ start: member.range.start.line, end: member.range.end.line })));
  if (ranges.length === 0)
    return 0;
  const kinds = classifyLines(file.sourceFile);
  const covered = new Array(kinds.length).fill(false);
  for (const range of ranges) {
    const last = Math.min(range.end, kinds.length);
    for (let line = range.start;line <= last; line += 1)
      covered[line - 1] = true;
  }
  let count = 0;
  for (const [index, kind] of kinds.entries()) {
    if (covered[index] && kind === "code")
      count += 1;
  }
  return count;
}
function measureScope(sourceSet, files, budget) {
  const streams = files.map((file) => collectTokenStream(file));
  const detection = detectClones(streams, budget);
  const codeLines = files.reduce((sum, file) => sum + file.lines.code, 0);
  const duplicatedLines = files.reduce((sum, file) => sum + duplicatedCodeLines(file, detection.groups), 0);
  return {
    sourceSet,
    files: files.length,
    tokenCount: detection.tokenCount,
    codeLines,
    duplicatedLines,
    density: codeLines === 0 ? null : duplicatedLines / codeLines,
    groups: detection.groups,
    diagnosticFiles: files.filter((file) => file.diagnostics.length > 0).map((file) => file.path).sort(),
    exhaustion: detection.exhaustion
  };
}
function scopeReason(scope) {
  if (scope.exhaustion?.kind === "token-count") {
    return `token budget of ${scope.exhaustion.limit} exceeded ` + `(${scope.tokenCount} tokens in the ${scope.sourceSet} set); duplication not measured`;
  }
  if (scope.exhaustion?.kind === "match-work") {
    return `match-work budget of ${scope.exhaustion.limit} exceeded; duplication results are partial`;
  }
  const n = scope.diagnosticFiles.length;
  return n === 0 ? undefined : `${n} ${scope.sourceSet} file(s) produced parse diagnostics; values are partial`;
}
function stateAndValue3(value, reason) {
  if (reason !== undefined) {
    return value === null ? { state: "incomplete", reason } : { state: "incomplete", value, reason };
  }
  return value === null ? { state: "not-applicable" } : { state: "complete", value };
}
function metric2(id, unit, value, reason, extra) {
  return { id, unit, ...stateAndValue3(value, reason), ...extra };
}
function scopeMetrics2(scope) {
  const set = scope.sourceSet;
  const reason = scopeReason(scope);
  const unmeasured = scope.exhaustion?.kind === "token-count";
  const density = scope.density === null ? null : roundTo(scope.density, 6);
  return [
    metric2(`duplication.groups.${set}`, "count", unmeasured ? null : scope.groups.length, reason),
    metric2(`duplication.duplicated-lines.${set}`, "lines", unmeasured ? null : scope.duplicatedLines, reason, unmeasured || scope.codeLines === 0 ? undefined : {
      numerator: scope.duplicatedLines,
      denominator: scope.codeLines,
      detail: { tokenCount: scope.tokenCount, files: scope.files }
    }),
    metric2(`duplication.density.${set}`, "ratio", unmeasured ? null : density, reason, unmeasured || scope.codeLines === 0 ? undefined : { numerator: scope.duplicatedLines, denominator: scope.codeLines })
  ];
}
function groupFindings(scope) {
  return scope.groups.map((group) => {
    const first = group.members[0];
    return {
      kind: "duplication.clone-group",
      path: first?.path ?? "",
      range: first?.range ?? { start: { line: 1 }, end: { line: 1 } },
      summary: `${group.members.length} copies of ${group.tokenCount} normalized tokens`,
      facts: {
        groupId: group.id,
        sourceSet: scope.sourceSet,
        memberCount: group.members.length,
        tokenCount: group.tokenCount,
        members: group.members.map((member) => ({
          path: member.path,
          startLine: member.range.start.line,
          endLine: member.range.end.line
        }))
      }
    };
  });
}
function analyzeDuplication(inventory, options = {}) {
  const budget = options.budget ?? DEFAULT_DUPLICATION_BUDGET;
  const measuredFiles = inventory.files.filter((file) => MEASURED_SETS2.includes(file.sourceSet));
  const scopes = {
    production: measureScope("production", measuredFiles.filter((file) => file.sourceSet === "production"), budget),
    test: measureScope("test", measuredFiles.filter((file) => file.sourceSet === "test"), budget)
  };
  const metrics = [...scopeMetrics2(scopes.production), ...scopeMetrics2(scopes.test)].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const findings = [...groupFindings(scopes.production), ...groupFindings(scopes.test)];
  return { scopes, metrics, findings };
}
// src/metrics/graph-imports.ts
import ts7 from "typescript";
function specifierRange(sourceFile, literal) {
  return rangeAt(sourceFile, literal.getStart() + 1, literal.end - 1);
}
function importDeclarationSite(sourceFile, node) {
  if (!ts7.isStringLiteral(node.moduleSpecifier))
    return null;
  return {
    start: node.getStart(),
    site: {
      kind: "import",
      typeOnly: node.importClause?.isTypeOnly ?? false,
      specifier: node.moduleSpecifier.text,
      range: specifierRange(sourceFile, node.moduleSpecifier)
    }
  };
}
function importEqualsSite(sourceFile, node) {
  const ref = node.moduleReference;
  if (!ts7.isExternalModuleReference(ref) || !ts7.isStringLiteralLike(ref.expression))
    return null;
  return {
    start: node.getStart(),
    site: {
      kind: "import",
      typeOnly: node.isTypeOnly,
      specifier: ref.expression.text,
      range: specifierRange(sourceFile, ref.expression)
    }
  };
}
function exportDeclarationSite(sourceFile, node) {
  if (node.moduleSpecifier === undefined || !ts7.isStringLiteral(node.moduleSpecifier))
    return null;
  return {
    start: node.getStart(),
    site: {
      kind: "re-export",
      typeOnly: node.isTypeOnly,
      specifier: node.moduleSpecifier.text,
      range: specifierRange(sourceFile, node.moduleSpecifier)
    }
  };
}
function dynamicImportSite(sourceFile, node) {
  const argument = node.arguments[0];
  const literal = argument !== undefined && ts7.isStringLiteralLike(argument) ? argument : null;
  return {
    start: node.getStart(),
    site: {
      kind: "dynamic",
      typeOnly: false,
      specifier: literal?.text ?? null,
      range: literal !== null ? specifierRange(sourceFile, literal) : rangeAt(sourceFile, argument?.getStart() ?? node.getStart(), argument?.end ?? node.end)
    }
  };
}
function importTypeSite(sourceFile, node) {
  const argument = node.argument;
  if (!ts7.isLiteralTypeNode(argument) || !ts7.isStringLiteralLike(argument.literal))
    return null;
  return {
    start: node.getStart(),
    site: {
      kind: "import",
      typeOnly: true,
      specifier: argument.literal.text,
      range: specifierRange(sourceFile, argument.literal)
    }
  };
}
function collectImportSites(sourceFile) {
  const sites = [];
  const declarationSite = (node) => {
    if (ts7.isImportDeclaration(node))
      return importDeclarationSite(sourceFile, node);
    if (ts7.isImportEqualsDeclaration(node))
      return importEqualsSite(sourceFile, node);
    if (ts7.isExportDeclaration(node))
      return exportDeclarationSite(sourceFile, node);
    return null;
  };
  const nestedSite = (node) => {
    if (ts7.isCallExpression(node) && ts7.isIdentifier(node.expression) && node.expression.text === "require") {
      const located = dynamicImportSite(sourceFile, node);
      located.site.kind = "import";
      return located;
    }
    if (ts7.isCallExpression(node) && node.expression.kind === ts7.SyntaxKind.ImportKeyword) {
      return dynamicImportSite(sourceFile, node);
    }
    return ts7.isImportTypeNode(node) ? importTypeSite(sourceFile, node) : null;
  };
  const visit = (node) => {
    const site = declarationSite(node) ?? nestedSite(node);
    if (site !== null)
      sites.push(site);
    ts7.forEachChild(node, visit);
  };
  ts7.forEachChild(sourceFile, visit);
  return sites.sort((a, b) => a.start - b.start).map((located) => located.site);
}

// src/metrics/graph-resolve.ts
import { dirname as dirname2, join as join2, relative } from "node:path";
import ts8 from "typescript";

// src/metrics/graph-assets.ts
import { dirname, extname, resolve } from "node:path";

// src/metrics/graph-workspace.ts
var EXPORTS_CONDITIONS = ["import", "require", "default", "types"];
function wildcardMatch(pattern, value) {
  const star = pattern.indexOf("*");
  if (star === -1 || pattern.indexOf("*", star + 1) !== -1)
    return null;
  const [prefix, suffix] = [pattern.slice(0, star), pattern.slice(star + 1)];
  if (!value.startsWith(prefix) || !value.endsWith(suffix))
    return null;
  return value.slice(prefix.length, value.length - suffix.length);
}
function exportsTarget(value) {
  if (typeof value === "string")
    return { target: value };
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { unsupported: true };
  }
  const conditions = value;
  for (const condition of EXPORTS_CONDITIONS) {
    const selected = conditions[condition];
    if (typeof selected === "string")
      return { target: selected };
    if (selected !== undefined)
      return { unsupported: true };
  }
  return null;
}
function exportsTargetOrNull(value) {
  const target = exportsTarget(value);
  return target === null || "unsupported" in target ? null : target.target;
}
function exactCandidate(value) {
  const target = exportsTarget(value);
  return target === null || "unsupported" in target ? { failure: "unsupported-exports" } : { candidates: [target.target] };
}
function wildcardCandidate(map, key) {
  let best = null;
  for (const [pattern, value] of Object.entries(map)) {
    const middle = wildcardMatch(pattern, key);
    if (middle === null)
      continue;
    const target = exportsTargetOrNull(value);
    if (target === null)
      continue;
    if (best === null || pattern.indexOf("*") > best.prefix) {
      best = { prefix: pattern.indexOf("*"), target: target.replace("*", middle) };
    }
  }
  return best === null ? { failure: "exports-encapsulation" } : { candidates: [best.target] };
}
function exportsCandidates(exports, subpath) {
  const key = subpath === "" ? "." : `./${subpath}`;
  if (typeof exports === "string") {
    return key === "." ? { candidates: [exports] } : { failure: "exports-encapsulation" };
  }
  if (typeof exports !== "object" || exports === null || Array.isArray(exports)) {
    return { failure: "unsupported-exports" };
  }
  const map = exports;
  const exact = map[key];
  return exact !== undefined ? exactCandidate(exact) : wildcardCandidate(map, key);
}
function manifestCandidates(manifest, subpath) {
  if (subpath !== "")
    return [subpath];
  const candidates = [manifest.main, manifest.types].filter((field) => typeof field === "string");
  return candidates.length > 0 ? candidates : ["index"];
}

// src/metrics/graph-assets.ts
function mappedPaths(specifier, paths) {
  const exact = paths[specifier];
  if (exact !== undefined)
    return exact;
  let bestPrefix = -1;
  let candidates = [];
  for (const [pattern, targets] of Object.entries(paths)) {
    const middle = wildcardMatch(pattern, specifier);
    const prefix = pattern.indexOf("*");
    if (middle === null || prefix <= bestPrefix)
      continue;
    bestPrefix = prefix;
    candidates = targets.map((target) => target.replace("*", middle));
  }
  return candidates;
}
function resolveAsset(specifier, from, options, host) {
  const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
  const base = isRelative ? dirname(from) : options.baseUrl;
  if (base === undefined)
    return null;
  const candidates = isRelative ? [specifier] : mappedPaths(specifier, options.paths ?? {});
  for (const candidate of candidates) {
    const path = resolve(base, candidate);
    const extension = extname(path);
    if (!extension || /^\.(?:[cm]?[jt]sx?|json)$/i.test(extension))
      continue;
    if (host.fileExists(path))
      return path;
  }
  return null;
}

// src/metrics/graph-resolve.ts
var DEFAULT_OPTIONS = {
  moduleResolution: ts8.ModuleResolutionKind.Bundler,
  allowJs: true,
  resolveJsonModule: true
};
function isDependencyPath(absPath) {
  return absPath.replace(/\\/g, "/").split("/").includes("node_modules");
}
function guardedHost(root) {
  return {
    fileExists: (path) => !isDependencyPath(path) && ts8.sys.fileExists(path),
    readFile: (path) => isDependencyPath(path) ? undefined : ts8.sys.readFile(path),
    directoryExists: (path) => !isDependencyPath(path) && (ts8.sys.directoryExists?.(path) ?? false),
    getCurrentDirectory: () => root,
    getDirectories: (path) => isDependencyPath(path) ? [] : ts8.sys.getDirectories(path),
    useCaseSensitiveFileNames: ts8.sys.useCaseSensitiveFileNames,
    readDirectory: (path, extensions, excludes, includes, depth) => isDependencyPath(path) ? [] : ts8.sys.readDirectory(path, extensions, excludes, includes, depth)
  };
}
function toRepoRelative(root, absPath) {
  const rel = relative(root, absPath).replace(/\\/g, "/");
  return rel === "" || rel.startsWith("..") ? null : rel;
}
function packageNameOf(specifier) {
  const segments = specifier.split("/");
  return specifier.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0] ?? specifier;
}
function parseConfig(root, absPath, host) {
  const rel = toRepoRelative(root, absPath) ?? absPath;
  const read = ts8.readConfigFile(absPath, host.readFile);
  if (read.error !== undefined) {
    return { path: rel, status: "unreadable", options: { ...DEFAULT_OPTIONS } };
  }
  const parsed = ts8.parseJsonConfigFileContent(read.config, host, dirname2(absPath));
  const options = { ...DEFAULT_OPTIONS, ...parsed.options };
  if (options.moduleResolution === undefined) {
    options.moduleResolution = DEFAULT_OPTIONS.moduleResolution;
  }
  if (options.paths !== undefined && options.baseUrl === undefined) {
    options.baseUrl = "pathsBasePath" in options && typeof options.pathsBasePath === "string" ? options.pathsBasePath : dirname2(absPath);
  }
  return { path: rel, status: "parsed", options };
}
function packageManifest(state, pkgPath) {
  const cached = state.manifestCache.get(pkgPath);
  if (cached !== undefined)
    return cached;
  let manifest = {};
  try {
    const text = state.host.readFile(join2(state.root, pkgPath, "package.json"));
    const parsed = text === undefined ? null : JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      manifest = parsed;
    }
  } catch {
    manifest = {};
  }
  state.manifestCache.set(pkgPath, manifest);
  return manifest;
}
function governingOptions(state, absFile) {
  const visited = [];
  let dir = dirname2(absFile);
  let found = null;
  for (;; ) {
    const cached = state.configByDir.get(dir);
    if (cached !== undefined) {
      found = cached;
      break;
    }
    visited.push(dir);
    const candidate = join2(dir, "tsconfig.json");
    if (state.host.fileExists(candidate)) {
      found = candidate;
      break;
    }
    if (dir === state.root)
      break;
    dir = dirname2(dir);
  }
  for (const seen of visited)
    state.configByDir.set(seen, found);
  return optionsOfCachedConfig(state, found);
}
function optionsOfCachedConfig(state, absPath) {
  if (absPath === null)
    return DEFAULT_OPTIONS;
  let config = state.configByPath.get(absPath);
  if (config === undefined) {
    config = parseConfig(state.root, absPath, state.host);
    state.configByPath.set(absPath, config);
  }
  return config.options;
}
function classifyTarget(state, absTarget) {
  const rel = toRepoRelative(state.root, absTarget);
  if (rel === null) {
    return {
      status: "unresolved",
      reason: "outside-root",
      detail: "resolves above the audited root"
    };
  }
  return state.inventory.has(rel) ? { status: "local", target: rel } : { status: "out-of-scope", target: rel };
}
function resolveModule(state, specifier, absFrom, options) {
  const resolved = ts8.resolveModuleName(specifier, absFrom, options, state.host).resolvedModule;
  return resolved === undefined || resolved.isExternalLibraryImport === true ? null : resolved.resolvedFileName;
}
function matchesPathPattern(options, specifier) {
  for (const pattern of Object.keys(options.paths ?? {})) {
    if (wildcardMatch(pattern, specifier) !== null || pattern === specifier)
      return true;
  }
  return false;
}
function resolvePackageCandidate(state, pkgPath, candidate, options) {
  const cleaned = candidate.replace(/^\.\//, "");
  return resolveModule(state, `./${cleaned}`, join2(state.root, pkgPath, "package.json"), options);
}
function resolveWorkspacePackage(state, pkgPath, subpath, options) {
  const manifest = packageManifest(state, pkgPath);
  let candidates;
  if (manifest.exports !== undefined) {
    const looked = exportsCandidates(manifest.exports, subpath);
    if ("failure" in looked) {
      return {
        status: "unresolved",
        reason: looked.failure,
        detail: `workspace package '${pkgPath}' has no supported exports entry for './${subpath || "."}'`
      };
    }
    candidates = looked.candidates;
  } else {
    candidates = manifestCandidates(manifest, subpath);
  }
  for (const candidate of candidates) {
    const resolved = resolvePackageCandidate(state, pkgPath, candidate, options);
    if (resolved !== null)
      return classifyTarget(state, resolved);
  }
  return {
    status: "unresolved",
    reason: "no-target",
    detail: `workspace package '${pkgPath}' entry points resolved to no file`
  };
}
function resolveBare(state, specifier, absFrom, options) {
  if (specifier.startsWith("node:")) {
    return { status: "external", packageName: specifier };
  }
  const aliased = resolveModule(state, specifier, absFrom, options) ?? resolveAsset(specifier, absFrom, options, state.host);
  if (aliased !== null)
    return classifyTarget(state, aliased);
  if (matchesPathPattern(options, specifier)) {
    return {
      status: "unresolved",
      reason: "no-target",
      detail: `matches a tsconfig path mapping but resolved to no file`
    };
  }
  const name = packageNameOf(specifier);
  const pkgPath = state.packagesByName.get(name);
  if (pkgPath !== undefined) {
    return resolveWorkspacePackage(state, pkgPath, specifier.slice(name.length + 1), options);
  }
  return { status: "external", packageName: name };
}
function createGraphResolver(source) {
  const state = {
    root: source.root,
    host: guardedHost(source.root),
    inventory: new Set(source.files.map((file) => file.path)),
    packagesByName: new Map(source.packages.flatMap((pkg) => pkg.name === undefined ? [] : [[pkg.name, pkg.path]])),
    manifestCache: new Map,
    configByDir: new Map,
    configByPath: new Map
  };
  const resolve = (fromPath, site) => {
    if (site.specifier === null) {
      return {
        status: "unresolved",
        reason: "non-literal-dynamic",
        detail: "dynamic import argument is not a string literal"
      };
    }
    const absFrom = join2(state.root, fromPath);
    const options = governingOptions(state, absFrom);
    if (site.specifier.startsWith("./") || site.specifier.startsWith("../")) {
      const resolved = resolveModule(state, site.specifier, absFrom, options) ?? resolveAsset(site.specifier, absFrom, options, state.host);
      return resolved === null ? {
        status: "unresolved",
        reason: "no-target",
        detail: `relative specifier '${site.specifier}' matched no file`
      } : classifyTarget(state, resolved);
    }
    return resolveBare(state, site.specifier, absFrom, options);
  };
  const configs = () => [...state.configByPath.values()].map((config) => ({ path: config.path, status: config.status })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { resolve, configs };
}

// src/metrics/graph-types.ts
var GRAPH_POLICY_VERSION = "1.0.0";

// src/metrics/analyze-graph.ts
function countBy(edges, keep) {
  return edges.filter(keep).length;
}
function externalPackages(edges) {
  const counts = new Map;
  for (const edge of edges) {
    if (edge.resolution.status === "external") {
      const name = edge.resolution.packageName;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return [...counts.entries()].map(([name, edgeCount]) => ({ name, edges: edgeCount })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}
function incompletenessReason(unresolved, diagnosticFiles) {
  const parts = [];
  if (unresolved > 0) {
    parts.push(`${unresolved} local import edge(s) could not be resolved`);
  }
  if (diagnosticFiles > 0) {
    parts.push(`${diagnosticFiles} file(s) produced parse diagnostics; their imports may be missing`);
  }
  return parts.length === 0 ? undefined : parts.join("; ");
}
function stateAndValue4(value, reason) {
  return reason === undefined ? { state: "complete", value } : { state: "incomplete", value, reason };
}
function graphMetrics(graph, diagnosticFiles) {
  const edges = graph.edges;
  const unresolved = countBy(edges, (edge) => edge.resolution.status === "unresolved");
  const localReason = incompletenessReason(0, diagnosticFiles);
  const unresolvedReason = incompletenessReason(unresolved, diagnosticFiles);
  const local = edges.filter((edge) => edge.resolution.status === "local");
  const metrics = [
    { id: "graph.files", unit: "count", state: "complete", value: graph.nodes.length },
    {
      id: "graph.edges.local",
      unit: "count",
      ...stateAndValue4(local.length, localReason),
      detail: {
        typeOnly: countBy(local, (edge) => edge.typeOnly),
        reExports: countBy(local, (edge) => edge.kind === "re-export"),
        dynamic: countBy(local, (edge) => edge.kind === "dynamic"),
        outOfScope: countBy(edges, (edge) => edge.resolution.status === "out-of-scope")
      }
    },
    {
      id: "graph.edges.external",
      unit: "count",
      ...stateAndValue4(countBy(edges, (edge) => edge.resolution.status === "external"), localReason),
      detail: { packages: graph.externals.length }
    },
    {
      id: "graph.edges.unresolved",
      unit: "count",
      ...stateAndValue4(unresolved, unresolvedReason),
      detail: { policyVersion: graph.policyVersion }
    }
  ];
  return metrics.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
function unresolvedFindings(edges) {
  const findings = [];
  for (const edge of edges) {
    if (edge.resolution.status !== "unresolved")
      continue;
    const { reason, detail } = edge.resolution;
    findings.push({
      kind: "graph.unresolved-import",
      path: edge.from,
      range: edge.range,
      summary: `unresolved ${edge.kind} '${edge.specifier ?? "(non-literal)"}': ${detail}`,
      facts: {
        specifier: edge.specifier,
        edgeKind: edge.kind,
        typeOnly: edge.typeOnly,
        reason
      }
    });
  }
  return findings;
}
function analyzeDependencyGraph(source, syntax) {
  const resolver = createGraphResolver(source);
  const edges = syntax.files.flatMap((file) => collectImportSites(file.sourceFile).map((site) => ({
    from: file.path,
    kind: site.kind,
    typeOnly: site.typeOnly,
    specifier: site.specifier,
    range: site.range,
    resolution: resolver.resolve(file.path, site)
  })));
  const diagnosticFiles = syntax.files.filter((file) => file.diagnostics.length > 0).length;
  const graph = {
    policyVersion: GRAPH_POLICY_VERSION,
    root: syntax.root,
    nodes: syntax.files.map((file) => ({
      path: file.path,
      packagePath: file.packagePath,
      sourceSet: file.sourceSet
    })),
    edges,
    externals: externalPackages(edges),
    configs: resolver.configs(),
    completeness: "complete"
  };
  const metrics = graphMetrics(graph, diagnosticFiles);
  graph.completeness = metrics.some((metric) => metric.state === "incomplete") ? "incomplete" : "complete";
  return { graph, metrics, findings: unresolvedFindings(edges) };
}
// src/safeguards/shell.ts
var RUN_REFERENCE_RE = /\b(?:bun|npm|pnpm|yarn)\s+run\s+([A-Za-z0-9:_-]+)/g;
function extractRunReferences(command) {
  const names = [];
  for (const match of command.matchAll(RUN_REFERENCE_RE)) {
    if (match[1] !== undefined)
      names.push(match[1]);
  }
  return names;
}
var LINT_RE = /\b(?:biome\s+(?:check|lint|ci)|eslint|oxlint)\b/;
var TYPECHECK_RE = /\btsc\b/;
var NO_EMIT_RE = /(?:^|\s)--noEmit(?:\s|$|=)/;
var TEST_RE = /\b(?:bun\s+test|vitest|jest|node\s+--test|mocha)\b/;
function recognizeCheck(command) {
  if (TEST_RE.test(command))
    return "test";
  if (LINT_RE.test(command))
    return "lint";
  if (TYPECHECK_RE.test(command) && NO_EMIT_RE.test(command))
    return "typecheck";
  return null;
}
var NON_PATH_TOKEN = /^(?:https?:\/\/|[-$@]|\w+=)/;
var PATH_TOKEN = /^\.?[\w.+-]+(?:\/[\w.+-]+)+\/?$/;
function extractLocalPaths(command) {
  const paths = [];
  const seen = new Set;
  for (const raw of command.split(/\s+/)) {
    const token = raw.replace(/^["']+/, "").replace(/["',;]+$/, "");
    if (token.length === 0 || NON_PATH_TOKEN.test(token) || !PATH_TOKEN.test(token))
      continue;
    if (token.includes("://") || token.includes(".."))
      continue;
    const rel = token.replace(/^\.\//, "").replace(/\/$/, "");
    if (rel.length > 0 && !seen.has(rel)) {
      seen.add(rel);
      paths.push(rel);
    }
  }
  return paths;
}

// src/safeguards/wiring.ts
var BROKEN_REFERENCE_KIND = "safeguard.broken-reference";
function ciReachableScripts(ctx) {
  const byName = new Map;
  for (const script of ctx.manifest?.scripts ?? [])
    byName.set(script.name, script);
  const reach = new Map;
  const queue = [];
  const visit = (name, via) => {
    if (!byName.has(name) || reach.has(name))
      return;
    reach.set(name, via);
    queue.push(name);
  };
  for (const workflow of ctx.workflows) {
    for (const command of workflow.commands) {
      for (const name of extractRunReferences(command.text)) {
        visit(name, { workflow: workflow.path, chain: [] });
      }
    }
  }
  for (let head = 0;head < queue.length; head++) {
    const current = queue[head] ?? "";
    const via = reach.get(current);
    if (via === undefined)
      continue;
    for (const next of extractRunReferences(byName.get(current)?.body ?? "")) {
      visit(next, { workflow: via.workflow, chain: [...via.chain, current] });
    }
  }
  return reach;
}
function ciDirectChecks(ctx) {
  const kinds = new Set;
  for (const workflow of ctx.workflows) {
    for (const command of workflow.commands) {
      const kind = recognizeCheck(command.text);
      if (kind !== null)
        kinds.add(kind);
    }
  }
  return kinds;
}
function describeReach(script, reach) {
  const chain = [...reach.chain, script].join(" → ");
  return `${reach.workflow}: ${chain}`;
}
async function brokenPathFindings(ctx, origin, command, referencedBy, localPaths) {
  const findings = [];
  for (const rel of localPaths) {
    if (await ctx.pathExists(rel))
      continue;
    findings.push({
      kind: BROKEN_REFERENCE_KIND,
      path: origin.path,
      range: { start: { line: origin.line }, end: { line: origin.line } },
      summary: `${referencedBy} references '${rel}', which does not exist`,
      facts: { reference: rel, source: command }
    });
  }
  return findings;
}

// src/safeguards/agent-hooks.ts
var CLAUDE_SETTINGS = ".claude/settings.json";
function commandsFromEvent(event, entries, raw) {
  const commands = [];
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null)
      continue;
    const inner = entry.hooks;
    if (!Array.isArray(inner))
      continue;
    for (const hook of inner) {
      const command = hook?.command;
      if (typeof command !== "string" || command.length === 0)
        continue;
      commands.push({ event, command, line: locateLine(raw, command) });
    }
  }
  return commands;
}
function collectHookCommands(settings, raw) {
  const hooks = settings.hooks;
  if (typeof hooks !== "object" || hooks === null || Array.isArray(hooks))
    return [];
  const commands = [];
  for (const [event, entries] of Object.entries(hooks)) {
    if (Array.isArray(entries))
      commands.push(...commandsFromEvent(event, entries, raw));
  }
  return commands;
}
function locateLine(raw, needle) {
  const lines = raw.split(`
`);
  for (let i = 0;i < lines.length; i++) {
    if ((lines[i] ?? "").includes(needle))
      return i + 1;
  }
  return 1;
}
async function classifyCommands(ctx, commands) {
  const locations = [];
  const findings = [];
  let verified = 0;
  let unverified = 0;
  for (const hook of commands) {
    const localPaths = extractLocalPaths(hook.command);
    if (localPaths.length === 0) {
      unverified++;
      continue;
    }
    const broken = await brokenPathFindings(ctx, { path: CLAUDE_SETTINGS, line: hook.line }, hook.command, `${hook.event} hook`, localPaths);
    findings.push(...broken);
    if (broken.length === 0) {
      verified++;
      for (const rel of localPaths)
        locations.push({ path: rel });
    }
  }
  return { verified, unverified, locations, findings };
}
async function inspectAgentHooks(ctx) {
  const raw = await ctx.readText(CLAUDE_SETTINGS);
  if (raw === null)
    return { level: "absent", locations: [], notes: [], findings: [] };
  let settings;
  try {
    const value = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value))
      throw new Error;
    settings = value;
  } catch {
    return {
      level: "unknown",
      locations: [{ path: CLAUDE_SETTINGS }],
      notes: [`${CLAUDE_SETTINGS} is not parseable JSON; hooks are unverified`],
      findings: []
    };
  }
  const commands = collectHookCommands(settings, raw);
  if (commands.length === 0) {
    return { level: "absent", locations: [], notes: [], findings: [] };
  }
  const classified = await classifyCommands(ctx, commands);
  const { verified, unverified, locations, findings } = classified;
  const notes = [];
  locations.unshift({ path: CLAUDE_SETTINGS });
  if (unverified > 0) {
    notes.push(`${unverified} hook command(s) are arbitrary shell — explicitly unverified`);
  }
  if (verified === 0 && findings.length === 0) {
    return {
      level: "unknown",
      locations,
      notes: [
        `no hook command references a verifiable repo-local script (${commands.length} command(s))`,
        ...notes
      ],
      findings
    };
  }
  const wired = findings.length === 0;
  return {
    level: wired ? "structurally-wired" : "configured",
    locations,
    notes: [
      wired ? `${verified} hook command(s) reference committed repo-local scripts` : `${verified} hook command(s) verified; ${findings.length} broken reference(s)`,
      ...notes
    ],
    findings
  };
}

// src/safeguards/budgets.ts
var BUDGET_SPECS = {
  "coverage-budget": {
    files: ["scripts/coverage-budgets.json", "coverage-budgets.json"],
    enforcedBy: (body, budgetPath) => body.includes(budgetPath)
  },
  "file-size-budget": {
    files: ["scripts/file-size-budgets.json", "file-size-budgets.json"],
    enforcedBy: (body, budgetPath) => body.includes(budgetPath)
  },
  "duplication-budget": {
    files: [".jscpd.json"],
    enforcedBy: (body) => /\bjscpd\b/.test(body)
  }
};
var EXECUTABLE_COVERAGE_CONFIGS = [
  "vitest.config.ts",
  "vitest.config.js",
  "jest.config.ts",
  "jest.config.js"
];
async function budgetEnforced(ctx, spec, budgetPath) {
  const scripts = ctx.manifest?.scripts ?? [];
  const direct = scripts.find((s) => spec.enforcedBy(s.body, budgetPath));
  const ciDirect = ctx.workflows.some((w) => w.commands.some((c) => spec.enforcedBy(c.text, budgetPath)));
  if (ciDirect)
    return "a CI workflow invokes the enforcing check";
  if (direct === undefined)
    return null;
  const via = ciReachableScripts(ctx).get(direct.name);
  if (via !== undefined)
    return `script '${direct.name}' is reachable from ${via.workflow}`;
  return null;
}
async function inspectBudget(ctx, spec) {
  for (const rel of spec.files) {
    const text = await ctx.readText(rel);
    if (text === null)
      continue;
    try {
      JSON.parse(text);
    } catch {
      return {
        level: "unknown",
        locations: [{ path: rel }],
        notes: [`${rel} is not parseable JSON; the budget is unverified`],
        findings: []
      };
    }
    const enforced = await budgetEnforced(ctx, spec, rel);
    return {
      level: enforced !== null ? "structurally-wired" : "configured",
      locations: [{ path: rel }],
      notes: [
        enforced !== null ? `enforcing check referenced: ${enforced}` : "no CI-reachable check references the budget"
      ],
      findings: []
    };
  }
  return { level: "absent", locations: [], notes: [], findings: [] };
}
async function inspectDuplication(ctx) {
  const file = await inspectBudget(ctx, BUDGET_SPECS["duplication-budget"]);
  if (file.level !== "absent")
    return file;
  if (ctx.manifest?.jscpdConfig === true) {
    const enforced = await budgetEnforced(ctx, BUDGET_SPECS["duplication-budget"], "package.json");
    return {
      level: enforced !== null ? "structurally-wired" : "configured",
      locations: [{ path: "package.json" }],
      notes: [
        enforced !== null ? `enforcing check referenced: ${enforced}` : "no CI-reachable check invokes jscpd"
      ],
      findings: []
    };
  }
  return file;
}
async function inspectCoverage(ctx) {
  const json = await inspectBudget(ctx, BUDGET_SPECS["coverage-budget"]);
  if (json.level !== "absent")
    return json;
  for (const rel of EXECUTABLE_COVERAGE_CONFIGS) {
    if (await ctx.fileExists(rel)) {
      return {
        level: "unknown",
        locations: [{ path: rel }],
        notes: [`${rel} is executable configuration; any coverage thresholds in it are unverified`],
        findings: []
      };
    }
  }
  return json;
}
async function findBrokenScriptReferences(ctx) {
  const findings = [];
  for (const script of ctx.manifest?.scripts ?? []) {
    const localPaths = extractLocalPaths(script.body);
    findings.push(...await brokenPathFindings(ctx, { path: ctx.manifest?.path ?? "package.json", line: script.line }, script.body, `script '${script.name}'`, localPaths));
  }
  return findings;
}
async function inspectBudgets(ctx) {
  const results = new Map;
  results.set("coverage-budget", await inspectCoverage(ctx));
  results.set("file-size-budget", await inspectBudget(ctx, BUDGET_SPECS["file-size-budget"]));
  results.set("duplication-budget", await inspectDuplication(ctx));
  return results;
}

// src/safeguards/context.ts
import { readdir, readFile as readFile2, stat } from "node:fs/promises";
import { join as join3 } from "node:path";
var MANIFEST_PATH = "package.json";
var WORKFLOWS_DIR = ".github/workflows";
async function readTextFile(root, rel) {
  try {
    return await readFile2(join3(root, rel), "utf8");
  } catch {
    return null;
  }
}
async function fileExists(root, rel) {
  try {
    return (await stat(join3(root, rel))).isFile();
  } catch {
    return false;
  }
}
async function pathExists(root, rel) {
  try {
    await stat(join3(root, rel));
    return true;
  } catch {
    return false;
  }
}
var KEY_RE = /^(\s*)"((?:[^"\\]|\\.)*)"\s*:\s*(.*)$/;
var STRING_VALUE_RE = /^"((?:[^"\\]|\\.)*)"$/;
function braceDelta(text) {
  let delta = 0;
  for (const ch of text) {
    if (ch === "{")
      delta++;
    if (ch === "}")
      delta--;
  }
  return delta;
}
function scriptsStartDepth(line) {
  const match = KEY_RE.exec(line);
  if (match?.[2] !== "scripts" || !(match[3] ?? "").startsWith("{"))
    return null;
  return braceDelta(line.slice(line.indexOf("{")));
}
function parseScriptEntry(line, lineNumber) {
  const match = KEY_RE.exec(line);
  if (match === null)
    return null;
  const value = (match[3] ?? "").replace(/,?\s*$/, "");
  const stringValue = STRING_VALUE_RE.exec(value);
  if (stringValue === null)
    return null;
  return {
    name: match[2] ?? "",
    body: JSON.parse(`"${stringValue[1]}"`),
    line: lineNumber
  };
}
function locateScripts(raw) {
  const lines = raw.split(`
`);
  const startIndex = lines.findIndex((line) => scriptsStartDepth(line) !== null);
  if (startIndex < 0)
    return [];
  let depth = scriptsStartDepth(lines[startIndex] ?? "") ?? 0;
  if (depth <= 0)
    return [];
  const entries = [];
  for (let i = startIndex + 1;i < lines.length; i++) {
    const line = lines[i] ?? "";
    const entry = depth === 1 ? parseScriptEntry(line, i + 1) : null;
    if (entry !== null)
      entries.push(entry);
    depth += braceDelta(line);
    if (depth <= 0)
      break;
  }
  return entries;
}
async function loadManifest(root) {
  const raw = await readTextFile(root, MANIFEST_PATH);
  if (raw === null)
    return null;
  let parsed;
  try {
    const value = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return {
        path: MANIFEST_PATH,
        scripts: [],
        jscpdConfig: false,
        huskyConfig: false,
        parseError: "package.json is not a JSON object"
      };
    }
    parsed = value;
  } catch (error) {
    return {
      path: MANIFEST_PATH,
      scripts: [],
      jscpdConfig: false,
      huskyConfig: false,
      parseError: error instanceof Error ? error.message : "unparseable JSON"
    };
  }
  return {
    path: MANIFEST_PATH,
    scripts: locateScripts(raw),
    jscpdConfig: typeof parsed.jscpd === "object" && parsed.jscpd !== null,
    huskyConfig: typeof parsed.husky === "object" && parsed.husky !== null
  };
}
var RUN_SCALAR_RE = /^(\s*)-?\s*run:\s*(.+)$/;
var RUN_BLOCK_RE = /^(\s*)-?\s*run:\s*([|>])-?\s*$/;
var USES_RE = /^\s*-?\s*uses:\s*(\S+)\s*$/;
function consumeRunBlock(lines, start, parentIndent, commands) {
  let last = start;
  for (let j = start + 1;j < lines.length; j++) {
    const inner = lines[j] ?? "";
    if (inner.trim().length === 0)
      continue;
    const indent = inner.length - inner.trimStart().length;
    if (indent <= parentIndent)
      break;
    commands.push({ text: inner.trim(), line: j + 1 });
    last = j;
  }
  return last;
}
function extractWorkflowCommands(path, text) {
  const lines = text.split(`
`);
  const commands = [];
  const uses = [];
  for (let i = 0;i < lines.length; i++) {
    const line = lines[i] ?? "";
    const block = RUN_BLOCK_RE.exec(line);
    if (block !== null) {
      i = consumeRunBlock(lines, i, (block[1] ?? "").length, commands);
      continue;
    }
    const scalar = RUN_SCALAR_RE.exec(line);
    if (scalar !== null) {
      commands.push({ text: (scalar[2] ?? "").trim(), line: i + 1 });
      continue;
    }
    const usesMatch = USES_RE.exec(line);
    if (usesMatch !== null)
      uses.push(usesMatch[1] ?? "");
  }
  return { path, commands, uses };
}
async function loadWorkflows(root) {
  let names;
  try {
    names = await readdir(join3(root, WORKFLOWS_DIR));
  } catch {
    return [];
  }
  const workflows = [];
  for (const name of names.filter((n) => n.endsWith(".yml") || n.endsWith(".yaml")).sort()) {
    const rel = `${WORKFLOWS_DIR}/${name}`;
    const text = await readTextFile(root, rel);
    if (text !== null)
      workflows.push(extractWorkflowCommands(rel, text));
  }
  return workflows;
}
async function loadSafeguardContext(root) {
  const [manifest, workflows] = await Promise.all([loadManifest(root), loadWorkflows(root)]);
  return {
    root,
    manifest,
    workflows,
    fileExists: (rel) => fileExists(root, rel),
    pathExists: (rel) => pathExists(root, rel),
    readText: (rel) => readTextFile(root, rel)
  };
}

// src/safeguards/hooks.ts
import yaml from "js-yaml";

// src/safeguards/types.ts
var EVIDENCE_RANK = {
  absent: 0,
  unknown: 1,
  configured: 2,
  "structurally-wired": 3
};

// src/safeguards/hooks.ts
var HUSKY_HOOK = ".husky/pre-commit";
var LEFTHOOK_CONFIGS = ["lefthook.yml", "lefthook.yaml", ".lefthook.yml", ".lefthook.yaml"];
var PRE_COMMIT_CONFIGS = [".pre-commit-config.yaml", ".pre-commit-config.yml"];
var EXECUTABLE_HOOK_CONFIGS = [
  "husky.config.js",
  "husky.config.cjs",
  ".huskyrc",
  ".huskyrc.js",
  ".huskyrc.json"
];
var HOOKS_PATH_RE = /\bgit\s+config\s+core\.hooksPath\s+(\S+)/;
var HUSKY_INSTALL_RE = /\bhusky\b/;
var LEFTHOOK_RE = /\blefthook\s+(?:install|run)\b/;
var PRE_COMMIT_RUN_RE = /\bpre-commit\s+run\b/;
var PRE_COMMIT_ACTION_RE = /^pre-commit\/action@/;
function referencedAnywhere(ctx, re) {
  for (const script of ctx.manifest?.scripts ?? []) {
    if (re.test(script.body))
      return `script '${script.name}'`;
  }
  for (const workflow of ctx.workflows) {
    for (const command of workflow.commands) {
      if (re.test(command.text))
        return `${workflow.path} line ${command.line}`;
    }
  }
  return null;
}
async function inspectHooksPath(ctx) {
  const scripts = ctx.manifest?.scripts ?? [];
  let evidence = null;
  for (const script of scripts) {
    const match = HOOKS_PATH_RE.exec(script.body);
    const dir = match?.[1]?.replace(/^\.?\//, "").replace(/\/$/, "");
    if (dir === undefined || dir.length === 0)
      continue;
    const hookRel = `${dir}/pre-commit`;
    const scriptLocation = {
      path: "package.json",
      range: { start: { line: script.line }, end: { line: script.line } }
    };
    if (await ctx.fileExists(hookRel)) {
      evidence = {
        level: "structurally-wired",
        locations: [scriptLocation, { path: hookRel }],
        notes: [`script '${script.name}' wires core.hooksPath to committed '${hookRel}'`],
        findings: []
      };
    } else if (evidence === null) {
      evidence = {
        level: "configured",
        locations: [scriptLocation],
        notes: [
          `script '${script.name}' wires core.hooksPath to '${dir}' but no hook is committed`
        ],
        findings: await brokenPathFindings(ctx, { path: "package.json", line: script.line }, script.body, `script '${script.name}'`, [hookRel])
      };
    }
  }
  return evidence;
}
async function inspectHusky(ctx) {
  if (await ctx.fileExists(HUSKY_HOOK)) {
    const prepare = (ctx.manifest?.scripts ?? []).find((s) => s.name === "prepare" && HUSKY_INSTALL_RE.test(s.body));
    return prepare !== undefined ? {
      level: "structurally-wired",
      locations: [{ path: HUSKY_HOOK }],
      notes: [`husky install wired via script '${prepare.name}'`],
      findings: []
    } : {
      level: "configured",
      locations: [{ path: HUSKY_HOOK }],
      notes: ["no husky install wiring (a 'prepare' script invoking husky) found"],
      findings: []
    };
  }
  if (ctx.manifest?.huskyConfig === true) {
    return {
      level: "configured",
      locations: [{ path: "package.json" }],
      notes: ["declarative 'husky' key in package.json (husky v4 config)"],
      findings: []
    };
  }
  return null;
}
async function inspectLefthook(ctx) {
  for (const rel of LEFTHOOK_CONFIGS) {
    const text = await ctx.readText(rel);
    if (text === null)
      continue;
    const parse = tryYamlMap(text);
    if (!parse.ok)
      return unknownSurface(rel, `lefthook config is not parseable YAML: ${parse.error}`);
    const via = referencedAnywhere(ctx, LEFTHOOK_RE);
    return {
      level: via !== null ? "structurally-wired" : "configured",
      locations: [{ path: rel }],
      notes: [
        via !== null ? `lefthook install/run referenced from ${via}` : "no lefthook install/run reference found in scripts or CI"
      ],
      findings: []
    };
  }
  return null;
}
async function inspectPreCommitFramework(ctx) {
  for (const rel of PRE_COMMIT_CONFIGS) {
    const text = await ctx.readText(rel);
    if (text === null)
      continue;
    const parse = tryYamlMap(text);
    if (!parse.ok)
      return unknownSurface(rel, `pre-commit config is not parseable YAML: ${parse.error}`);
    const ciUses = ctx.workflows.some((w) => w.uses.some((u) => PRE_COMMIT_ACTION_RE.test(u)));
    const via = referencedAnywhere(ctx, PRE_COMMIT_RUN_RE);
    const wiredNote = ciUses ? "a CI workflow uses pre-commit/action" : via !== null ? `pre-commit run referenced from ${via}` : null;
    return {
      level: wiredNote !== null ? "structurally-wired" : "configured",
      locations: [{ path: rel }],
      notes: [wiredNote ?? "no pre-commit/action step or 'pre-commit run' reference found"],
      findings: []
    };
  }
  return null;
}
async function inspectYamlHookConfigs(ctx) {
  const lefthook = await inspectLefthook(ctx);
  if (lefthook !== null)
    return lefthook;
  return inspectPreCommitFramework(ctx);
}
function tryYamlMap(text) {
  try {
    const value = yaml.load(text);
    if (typeof value !== "object" || value === null) {
      return { ok: false, error: "document is not a mapping" };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "unparseable YAML" };
  }
}
function unknownSurface(path, note) {
  return { level: "unknown", locations: [{ path }], notes: [note], findings: [] };
}
function mergeSurfaces(surfaces) {
  const present = surfaces.filter((s) => EVIDENCE_RANK[s.level] > 0);
  if (present.length === 0)
    return { level: "absent", locations: [], notes: [], findings: [] };
  const top = Math.max(...present.map((s) => EVIDENCE_RANK[s.level]));
  const merged = { level: "absent", locations: [], notes: [], findings: [] };
  for (const surface of present) {
    if (EVIDENCE_RANK[surface.level] === top)
      merged.level = surface.level;
    merged.locations.push(...surface.locations);
    merged.notes.push(...surface.notes);
    merged.findings.push(...surface.findings);
  }
  return merged;
}
async function inspectGitHooks(ctx) {
  const surfaces = [];
  const hooksPath = await inspectHooksPath(ctx);
  if (hooksPath !== null)
    surfaces.push(hooksPath);
  const husky = await inspectHusky(ctx);
  if (husky !== null)
    surfaces.push(husky);
  const yamlConfigs = await inspectYamlHookConfigs(ctx);
  if (yamlConfigs !== null)
    surfaces.push(yamlConfigs);
  for (const rel of EXECUTABLE_HOOK_CONFIGS) {
    if (await ctx.fileExists(rel)) {
      surfaces.push(unknownSurface(rel, "executable hook configuration is unsupported and unverified"));
    }
  }
  return mergeSurfaces(surfaces);
}

// src/safeguards/scripts.ts
var CHECK_KINDS = [
  { kind: "lint", id: "lint-script", label: "lint" },
  { kind: "typecheck", id: "typecheck-script", label: "typecheck" },
  { kind: "test", id: "test-script", label: "test" }
];
function matchingScripts(scripts, kind) {
  return scripts.filter((script) => recognizeCheck(script.body) === kind);
}
function runnerScripts(scripts, reach) {
  return scripts.filter((s) => reach.has(s.name) && /\b(?:bun|node)\s+\S+\.[cm]?[jt]s\b/.test(s.body)).map((s) => s.name).sort();
}
function inspectCheckScript(ctx, kind) {
  if (ctx.manifest === null)
    return { level: "absent", locations: [], notes: [], findings: [] };
  if (ctx.manifest.parseError !== undefined) {
    return {
      level: "unknown",
      locations: [{ path: ctx.manifest.path }],
      notes: [`${ctx.manifest.path} is unparseable (${ctx.manifest.parseError})`],
      findings: []
    };
  }
  const matches = matchingScripts(ctx.manifest.scripts, kind);
  if (matches.length === 0) {
    return {
      level: "absent",
      locations: [],
      notes: ["dependency or tool-config presence alone is not evidence"],
      findings: []
    };
  }
  const locations = matches.map((script) => ({
    path: ctx.manifest?.path ?? "package.json",
    range: { start: { line: script.line }, end: { line: script.line } }
  }));
  const reach = ciReachableScripts(ctx);
  const wired = matches.find((script) => reach.has(script.name));
  const wiredReach = wired !== undefined ? reach.get(wired.name) : undefined;
  const directCi = ciDirectChecks(ctx).has(kind);
  if (wired !== undefined && wiredReach !== undefined) {
    const note = `referenced from CI (${describeReach(wired.name, wiredReach)})`;
    return { level: "structurally-wired", locations, notes: [note], findings: [] };
  }
  if (directCi) {
    return {
      level: "structurally-wired",
      locations,
      notes: ["CI invokes the same check command directly"],
      findings: []
    };
  }
  const notes = ["no CI workflow references the script"];
  const runners = runnerScripts(ctx.manifest.scripts, reach);
  if (runners.length > 0) {
    notes.push(`CI reaches executable runner(s) ${runners.join(", ")}; runner behavior is unverified`);
  }
  return { level: "configured", locations, notes, findings: [] };
}

// src/safeguards/inspect.ts
var SAFEGUARD_IDS = [
  "pre-commit-hook",
  "agent-hooks",
  "lint-script",
  "typecheck-script",
  "test-script",
  "coverage-budget",
  "file-size-budget",
  "duplication-budget"
];
function compareFindings(a, b) {
  return a.path.localeCompare(b.path) || a.range.start.line - b.range.start.line || a.kind.localeCompare(b.kind) || a.summary.localeCompare(b.summary);
}
async function inspectSafeguards(root) {
  const ctx = await loadSafeguardContext(root);
  const gitHooks = await inspectGitHooks(ctx);
  const agentHooks = await inspectAgentHooks(ctx);
  const budgets = await inspectBudgets(ctx);
  const checkScripts = new Map(CHECK_KINDS.map(({ kind, id }) => [id, inspectCheckScript(ctx, kind)]));
  const byId = new Map([
    ["pre-commit-hook", gitHooks],
    ["agent-hooks", agentHooks],
    ...budgets,
    ...checkScripts
  ]);
  const results = [];
  const findings = [];
  for (const id of SAFEGUARD_IDS) {
    const evidence = byId.get(id);
    if (evidence === undefined)
      continue;
    results.push({
      id,
      evidence: evidence.level,
      locations: evidence.locations,
      ...evidence.notes.length > 0 ? { notes: evidence.notes.join("; ") } : {}
    });
    findings.push(...evidence.findings);
  }
  findings.push(...await findBrokenScriptReferences(ctx));
  findings.sort(compareFindings);
  return { results, findings };
}
// src/analysis/provenance.ts
import { createHash } from "node:crypto";

// src/contract/analysis.ts
import { z as z6 } from "zod";

// src/contract/coverage.ts
import { z as z4 } from "zod";
var SOURCE_SETS = [
  "production",
  "test",
  "generated",
  "vendored",
  "declaration-only"
];
var COVERAGE_SCOPES = [...SOURCE_SETS, "excluded", "unsupported"];
var sourceCoverageEntrySchema = z4.strictObject({
  files: z4.number().int().nonnegative(),
  sloc: z4.number().int().nonnegative().optional(),
  note: z4.string().min(1).optional()
});
var sourceCoverageSchema = z4.strictObject({
  production: sourceCoverageEntrySchema,
  test: sourceCoverageEntrySchema,
  generated: sourceCoverageEntrySchema.optional(),
  vendored: sourceCoverageEntrySchema.optional(),
  "declaration-only": sourceCoverageEntrySchema.optional(),
  excluded: sourceCoverageEntrySchema.optional(),
  unsupported: sourceCoverageEntrySchema.optional()
});

// src/contract/provider.ts
import { z as z5 } from "zod";
var PROVIDER_STATES = [
  "unrequested",
  "unavailable",
  "unsupported",
  "incomplete",
  "complete"
];
var providerStateSchema = z5.enum(PROVIDER_STATES);
var PRODUCER_KINDS = ["native", "external"];
var producerKindSchema = z5.enum(PRODUCER_KINDS);
var NATIVE_NAMESPACE = "trellis";
var EVIDENCE_NAMESPACE = "provider";
var providerIdSchema = dottedIdSchema;
var RESERVED_EXECUTION_OPTION_KEYS = new Set([
  "duration-ms",
  "duration",
  "elapsed-ms",
  "timestamp",
  "started-at",
  "finished-at",
  "machine-path",
  "scratch-path",
  "exit-code"
]);
var optionKeySchema = z5.string().regex(/^[a-z][a-z0-9-]*$/, "must be a kebab-case identifier").refine((key) => !RESERVED_EXECUTION_OPTION_KEYS.has(key), {
  message: "machine paths, timestamps and durations are execution metadata, never analysis identity"
});
var optionValueSchema = z5.union([z5.string().min(1), finiteNumberSchema, z5.boolean()]);
var providerOptionsSchema = z5.record(optionKeySchema, optionValueSchema);
var providerIdentitySchema = z5.strictObject({
  kind: producerKindSchema,
  id: providerIdSchema,
  toolVersion: versionStringSchema,
  adapterVersion: versionStringSchema,
  mode: z5.string().min(1),
  options: providerOptionsSchema
}).superRefine((identity, ctx) => {
  const isNativeId = identity.id === NATIVE_NAMESPACE || identity.id.startsWith(`${NATIVE_NAMESPACE}.`);
  if (identity.kind === "native" && !isNativeId) {
    ctx.addIssue({
      code: "custom",
      message: "a native provider id must be under the 'trellis.' namespace",
      path: ["id"]
    });
  }
  if (identity.kind === "external" && isNativeId) {
    ctx.addIssue({
      code: "custom",
      message: "an external provider id must not use the reserved 'trellis.' namespace",
      path: ["id"]
    });
  }
});
function namespacedEvidenceId(providerId, name) {
  return `${EVIDENCE_NAMESPACE}.${providerId}.${name}`;
}
var providerCapabilitySchema = z5.strictObject({
  providerId: providerIdSchema,
  capabilityId: dottedIdSchema
});
var capabilityDeclarationsSchema = z5.array(providerCapabilitySchema).superRefine((declarations, ctx) => {
  const owners = new Map;
  for (const [index, declaration] of declarations.entries()) {
    const previous = owners.get(declaration.capabilityId);
    if (previous !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: `capability "${declaration.capabilityId}" is declared by both "${previous}" and "${declaration.providerId}"`,
        path: [index, "capabilityId"]
      });
      continue;
    }
    owners.set(declaration.capabilityId, declaration.providerId);
  }
});

// src/contract/analysis.ts
var contentFingerprintSchema = z6.string().regex(/^[0-9a-f]{64}$/, "must be a lowercase sha-256 hex digest");
var snapshotFileSchema = z6.strictObject({
  path: relativePathSchema,
  fingerprint: contentFingerprintSchema
});
function isSortedUnique(values) {
  for (let i = 1;i < values.length; i++) {
    const previous = values[i - 1];
    const current = values[i];
    if (previous === undefined || current === undefined || previous >= current) {
      return false;
    }
  }
  return true;
}
var sourceSelectionSchema = z6.strictObject({
  sourceSets: z6.array(z6.enum(SOURCE_SETS)).min(1),
  files: z6.array(snapshotFileSchema)
}).superRefine((selection, ctx) => {
  if (!isSortedUnique(selection.sourceSets)) {
    ctx.addIssue({
      code: "custom",
      message: "source sets must be unique and sorted",
      path: ["sourceSets"]
    });
  }
  if (!isSortedUnique(selection.files.map((file) => file.path))) {
    ctx.addIssue({
      code: "custom",
      message: "selected files must have unique, sorted paths",
      path: ["files"]
    });
  }
});
var parserIdentitySchema = z6.strictObject({
  engine: dottedIdSchema,
  version: versionStringSchema
});
var analysisIdentitySchema = z6.strictObject({
  selection: sourceSelectionSchema,
  parser: parserIdentitySchema,
  options: providerOptionsSchema
});
var executionMetadataSchema = z6.strictObject({
  startedAt: z6.iso.datetime().optional(),
  durationMs: finiteNumberSchema.nonnegative().optional(),
  machinePath: z6.string().min(1).optional(),
  exitCode: z6.number().int().optional()
});
var analysisDiagnosticSchema = z6.strictObject({
  path: relativePathSchema.optional(),
  message: z6.string().min(1)
});
var unsupportedContextSchema = z6.strictObject({
  path: relativePathSchema,
  reason: z6.string().min(1)
});
var observedCoverageSchema = z6.strictObject({
  analyzedFiles: z6.array(relativePathSchema),
  analyzedLines: finiteNumberSchema.int().nonnegative().optional(),
  bySourceSet: z6.partialRecord(z6.enum(SOURCE_SETS), finiteNumberSchema.int().nonnegative()).optional(),
  diagnostics: z6.array(analysisDiagnosticSchema),
  unsupported: z6.array(unsupportedContextSchema)
}).superRefine((coverage, ctx) => {
  if (!isSortedUnique(coverage.analyzedFiles)) {
    ctx.addIssue({
      code: "custom",
      message: "analyzed files must be unique and sorted",
      path: ["analyzedFiles"]
    });
  }
});
// src/contract/analysis-result.ts
import { z as z9 } from "zod";

// src/contract/metric.ts
import { z as z8 } from "zod";

// src/contract/states.ts
import { z as z7 } from "zod";
var ANALYSIS_STATES = ["complete", "incomplete", "unsupported", "not-applicable"];
var analysisStateSchema = z7.enum(ANALYSIS_STATES);
var completenessSchema = z7.enum(["complete", "incomplete"]);
function rollUpCompleteness(states) {
  return states.includes("incomplete") ? "incomplete" : "complete";
}

// src/contract/metric.ts
var metricValueSchema = z8.strictObject({
  id: dottedIdSchema,
  state: analysisStateSchema,
  value: finiteNumberSchema.optional(),
  unit: z8.string().min(1),
  numerator: finiteNumberSchema.nonnegative().optional(),
  denominator: finiteNumberSchema.positive().optional(),
  reason: z8.string().min(1).optional(),
  detail: z8.record(z8.string(), z8.unknown()).optional()
}).superRefine((metric, ctx) => {
  if (metric.state === "complete" && metric.value === undefined) {
    ctx.addIssue({
      code: "custom",
      message: "a complete metric must carry a finite value",
      path: ["value"]
    });
  }
  if ((metric.state === "unsupported" || metric.state === "not-applicable") && metric.value !== undefined) {
    ctx.addIssue({
      code: "custom",
      message: `a ${metric.state} metric must not carry a value`,
      path: ["value"]
    });
  }
  if (metric.state === "incomplete" && metric.reason === undefined) {
    ctx.addIssue({
      code: "custom",
      message: "an incomplete metric must carry a reason (what could not be analyzed)",
      path: ["reason"]
    });
  }
  if (metric.state !== "incomplete" && metric.reason !== undefined) {
    ctx.addIssue({
      code: "custom",
      message: "reason is only meaningful on an incomplete metric",
      path: ["reason"]
    });
  }
  if (metric.numerator === undefined !== (metric.denominator === undefined)) {
    ctx.addIssue({
      code: "custom",
      message: "numerator/denominator are a pair: both present or both absent",
      path: ["denominator"]
    });
  }
});

// src/contract/analysis-result.ts
var analysisResultSchema = z9.strictObject({
  provider: providerIdentitySchema,
  state: providerStateSchema,
  analysis: analysisIdentitySchema.optional(),
  reason: z9.string().min(1).optional(),
  location: relativePathSchema.optional(),
  observedCoverage: observedCoverageSchema.optional(),
  execution: executionMetadataSchema.optional(),
  metrics: z9.array(metricValueSchema).optional(),
  findings: z9.array(findingSchema).optional(),
  cloneEvidence: z9.array(cloneEvidenceSchema).optional()
}).superRefine((result, ctx) => {
  validateProvenance(result, ctx);
  validateNamespacing(result, ctx);
  validateState(result, ctx);
});
var MEASURED_OUTPUT_FIELDS = ["metrics", "findings", "cloneEvidence"];
function hasMeasuredOutput(result) {
  return MEASURED_OUTPUT_FIELDS.some((field) => result[field] !== undefined);
}
function addIssue(ctx, message, path) {
  ctx.addIssue({ code: "custom", message, path });
}
function validateProvenance(result, ctx) {
  if (hasMeasuredOutput(result) && result.analysis === undefined) {
    addIssue(ctx, "measured output (metrics, findings, clone evidence) requires the analysis identity that produced it", ["analysis"]);
  }
}
function isExternalEvidenceId(id, prefix) {
  return id.startsWith(prefix) && dottedIdSchema.safeParse(id.slice(prefix.length)).success;
}
function validateExternalNamespacing(result, ctx) {
  const prefix = `${EVIDENCE_NAMESPACE}.${result.provider.id}.`;
  for (const [index, metric] of (result.metrics ?? []).entries()) {
    if (!isExternalEvidenceId(metric.id, prefix)) {
      addIssue(ctx, `external metric ids must be namespaced "${prefix}<name>" — got "${metric.id}"`, ["metrics", index, "id"]);
    }
  }
  for (const [index, finding] of (result.findings ?? []).entries()) {
    if (!isExternalEvidenceId(finding.kind, prefix)) {
      addIssue(ctx, `external finding kinds must be namespaced "${prefix}<kind>" — got "${finding.kind}"`, ["findings", index, "kind"]);
    }
  }
}
function validateNativeNamespaceReserved(result, ctx) {
  const reserved = `${EVIDENCE_NAMESPACE}.`;
  for (const [index, metric] of (result.metrics ?? []).entries()) {
    if (metric.id.startsWith(reserved)) {
      addIssue(ctx, `native metric ids must not use the reserved "${reserved}" namespace — got "${metric.id}"`, ["metrics", index, "id"]);
    }
  }
  for (const [index, finding] of (result.findings ?? []).entries()) {
    if (finding.kind.startsWith(reserved)) {
      addIssue(ctx, `native finding kinds must not use the reserved "${reserved}" namespace — got "${finding.kind}"`, ["findings", index, "kind"]);
    }
  }
}
function validateNamespacing(result, ctx) {
  if (result.provider.kind === "external") {
    validateExternalNamespacing(result, ctx);
    return;
  }
  validateNativeNamespaceReserved(result, ctx);
}
function rejectExtras(result, ctx, fields, message) {
  for (const field of fields) {
    if (result[field] !== undefined) {
      addIssue(ctx, `${message}: "${field}" must be absent`, [field]);
    }
  }
}
var UNREQUESTED_FIELDS = [
  "analysis",
  "reason",
  "location",
  "observedCoverage",
  "execution",
  "metrics",
  "findings",
  "cloneEvidence"
];
var NEVER_RAN_FIELDS = ["observedCoverage", "metrics", "findings", "cloneEvidence"];
function validateNeverRan(result, ctx) {
  rejectExtras(result, ctx, NEVER_RAN_FIELDS, `a ${result.state} analysis never ran and cannot fabricate evidence`);
  if (result.reason === undefined) {
    addIssue(ctx, `a ${result.state} analysis must carry a reason`, ["reason"]);
  }
}
function requireCoverageWithinSelection(result, ctx) {
  const intended = new Set(result.analysis?.selection.files.map((file) => file.path) ?? []);
  for (const [index, path] of (result.observedCoverage?.analyzedFiles ?? []).entries()) {
    if (!intended.has(path)) {
      addIssue(ctx, `analyzed file "${path}" is outside the analysis selection`, [
        "observedCoverage",
        "analyzedFiles",
        index
      ]);
    }
  }
}
function requireCoverageGap(result, ctx) {
  const coverage = result.observedCoverage;
  const analysis = result.analysis;
  if (coverage === undefined || analysis === undefined) {
    return;
  }
  const fullyCovered = coverage.analyzedFiles.length === analysis.selection.files.length && coverage.diagnostics.length === 0 && coverage.unsupported.length === 0;
  if (fullyCovered) {
    addIssue(ctx, "an incomplete analysis must show a coverage gap (missing files, diagnostics, or unsupported context)", ["state"]);
  }
}
function validateIncomplete(result, ctx) {
  if (result.analysis === undefined) {
    addIssue(ctx, "an incomplete analysis must carry its analysis identity", ["analysis"]);
  }
  if (result.observedCoverage === undefined) {
    addIssue(ctx, "an incomplete analysis must carry what it did observe", ["observedCoverage"]);
  }
  if (result.reason === undefined) {
    addIssue(ctx, "an incomplete analysis must carry a reason (what could not be analyzed)", [
      "reason"
    ]);
  }
  requireCoverageWithinSelection(result, ctx);
  requireCoverageGap(result, ctx);
}
function requireCompleteCoverage(result, ctx) {
  const coverage = result.observedCoverage;
  if (coverage === undefined) {
    return;
  }
  if (coverage.diagnostics.length > 0) {
    addIssue(ctx, "a complete analysis carries no diagnostics", [
      "observedCoverage",
      "diagnostics"
    ]);
  }
  if (coverage.unsupported.length > 0) {
    addIssue(ctx, "a complete analysis carries no unsupported context", [
      "observedCoverage",
      "unsupported"
    ]);
  }
  const intended = (result.analysis?.selection.files ?? []).map((file) => file.path).join(`
`);
  if (coverage.analyzedFiles.join(`
`) !== intended) {
    addIssue(ctx, "a complete analysis must have observed exactly its selected files — empty or partial output cannot establish complete coverage", ["observedCoverage", "analyzedFiles"]);
  }
}
function validateComplete(result, ctx) {
  if (result.analysis === undefined) {
    addIssue(ctx, "a complete analysis must carry its analysis identity", ["analysis"]);
  }
  if (result.observedCoverage === undefined) {
    addIssue(ctx, "a complete analysis must carry asserted observed coverage", [
      "observedCoverage"
    ]);
  }
  if (result.reason !== undefined) {
    addIssue(ctx, "a complete analysis has no failure to explain", ["reason"]);
  }
  if (result.location !== undefined) {
    addIssue(ctx, "location is only meaningful for a failed or partial analysis", ["location"]);
  }
  requireCompleteCoverage(result, ctx);
}
function validateState(result, ctx) {
  switch (result.state) {
    case "unrequested":
      rejectExtras(result, ctx, UNREQUESTED_FIELDS, "an unrequested analysis carries no evidence");
      return;
    case "unavailable":
    case "unsupported":
      validateNeverRan(result, ctx);
      return;
    case "incomplete":
      validateIncomplete(result, ctx);
      return;
    case "complete":
      validateComplete(result, ctx);
  }
}
// src/contract/architecture-policy.ts
import { z as z10 } from "zod";
var DEPENDENCY_EDGE_KINDS = ["runtime", "type-only"];
var dependencyEdgeKindSchema = z10.enum(DEPENDENCY_EDGE_KINDS);
var ARCHITECTURE_ALLOWANCES = ["forbidden", "allowed"];
var architectureAllowanceSchema = z10.enum(ARCHITECTURE_ALLOWANCES);
var ARCHITECTURE_POLICY_VERSION = 1;
var MAX_ARCHITECTURE_RULES = 32;
var MAX_ARCHITECTURE_PATTERN_LENGTH = 256;
var MAX_ARCHITECTURE_RULE_NAME_LENGTH = 64;
var architecturePathPatternSchema = z10.string().min(2).max(MAX_ARCHITECTURE_PATTERN_LENGTH).superRefine((pattern, ctx) => {
  if (!pattern.startsWith("^")) {
    ctx.addIssue({
      code: "custom",
      message: "must be a start-anchored pattern (begin with '^') — unanchored selectors are ambiguous",
      path: []
    });
  }
  if (pattern.startsWith("^/")) {
    ctx.addIssue({
      code: "custom",
      message: "must match repo-relative POSIX paths, not absolute paths",
      path: []
    });
  }
  if (pattern.includes("..")) {
    ctx.addIssue({
      code: "custom",
      message: "must not contain '..' — selectors stay inside the audited root",
      path: []
    });
  }
  try {
    new RegExp(pattern);
  } catch {
    ctx.addIssue({
      code: "custom",
      message: "must be a valid regular expression",
      path: []
    });
  }
});
var architectureScopeSelectorSchema = z10.strictObject({
  path: architecturePathPatternSchema
});
var architectureRuleNameSchema = z10.string().regex(/^[a-z][a-z0-9-]*$/, "must be a kebab-case identifier").max(MAX_ARCHITECTURE_RULE_NAME_LENGTH);
function isSortedUnique2(values) {
  for (let i = 1;i < values.length; i++) {
    const previous = values[i - 1];
    const current = values[i];
    if (previous === undefined || current === undefined || previous >= current) {
      return false;
    }
  }
  return true;
}
var architectureEdgeKindsSchema = z10.array(dependencyEdgeKindSchema).min(1).superRefine((edges, ctx) => {
  if (!isSortedUnique2(edges)) {
    ctx.addIssue({
      code: "custom",
      message: "edge kinds must be unique and sorted (e.g. [runtime] or [runtime, type-only]) — one rule, one canonical edge set",
      path: []
    });
  }
});
var architectureBoundaryRuleSchema = z10.strictObject({
  kind: z10.literal("boundary"),
  name: architectureRuleNameSchema,
  allowance: architectureAllowanceSchema,
  edges: architectureEdgeKindsSchema,
  from: architectureScopeSelectorSchema,
  to: architectureScopeSelectorSchema
});
var architectureCycleRuleSchema = z10.strictObject({
  kind: z10.literal("cycle"),
  name: architectureRuleNameSchema,
  edges: architectureEdgeKindsSchema
});
var architectureUnresolvedRuleSchema = z10.strictObject({
  kind: z10.literal("unresolved"),
  name: architectureRuleNameSchema
});
var architectureRuleSchema = z10.discriminatedUnion("kind", [
  architectureBoundaryRuleSchema,
  architectureCycleRuleSchema,
  architectureUnresolvedRuleSchema
]);
function ruleSemanticsKey(rule) {
  switch (rule.kind) {
    case "boundary":
      return ["boundary", rule.allowance, rule.edges.join("+"), rule.from.path, rule.to.path].join("|");
    case "cycle":
      return ["cycle", rule.edges.join("+")].join("|");
    case "unresolved":
      return "unresolved";
  }
}
var dependencyCruiserProviderRequestSchema = z10.strictObject({
  rules: z10.array(architectureRuleSchema).max(MAX_ARCHITECTURE_RULES).optional()
}).superRefine((request, ctx) => {
  const rules = request.rules ?? [];
  const nameIndex = new Map;
  const semanticsName = new Map;
  const selectorAllowance = new Map;
  for (const [index, rule] of rules.entries()) {
    const previousIndex = nameIndex.get(rule.name);
    if (previousIndex !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: `rule name "${rule.name}" is declared twice (rules ${previousIndex} and ${index}) — rule names must be unique`,
        path: ["rules", index, "name"]
      });
    } else {
      nameIndex.set(rule.name, index);
    }
    const semantics = ruleSemanticsKey(rule);
    const previousName = semanticsName.get(semantics);
    if (previousName !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: `rule "${rule.name}" repeats the semantics of "${previousName}" — declare one rule per check`,
        path: ["rules", index]
      });
    } else {
      semanticsName.set(semantics, rule.name);
    }
    if (rule.kind === "boundary") {
      const selectorKey = [rule.from.path, rule.to.path, rule.edges.join("+")].join("|");
      const otherAllowance = selectorAllowance.get(selectorKey);
      if (otherAllowance !== undefined && otherAllowance !== rule.allowance) {
        ctx.addIssue({
          code: "custom",
          message: `rules over the same selectors and edge kinds cannot be both forbidden and allowed — "${rule.name}" contradicts an existing boundary`,
          path: ["rules", index, "allowance"]
        });
      } else if (otherAllowance === undefined) {
        selectorAllowance.set(selectorKey, rule.allowance);
      }
    }
  }
});
// src/contract/config.ts
import { z as z12 } from "zod";

// src/contract/reachability-policy.ts
import { z as z11 } from "zod";
var REACHABILITY_POLICY_VERSION = 1;
var MAX_REACHABILITY_ENTRY_FILES = 64;
var MAX_REACHABILITY_PUBLIC_SURFACES = 64;
var MAX_REACHABILITY_PATH_LENGTH = 256;
var MAX_REACHABILITY_EXPORT_NAME_LENGTH = 64;
var REACHABILITY_TEST_MODES = ["excluded", "roots"];
var reachabilityTestModeSchema = z11.enum(REACHABILITY_TEST_MODES);
var reachabilityPathSchema = z11.string().min(1).max(MAX_REACHABILITY_PATH_LENGTH).refine(isRepoRelativePath, "must be a repo-relative POSIX path");
var reachabilityExportNameSchema = z11.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/, "must be a JavaScript identifier").max(MAX_REACHABILITY_EXPORT_NAME_LENGTH);
var reachabilityPublicSurfaceSchema = z11.strictObject({
  path: reachabilityPathSchema,
  export: reachabilityExportNameSchema.optional()
});
var knipProviderRequestSchema = z11.strictObject({
  entries: z11.array(reachabilityPathSchema).max(MAX_REACHABILITY_ENTRY_FILES).optional(),
  public: z11.array(reachabilityPublicSurfaceSchema).max(MAX_REACHABILITY_PUBLIC_SURFACES).optional(),
  tests: reachabilityTestModeSchema.optional()
}).superRefine((request, ctx) => {
  const seenEntries = new Set;
  for (const [index, path] of (request.entries ?? []).entries()) {
    if (seenEntries.has(path)) {
      ctx.addIssue({
        code: "custom",
        message: `entry "${path}" is declared twice — declare each entry file once`,
        path: ["entries", index]
      });
    } else {
      seenEntries.add(path);
    }
  }
  const surfaceKey = (surface) => surface.export === undefined ? surface.path : `${surface.path}#${surface.export}`;
  const seenSurfaces = new Set;
  for (const [index, surface] of (request.public ?? []).entries()) {
    const key = surfaceKey(surface);
    if (seenSurfaces.has(key)) {
      ctx.addIssue({
        code: "custom",
        message: `public surface "${key}" is declared twice — declare each surface once`,
        path: ["public", index]
      });
    } else {
      seenSurfaces.add(key);
    }
  }
});

// src/contract/config.ts
var sourceConfigSchema = z12.strictObject({
  exclude: z12.array(z12.string().min(1)).default([]),
  classify: z12.record(z12.string().min(1), z12.enum(SOURCE_SETS)).default({})
});
var metricBudgetSchema = z12.strictObject({
  max: finiteNumberSchema.nonnegative()
});
var regressionPolicySchema = z12.strictObject({
  maxIncrease: finiteNumberSchema.min(0).max(100).optional(),
  maxIncreasePercent: finiteNumberSchema.min(0).optional()
});
var requiredAnalysisIdSchema = dottedIdSchema.superRefine((id, ctx) => {
  if (id === NATIVE_NAMESPACE || id.startsWith(`${NATIVE_NAMESPACE}.`)) {
    ctx.addIssue({
      code: "custom",
      message: "policy requirements demand optional provider evidence — native analyzers always run and are governed by metric budgets, never by requireEvidence"
    });
  }
  if (id.startsWith(`${EVIDENCE_NAMESPACE}.`)) {
    ctx.addIssue({
      code: "custom",
      message: 'policy requirements name an analysis id ("jscpd"), not a namespaced evidence id ("provider.jscpd.pairs") — budgets consume evidence ids'
    });
  }
});
var jscpdProviderRequestSchema = z12.strictObject({
  mode: z12.enum(CLONE_MATCH_MODES)
});
var undeliveredProviderRequestSchema = z12.strictObject({});
var providerSelectionSchema = z12.strictObject({
  jscpd: jscpdProviderRequestSchema.optional(),
  "dependency-cruiser": dependencyCruiserProviderRequestSchema.optional(),
  knip: knipProviderRequestSchema.optional(),
  sonarjs: undeliveredProviderRequestSchema.optional()
});
var policyConfigSchema = z12.strictObject({
  maxIndex: finiteNumberSchema.min(0).max(100).optional(),
  regression: regressionPolicySchema.optional(),
  budgets: z12.record(dottedIdSchema, metricBudgetSchema).default({}),
  failOnNew: z12.array(dottedIdSchema).default([]),
  requireEvidence: z12.array(requiredAnalysisIdSchema).default([])
});
var auditConfigSchema = z12.strictObject({
  source: sourceConfigSchema.prefault({}),
  providers: providerSelectionSchema.prefault({}),
  policy: policyConfigSchema.prefault({})
});
// src/contract/evidence.ts
import { z as z13 } from "zod";
var SCORING_ROLES = ["scored", "advisory"];
var scoringRoleSchema = z13.enum(SCORING_ROLES);
var GAP_STATES = new Set([
  "incomplete",
  "unavailable",
  "unsupported"
]);
function isSortedUnique3(values) {
  for (let i = 1;i < values.length; i++) {
    const previous = values[i - 1];
    const current = values[i];
    if (previous === undefined || current === undefined || previous >= current) {
      return false;
    }
  }
  return true;
}
var reportAnalysisSchema = analysisResultSchema.extend({
  scoring: scoringRoleSchema,
  metricIds: z13.array(dottedIdSchema)
}).superRefine((entry, ctx) => {
  const addIssue = (message, path) => {
    ctx.addIssue({ code: "custom", message, path });
  };
  if (!isSortedUnique3(entry.metricIds)) {
    addIssue("owned metric ids must be unique and sorted", ["metricIds"]);
  }
  if (entry.provider.kind === "native") {
    if (entry.metricIds.length === 0) {
      addIssue("a native analysis owns at least one metric id", ["metricIds"]);
    }
    for (const field of ["metrics", "findings", "cloneEvidence"]) {
      if (entry[field] !== undefined) {
        addIssue(`native evidence lives in the report's metrics map and findings, never duplicated per entry: "${field}" must be absent`, [field]);
      }
    }
    return;
  }
  if (entry.metricIds.length > 0) {
    addIssue("external evidence is namespaced inside its entry and never owns native metric ids", ["metricIds"]);
  }
});
var evidenceAreaSchema = z13.strictObject({
  completeness: z13.enum(["complete", "incomplete"]),
  analyses: z13.array(reportAnalysisSchema)
}).superRefine((area, ctx) => {
  if (!isSortedUnique3(area.analyses.map((analysis) => analysis.provider.id))) {
    ctx.addIssue({
      code: "custom",
      message: "analyses must be unique and ordered by provider id",
      path: ["analyses"]
    });
  }
});
function rollUpEvidenceCompleteness(analyses, metrics) {
  if (analyses.some((analysis) => GAP_STATES.has(analysis.state))) {
    return "incomplete";
  }
  return rollUpCompleteness(metrics.map((metric) => metric.state));
}
function rollUpScoreCompleteness(analyses, metrics) {
  for (const analysis of analyses) {
    if (analysis.scoring !== "scored")
      continue;
    if (GAP_STATES.has(analysis.state))
      return "incomplete";
    for (const id of analysis.metricIds) {
      if (metrics[id]?.state === "incomplete")
        return "incomplete";
    }
  }
  return "complete";
}
// src/contract/report.ts
import { z as z15 } from "zod";

// src/contract/safeguard.ts
import { z as z14 } from "zod";
var EVIDENCE_LEVELS = ["absent", "configured", "structurally-wired", "unknown"];
var safeguardLocationSchema = z14.strictObject({
  path: relativePathSchema,
  range: rangeSchema.optional()
});
var safeguardResultSchema = z14.strictObject({
  id: dottedIdSchema,
  evidence: z14.enum(EVIDENCE_LEVELS),
  locations: z14.array(safeguardLocationSchema),
  notes: z14.string().min(1).optional()
}).superRefine((result, ctx) => {
  if (result.evidence === "absent" && result.locations.length > 0) {
    ctx.addIssue({
      code: "custom",
      message: "an absent safeguard carries no locations",
      path: ["locations"]
    });
  }
  if ((result.evidence === "configured" || result.evidence === "structurally-wired") && result.locations.length === 0) {
    ctx.addIssue({
      code: "custom",
      message: `a ${result.evidence} safeguard must point at its configuration surface`,
      path: ["locations"]
    });
  }
});

// src/index.ts
var VERSION = "0.2.1-js.1";

// src/contract/version.ts
var ANALYZER_VERSION = VERSION;
var SCORING_VERSION = "0.2.0-provisional";
var SCHEMA_VERSION = "1.1.0";
var PRE_PROVIDER_SCHEMA_VERSION = "1.0.0";

// src/contract/report.ts
var scoreContributionSchema = z15.strictObject({
  dimension: dottedIdSchema,
  points: finiteNumberSchema.min(0).max(100),
  metricIds: z15.array(dottedIdSchema)
});
var scoreSchema = z15.strictObject({
  index: finiteNumberSchema.min(0).max(100),
  direction: z15.literal("lower-is-better"),
  partial: z15.boolean(),
  contributions: z15.array(scoreContributionSchema)
});
var repoMetadataSchema = z15.strictObject({
  root: z15.string().min(1),
  identity: z15.string().min(1).optional()
});
var runMetadataSchema = z15.strictObject({
  auditedAt: z15.iso.datetime().optional(),
  durationMs: finiteNumberSchema.nonnegative().optional()
});
var reportBody = {
  analyzerVersion: versionStringSchema,
  scoringVersion: versionStringSchema,
  repo: repoMetadataSchema,
  sourceCoverage: sourceCoverageSchema,
  completeness: z15.enum(["complete", "incomplete"]),
  metrics: z15.record(dottedIdSchema, metricValueSchema),
  score: scoreSchema,
  findings: z15.array(findingSchema),
  safeguards: z15.array(safeguardResultSchema),
  run: runMetadataSchema.optional()
};
function validateMeasurementHonesty(report, ctx) {
  for (const [key, metric] of Object.entries(report.metrics)) {
    if (key !== metric.id) {
      ctx.addIssue({
        code: "custom",
        message: `metrics key "${key}" must equal the metric id "${metric.id}"`,
        path: ["metrics", key, "id"]
      });
    }
  }
  const rolledUp = rollUpCompleteness(Object.values(report.metrics).map((metric) => metric.state));
  if (report.completeness !== rolledUp) {
    ctx.addIssue({
      code: "custom",
      message: `completeness "${report.completeness}" does not match the metric-state rollup "${rolledUp}"`,
      path: ["completeness"]
    });
  }
  for (const [i, contribution] of report.score.contributions.entries()) {
    for (const metricId of contribution.metricIds) {
      if (!(metricId in report.metrics)) {
        ctx.addIssue({
          code: "custom",
          message: `contribution "${contribution.dimension}" references unknown metric "${metricId}"`,
          path: ["score", "contributions", i, "metricIds"]
        });
      }
    }
  }
}
var preProviderAuditReportSchema = z15.strictObject({
  schemaVersion: z15.literal(PRE_PROVIDER_SCHEMA_VERSION),
  ...reportBody
}).superRefine((report, ctx) => {
  validateMeasurementHonesty(report, ctx);
  if (report.score.partial !== (report.completeness === "incomplete")) {
    ctx.addIssue({
      code: "custom",
      message: "score.partial must be true exactly when a metric is incomplete",
      path: ["score", "partial"]
    });
  }
});
function validateMetricOwnership(analyses, metrics, ctx) {
  const owners = new Map;
  for (const [i, analysis] of analyses.entries()) {
    for (const metricId of analysis.metricIds) {
      const previous = owners.get(metricId);
      if (previous !== undefined) {
        ctx.addIssue({
          code: "custom",
          message: `metric "${metricId}" is owned by both "${previous.providerId}" and "${analysis.provider.id}"`,
          path: ["evidence", "analyses", i, "metricIds"]
        });
        continue;
      }
      owners.set(metricId, { providerId: analysis.provider.id, scoring: analysis.scoring });
      if (!(metricId in metrics)) {
        ctx.addIssue({
          code: "custom",
          message: `analysis "${analysis.provider.id}" owns metric "${metricId}" which is absent from the report`,
          path: ["evidence", "analyses", i, "metricIds"]
        });
      }
    }
  }
  for (const key of Object.keys(metrics)) {
    if (!owners.has(key)) {
      ctx.addIssue({
        code: "custom",
        message: `metric "${key}" has no owning analysis`,
        path: ["metrics", key]
      });
    }
  }
  return owners;
}
function validateScoreContributors(contributions, owners, ctx) {
  for (const [i, contribution] of contributions.entries()) {
    for (const metricId of contribution.metricIds) {
      if (owners.get(metricId)?.scoring !== "scored") {
        ctx.addIssue({
          code: "custom",
          message: `contribution "${contribution.dimension}" must trace to metric "${metricId}" owned by a scored analysis`,
          path: ["score", "contributions", i, "metricIds"]
        });
      }
    }
  }
}
function validateCompletenessIndependence(report, ctx) {
  const scoreCompleteness = rollUpScoreCompleteness(report.evidence.analyses, report.metrics);
  if (report.score.partial !== (scoreCompleteness === "incomplete")) {
    ctx.addIssue({
      code: "custom",
      message: "score.partial must be true exactly when a declared scored input is incomplete — an advisory analysis never flips a complete score",
      path: ["score", "partial"]
    });
  }
  const evidenceCompleteness = rollUpEvidenceCompleteness(report.evidence.analyses, Object.values(report.metrics));
  if (report.evidence.completeness !== evidenceCompleteness) {
    ctx.addIssue({
      code: "custom",
      message: `evidence completeness "${report.evidence.completeness}" does not match the analyses/metric-state rollup "${evidenceCompleteness}"`,
      path: ["evidence", "completeness"]
    });
  }
}
var evidenceAuditReportSchema = z15.strictObject({
  schemaVersion: z15.literal(SCHEMA_VERSION),
  ...reportBody,
  evidence: evidenceAreaSchema
}).superRefine((report, ctx) => {
  validateMeasurementHonesty(report, ctx);
  const owners = validateMetricOwnership(report.evidence.analyses, report.metrics, ctx);
  validateScoreContributors(report.score.contributions, owners, ctx);
  validateCompletenessIndependence(report, ctx);
});
var auditReportSchema = z15.discriminatedUnion("schemaVersion", [
  preProviderAuditReportSchema,
  evidenceAuditReportSchema
]);
// src/analysis/provenance.ts
var MEASURED_SOURCE_SETS = ["production", "test"];
var ALL_SOURCE_SETS = SOURCE_SETS;
var SHARED_PARSE_ENGINE = "trellis.typescript";
function nativeAnalyzerIdentity(id, mode, options = {}) {
  return {
    kind: "native",
    id,
    toolVersion: ANALYZER_VERSION,
    adapterVersion: ANALYZER_VERSION,
    mode,
    options
  };
}
function contentFingerprint(text) {
  return createHash("sha256").update(text).digest("hex");
}
function nativeScope(inventory, sourceSets) {
  const sets = new Set(sourceSets);
  const files = inventory.files.filter((file) => sets.has(file.sourceSet));
  const diagnostics = files.flatMap((file) => file.diagnostics.map((diagnostic) => ({ path: file.path, message: diagnostic.message })));
  const bySourceSet = {};
  for (const file of files) {
    bySourceSet[file.sourceSet] = (bySourceSet[file.sourceSet] ?? 0) + 1;
  }
  const selection = {
    sourceSets: [...sourceSets].sort(),
    files: files.map((file) => ({
      path: file.path,
      fingerprint: contentFingerprint(file.sourceFile.text)
    })).sort((a, b) => a.path < b.path ? -1 : 1)
  };
  const diagnosticFiles = new Set(files.filter((file) => file.diagnostics.length > 0).map((file) => file.path));
  const outcome = diagnostics.length === 0 ? {
    state: "complete",
    observedCoverage: {
      analyzedFiles: selection.files.map((file) => file.path),
      bySourceSet,
      diagnostics: [],
      unsupported: []
    }
  } : {
    state: "incomplete",
    reason: `${diagnosticFiles.size} selected file(s) produced parse diagnostics; metric values are partial`,
    observedCoverage: {
      analyzedFiles: selection.files.map((file) => file.path),
      bySourceSet,
      diagnostics,
      unsupported: []
    }
  };
  return { selection, outcome };
}
function nativeAnalysisIdentity(scope, compilerVersion, options = {}) {
  return {
    selection: scope.selection,
    parser: { engine: SHARED_PARSE_ENGINE, version: compilerVersion },
    options
  };
}

// src/scoring/entry.ts
import { z as z16 } from "zod";
var NA_KINDS = ["not-applicable", "no-detector"];
var MAX_RATIONALE = 500;
var scorecardEntrySchema = z16.strictObject({
  numerator: z16.number().int().nonnegative().nullable(),
  denominator: z16.number().int().positive(),
  rationale: z16.string().min(1).max(MAX_RATIONALE),
  naKind: z16.enum(NA_KINDS).optional()
}).superRefine((entry, ctx) => {
  if (entry.numerator === null && entry.naKind === undefined) {
    ctx.addIssue({
      code: "custom",
      message: "naKind is required when numerator is null (N/A)",
      path: ["naKind"]
    });
  }
  if (entry.numerator !== null && entry.naKind !== undefined) {
    ctx.addIssue({
      code: "custom",
      message: "naKind must be absent when numerator is non-null",
      path: ["naKind"]
    });
  }
  if (entry.numerator !== null && entry.numerator > entry.denominator) {
    ctx.addIssue({
      code: "custom",
      message: "numerator must not exceed denominator",
      path: ["numerator"]
    });
  }
});
// src/scoring/formula.ts
var SCORING_FORMULA = {
  version: SCORING_VERSION,
  provisional: true,
  dimensions: [
    {
      dimension: "complexity-erosion",
      weight: 0.5,
      terms: [
        { metricId: "erosion.eroded-count.production", countScale: 20, share: 0.5 },
        { metricId: "erosion.eroded-share.production", saturatesAt: 0.25, share: 0.5 }
      ]
    },
    {
      dimension: "duplication",
      weight: 0.3,
      terms: [
        { metricId: "duplication.density.production", saturatesAt: 0.15, share: 0.5 },
        { metricId: "duplication.groups.production", countScale: 15, share: 0.5 }
      ]
    },
    {
      dimension: "import-cycle",
      weight: 0.2,
      terms: [
        { metricId: "import-cycle.density", saturatesAt: 0.1, share: 0.5 },
        { metricId: "import-cycle.groups", countScale: 5, share: 0.5 }
      ]
    }
  ]
};
function clamp01(value) {
  if (value <= 0)
    return 0;
  if (value >= 1)
    return 1;
  return value;
}
function normalizeTerm(value, saturatesAt) {
  return clamp01(value / saturatesAt) * 100;
}
function normalizeCount(value, scale) {
  const burden = Math.log1p(Math.max(0, value) / scale);
  return 100 * burden / (1 + burden);
}
function roundHalfUp(value) {
  return Math.floor(value + 0.5);
}
function apportionPoints(total, parts) {
  const target = roundHalfUp(total);
  const floored = parts.reduce((sum, part) => sum + Math.floor(part.exact), 0);
  const byFraction = [...parts].sort((a, b) => {
    const fractionA = a.exact - Math.floor(a.exact);
    const fractionB = b.exact - Math.floor(b.exact);
    if (fractionA !== fractionB)
      return fractionB - fractionA;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
  const apportioned = new Map(parts.map((part) => [part.key, Math.floor(part.exact)]));
  let left = Math.max(0, target - floored);
  for (const part of byFraction) {
    if (left <= 0)
      break;
    apportioned.set(part.key, (apportioned.get(part.key) ?? 0) + 1);
    left -= 1;
  }
  return apportioned;
}
// src/scoring/sloppiness.ts
function formatNumber(value) {
  return String(Number(value.toFixed(6)));
}
function scoreTerm(term, metric) {
  const base = {
    ...term
  };
  if (metric === undefined) {
    return { ...base, present: false, state: "missing", rawValue: null, normalized: 100 };
  }
  if (metric.state === "not-applicable") {
    return { ...base, present: true, state: metric.state, rawValue: null, normalized: 0 };
  }
  if (metric.state !== "complete" || metric.value === undefined) {
    const rawValue = metric.value ?? null;
    return { ...base, present: true, state: metric.state, rawValue, normalized: 100 };
  }
  return {
    ...base,
    present: true,
    state: "complete",
    rawValue: metric.value,
    normalized: "countScale" in term ? normalizeCount(metric.value, term.countScale) : normalizeTerm(metric.value, term.saturatesAt)
  };
}
function termTrace(term) {
  const raw = term.rawValue === null ? term.state : formatNumber(term.rawValue);
  return `${term.metricId} ${"countScale" in term ? `bounded-log(${raw}, scale=${term.countScale})` : `${raw}/${formatNumber(term.saturatesAt)}`} ` + `→ ${formatNumber(term.normalized)} (×${term.share})`;
}
function degradedExplanation(dimension, terms) {
  const causes = terms.filter((term) => term.state !== "complete" && term.state !== "not-applicable").map((term) => `${term.metricId} ${term.state}`).join(", ");
  return `${dimension} degraded (${causes}): scored at maximum 100 — ` + "missing analysis is never treated as zero debt";
}
function scoreDimension(dimension, byId) {
  const terms = dimension.terms.map((term) => scoreTerm(term, byId.get(term.metricId)));
  const degraded = terms.some((term) => term.state !== "complete" && term.state !== "not-applicable");
  const normalized = degraded ? 100 : terms.reduce((sum, term) => sum + term.share * term.normalized, 0);
  const explanation = degraded ? degradedExplanation(dimension.dimension, terms) : `${dimension.dimension} = weight ${dimension.weight} × normalized ${formatNumber(normalized)} [${terms.map(termTrace).join("; ")}]`;
  return {
    dimension: dimension.dimension,
    weight: dimension.weight,
    state: degraded ? "degraded" : "scored",
    normalized,
    exactPoints: dimension.weight * normalized,
    points: 0,
    metricIds: terms.filter((term) => term.present).map((term) => term.metricId).sort(),
    terms,
    explanation
  };
}
function scoreSloppiness(metrics) {
  const byId = new Map;
  for (const metric of metrics) {
    if (byId.has(metric.id)) {
      throw new Error(`duplicate metric id "${metric.id}" in scoring input`);
    }
    byId.set(metric.id, metric);
  }
  const scored = SCORING_FORMULA.dimensions.map((dimension) => scoreDimension(dimension, byId));
  scored.sort((a, b) => a.dimension < b.dimension ? -1 : 1);
  const missing = scored.flatMap((dimension) => dimension.terms.filter((term) => !term.present).map((term) => term.metricId)).sort();
  const partial = metrics.some((metric) => metric.state === "incomplete") || missing.length > 0;
  const total = scored.reduce((sum, dimension) => sum + dimension.exactPoints, 0);
  const index = Math.min(100, Math.max(0, roundHalfUp(total)));
  const apportioned = apportionPoints(total, scored.map((dimension) => ({ key: dimension.dimension, exact: dimension.exactPoints })));
  const dimensions = scored.map((dimension) => ({
    ...dimension,
    points: apportioned.get(dimension.dimension) ?? 0
  }));
  return {
    scoringVersion: SCORING_VERSION,
    provisional: true,
    direction: "lower-is-better",
    index,
    partial,
    missing,
    dimensions,
    score: {
      index,
      direction: "lower-is-better",
      partial,
      contributions: dimensions.map((dimension) => ({
        dimension: dimension.dimension,
        points: dimension.points,
        metricIds: dimension.metricIds
      }))
    }
  };
}
// src/analysis/registry.ts
function requireValidIdentity(registration) {
  const parsed = providerIdentitySchema.safeParse(registration.identity);
  if (parsed.success)
    return;
  const issue = parsed.error.issues[0];
  const path = issue === undefined ? "" : `${issue.path.join(".")}: `;
  const message = issue === undefined ? "invalid provider identity" : issue.message;
  throw new Error(`native analyzer identity "${registration.identity.id}" is invalid: ${path}${message}`);
}
function requireUniqueIds(registrations) {
  const seen = new Set;
  for (const registration of registrations) {
    const id = registration.identity.id;
    if (seen.has(id)) {
      throw new Error(`analyzer "${id}" is registered more than once`);
    }
    seen.add(id);
  }
}
function requireSoleOwnership(registrations, field, label) {
  const owners = new Map;
  for (const registration of registrations) {
    for (const id of registration[field]) {
      const previous = owners.get(id);
      if (previous !== undefined) {
        throw new Error(`${label} "${id}" is declared by both "${previous}" and "${registration.identity.id}"`);
      }
      owners.set(id, registration.identity.id);
    }
  }
}
function requireRegisteredPrerequisites(byId) {
  for (const [id, registration] of byId) {
    for (const prerequisite of registration.requires) {
      if (!byId.has(prerequisite)) {
        throw new Error(`analyzer "${id}" requires unregistered analyzer "${prerequisite}"`);
      }
    }
  }
}
function requireAcyclic(byId) {
  const visiting = new Set;
  const stack = [];
  const walk = (id) => {
    if (visiting.has(id)) {
      const start = stack.lastIndexOf(id);
      const loop = stack.slice(start === -1 ? 0 : start);
      const smallest = loop.indexOf([...loop].sort()[0] ?? id);
      const rotated = [...loop.slice(smallest), ...loop.slice(0, smallest)];
      const canonical = [...rotated, rotated[0] ?? id];
      throw new Error(`analyzer dependency cycle: ${canonical.map((x) => `"${x}"`).join(" -> ")}`);
    }
    if (!byId.has(id))
      return;
    visiting.add(id);
    stack.push(id);
    for (const prerequisite of byId.get(id)?.requires ?? [])
      walk(prerequisite);
    stack.pop();
    visiting.delete(id);
  };
  for (const id of [...byId.keys()].sort())
    walk(id);
}
function buildNativeRegistry(registrations) {
  for (const registration of registrations)
    requireValidIdentity(registration);
  requireUniqueIds(registrations);
  requireSoleOwnership(registrations, "capabilities", "capability");
  requireSoleOwnership(registrations, "metrics", "metric");
  const byId = new Map(registrations.map((registration) => [registration.identity.id, registration]));
  requireRegisteredPrerequisites(byId);
  requireAcyclic(byId);
  const analyzers = [...byId.values()].sort((a, b) => a.identity.id < b.identity.id ? -1 : a.identity.id > b.identity.id ? 1 : 0);
  const registry = {
    analyzers,
    get: (id) => byId.get(id),
    has: (id) => byId.has(id),
    ordered: () => topologicalOrder(analyzers)
  };
  return registry;
}
function topologicalOrder(analyzers) {
  const remaining = new Map(analyzers.map((analyzer) => [analyzer.identity.id, analyzer]));
  const ordered = [];
  while (remaining.size > 0) {
    const ready = [...remaining.values()].filter((analyzer) => analyzer.requires.every((id) => !remaining.has(id))).sort((a, b) => a.identity.id < b.identity.id ? -1 : 1);
    const next = ready[0];
    if (next === undefined) {
      throw new Error("analyzer dependency cycle detected while ordering the registry");
    }
    remaining.delete(next.identity.id);
    ordered.push(next);
  }
  return ordered;
}
function scoringCatalogMetricIds() {
  return [
    ...new Set(SCORING_FORMULA.dimensions.flatMap((dimension) => dimension.terms.map((term) => term.metricId)))
  ].sort();
}
function requiredForScoring(registry, catalog = scoringCatalogMetricIds()) {
  const byMetric = new Map;
  for (const analyzer of registry.analyzers) {
    for (const metric of analyzer.metrics)
      byMetric.set(metric, analyzer.identity.id);
  }
  const required = new Set;
  const addTransitively = (id) => {
    if (required.has(id))
      return;
    required.add(id);
    for (const prerequisite of registry.get(id)?.requires ?? [])
      addTransitively(prerequisite);
  };
  for (const metric of catalog) {
    const owner = byMetric.get(metric);
    if (owner !== undefined)
      addTransitively(owner);
  }
  return [...required].sort();
}

// src/analysis/native.ts
function scopeFields(scope) {
  const { outcome } = scope;
  return {
    state: outcome.state,
    observedCoverage: outcome.observedCoverage,
    ...outcome.reason === undefined ? {} : { reason: outcome.reason }
  };
}
function runComplexityAnalysis(syntax) {
  const product = analyzeComplexity(syntax);
  const scope = nativeScope(syntax, MEASURED_SOURCE_SETS);
  return {
    product,
    result: {
      provider: nativeAnalyzerIdentity("trellis.complexity", "shared-parse"),
      ...scopeFields(scope),
      analysis: nativeAnalysisIdentity(scope, syntax.compilerVersion),
      metrics: product.metrics,
      findings: product.findings
    }
  };
}
function cloneGroupEvidence(groups) {
  return groups.map((group) => ({
    kind: "group",
    matchMode: "normalized",
    members: group.members.map((member) => ({ path: member.path, range: member.range })).sort(compareCloneLocations)
  }));
}
function runDuplicationAnalysis(syntax, options = {}) {
  const product = analyzeDuplication(syntax, options);
  const scope = nativeScope(syntax, MEASURED_SOURCE_SETS);
  const budget = options.budget ?? DEFAULT_DUPLICATION_BUDGET;
  return {
    product,
    result: {
      provider: nativeAnalyzerIdentity("trellis.duplication", "shared-parse"),
      ...scopeFields(scope),
      analysis: nativeAnalysisIdentity(scope, syntax.compilerVersion, {
        "max-tokens": budget.maxTokens,
        "max-match-work": budget.maxMatchWork
      }),
      metrics: product.metrics,
      findings: product.findings,
      cloneEvidence: cloneGroupEvidence([
        ...product.scopes.production.groups,
        ...product.scopes.test.groups
      ]),
      products: {
        clones: {
          groups: [...product.scopes.production.groups, ...product.scopes.test.groups]
        }
      }
    }
  };
}
function runDependencyGraphAnalysis(source, syntax) {
  const product = analyzeDependencyGraph(source, syntax);
  const scope = nativeScope(syntax, ALL_SOURCE_SETS);
  return {
    product,
    result: {
      provider: nativeAnalyzerIdentity("trellis.dependency-graph", "shared-parse"),
      ...scopeFields(scope),
      analysis: nativeAnalysisIdentity(scope, syntax.compilerVersion),
      metrics: product.metrics,
      findings: product.findings,
      products: {
        graph: { nodes: product.graph.nodes, edges: product.graph.edges }
      }
    }
  };
}
function runImportCycleAnalysis(graph) {
  const product = analyzeCycles(graph.product);
  return {
    product,
    result: {
      provider: nativeAnalyzerIdentity("trellis.import-cycles", "graph"),
      state: graph.result.state,
      analysis: graph.result.analysis,
      observedCoverage: graph.result.observedCoverage,
      ...graph.result.reason === undefined ? {} : { reason: graph.result.reason },
      metrics: product.metrics,
      findings: product.findings
    }
  };
}
async function runSafeguardInspection(root) {
  return { product: await inspectSafeguards(root) };
}
var COMPLEXITY_METRICS = [
  "complexity.cc.max.production",
  "complexity.cc.max.test",
  "complexity.cc.p50.production",
  "complexity.cc.p50.test",
  "complexity.cc.p90.production",
  "complexity.cc.p90.test",
  "complexity.functions.production",
  "complexity.functions.test",
  "complexity.nesting.max.production",
  "complexity.nesting.max.test",
  "erosion.eroded-count.production",
  "erosion.eroded-count.test",
  "erosion.eroded-share.production",
  "erosion.eroded-share.test",
  "erosion.mass.production",
  "erosion.mass.test"
];
var DUPLICATION_METRICS = [
  "duplication.density.production",
  "duplication.density.test",
  "duplication.duplicated-lines.production",
  "duplication.duplicated-lines.test",
  "duplication.groups.production",
  "duplication.groups.test"
];
var GRAPH_METRICS = [
  "graph.edges.external",
  "graph.edges.local",
  "graph.edges.unresolved",
  "graph.files"
];
var CYCLE_METRICS = [
  "import-cycle.density",
  "import-cycle.groups",
  "import-cycle.modules"
];
var complexityAnalyzer = {
  identity: nativeAnalyzerIdentity("trellis.complexity", "shared-parse"),
  capabilities: ["complexity"],
  metrics: COMPLEXITY_METRICS,
  requires: []
};
var duplicationAnalyzer = {
  identity: nativeAnalyzerIdentity("trellis.duplication", "shared-parse"),
  capabilities: ["duplication"],
  metrics: DUPLICATION_METRICS,
  requires: []
};
var dependencyGraphAnalyzer = {
  identity: nativeAnalyzerIdentity("trellis.dependency-graph", "shared-parse"),
  capabilities: ["dependency-graph"],
  metrics: GRAPH_METRICS,
  requires: []
};
var importCyclesAnalyzer = {
  identity: nativeAnalyzerIdentity("trellis.import-cycles", "graph"),
  capabilities: ["import-cycles"],
  metrics: CYCLE_METRICS,
  requires: ["trellis.dependency-graph"]
};
var safeguardsAnalyzer = {
  identity: nativeAnalyzerIdentity("trellis.safeguards", "configuration-inspection"),
  capabilities: ["safeguards"],
  metrics: [],
  requires: []
};
var NATIVE_REGISTRY = buildNativeRegistry([
  complexityAnalyzer,
  duplicationAnalyzer,
  dependencyGraphAnalyzer,
  importCyclesAnalyzer,
  safeguardsAnalyzer
]);
function nativeScoringRequiredIds() {
  return requiredForScoring(NATIVE_REGISTRY);
}
// src/analysis/result.ts
function toContractResult(result) {
  const { products: _products, ...contract } = result;
  return contract;
}
// src/config/load.ts
import { readFile as readFile3 } from "node:fs/promises";
import { join as join4 } from "node:path";
import yaml2 from "js-yaml";
var CONFIG_FILENAMES = ["trellis.yaml", "trellis.yml"];
function parseConfig2(text, name) {
  const data = yaml2.load(text) ?? {};
  const parsed = auditConfigSchema.safeParse(data);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`).join("; ");
    throw new Error(`invalid ${name}: ${details}`);
  }
  return parsed.data;
}
async function loadAuditConfig(root) {
  for (const name of CONFIG_FILENAMES) {
    let text;
    try {
      text = await readFile3(join4(root, name), "utf8");
    } catch {
      continue;
    }
    return parseConfig2(text, name);
  }
  return auditConfigSchema.parse({});
}
// src/discovery/glob.ts
var SEGMENT_CACHE = new Map;
function segmentRegExp(segment) {
  const cached = SEGMENT_CACHE.get(segment);
  if (cached)
    return cached;
  const source = segment.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]");
  const re = new RegExp(`^${source}$`);
  SEGMENT_CACHE.set(segment, re);
  return re;
}
function matchFrom(pattern, pi, path, si) {
  if (pi === pattern.length)
    return si === path.length;
  const segment = pattern[pi];
  if (segment === undefined)
    return si === path.length;
  if (segment === "**") {
    for (let skip = si;skip <= path.length; skip++) {
      if (matchFrom(pattern, pi + 1, path, skip))
        return true;
    }
    return false;
  }
  const value = path[si];
  if (value === undefined)
    return false;
  return segmentRegExp(segment).test(value) && matchFrom(pattern, pi + 1, path, si + 1);
}
function matchGlob(pattern, path) {
  return matchFrom(pattern.split("/"), 0, path.split("/"), 0);
}
function matchAnyGlob(patterns, path) {
  return patterns.some((pattern) => matchGlob(pattern, path));
}

// src/discovery/classify.ts
var TS_SOURCE_RE = /\.(?:ts|tsx|mts|cts)$/;
var JAVASCRIPT_SOURCE_RE = /\.(?:js|mjs|cjs)$/;
var DECLARATION_RE = /\.d\.(?:ts|mts|cts)$/;
var TEST_BASENAME_RE = /\.(?:test|spec)\.[^.]+$/;
var GENERATED_BASENAME_RE = /\.(?:gen|generated)\.[^.]+$/;
var VENDORED_DIRS = new Set(["vendor", "third_party"]);
var GENERATED_DIRS = new Set(["generated", "__generated__"]);
var TEST_DIRS = new Set(["test", "tests", "__tests__"]);
var UNSUPPORTED_SOURCE_EXTENSIONS = [
  ".jsx",
  ".py",
  ".swift",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".kts",
  ".rb",
  ".php",
  ".c",
  ".h",
  ".cc",
  ".cpp",
  ".hpp",
  ".cs",
  ".scala"
];
function isTypeScriptSource(path) {
  return TS_SOURCE_RE.test(path);
}
function isSupportedSource(path) {
  return isTypeScriptSource(path) || JAVASCRIPT_SOURCE_RE.test(path);
}
function isUnsupportedSource(path) {
  const dot = path.lastIndexOf(".");
  if (dot < 0)
    return false;
  const ext = path.slice(dot).toLowerCase();
  return UNSUPPORTED_SOURCE_EXTENSIONS.includes(ext);
}
function classifyTsFile(path, config) {
  const overrides = config?.classify ?? {};
  for (const pattern of Object.keys(overrides).sort()) {
    if (matchGlob(pattern, path)) {
      const set = overrides[pattern];
      return { sourceSet: set, rule: `config:classify:${pattern}` };
    }
  }
  const segments = path.split("/");
  const basename = segments[segments.length - 1] ?? path;
  const dirs = segments.slice(0, -1);
  if (dirs.some((segment) => VENDORED_DIRS.has(segment))) {
    return { sourceSet: "vendored", rule: "default:vendored-dir" };
  }
  if (dirs.some((segment) => GENERATED_DIRS.has(segment)) || GENERATED_BASENAME_RE.test(basename)) {
    return { sourceSet: "generated", rule: "default:generated" };
  }
  if (DECLARATION_RE.test(basename)) {
    return { sourceSet: "declaration-only", rule: "default:declaration" };
  }
  if (TEST_BASENAME_RE.test(basename) || dirs.some((segment) => TEST_DIRS.has(segment))) {
    return { sourceSet: "test", rule: "default:test" };
  }
  return { sourceSet: "production", rule: "default:production" };
}
// src/discovery/discover.ts
var EXCLUDED_DIRS = new Set([
  "node_modules",
  "vendor",
  "dist",
  "build",
  "out",
  "coverage",
  "target",
  "__pycache__",
  "venv"
]);
// src/discovery/inventory.ts
import { readdir as readdir2, readFile as readFile4, stat as stat2 } from "node:fs/promises";
import { join as join5, resolve as resolve2 } from "node:path";
import yaml3 from "js-yaml";
var DEPENDENCY_DIRS = new Set(["node_modules"]);
var BUILD_OUTPUT_DIRS = new Set(["dist", "build", "out", "coverage"]);
function handleFile(state, rel, name, inBuildOutput, exclude) {
  if (name === "package.json") {
    if (inBuildOutput || matchAnyGlob(exclude, rel))
      return;
    const dir = rel === name ? "" : rel.slice(0, -(name.length + 1));
    state.manifestDirs.push(dir);
    return;
  }
  if (isSupportedSource(rel)) {
    if (inBuildOutput)
      state.excluded.push({ path: rel, reason: "build-output" });
    else if (matchAnyGlob(exclude, rel))
      state.excluded.push({ path: rel, reason: "config-exclude" });
    else
      state.tsFiles.push(rel);
    return;
  }
  if (!inBuildOutput && !matchAnyGlob(exclude, rel) && isUnsupportedSource(rel)) {
    const ext = rel.slice(rel.lastIndexOf(".")).toLowerCase();
    state.unsupportedByExt.set(ext, (state.unsupportedByExt.get(ext) ?? 0) + 1);
  }
}
async function handleDirectory(ctx, name, rel) {
  if (name.startsWith(".")) {
    ctx.state.ignored.push({ path: rel, reason: "dot-dir" });
    return;
  }
  if (DEPENDENCY_DIRS.has(name)) {
    ctx.state.ignored.push({ path: rel, reason: "dependency-dir" });
    return;
  }
  await walk({
    ...ctx,
    absDir: join5(ctx.absDir, name),
    relDir: rel,
    inBuildOutput: ctx.inBuildOutput || BUILD_OUTPUT_DIRS.has(name)
  });
}
async function handleSymlink(ctx, name, rel) {
  const target = await stat2(join5(ctx.absDir, name)).catch(() => null);
  if (target?.isFile())
    handleFile(ctx.state, rel, name, ctx.inBuildOutput, ctx.exclude);
  else
    ctx.state.ignored.push({ path: rel, reason: "symlink" });
}
async function walk(ctx) {
  const entries = await readdir2(ctx.absDir, { withFileTypes: true });
  const sorted = [...entries].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  for (const entry of sorted) {
    const rel = ctx.relDir === "" ? entry.name : `${ctx.relDir}/${entry.name}`;
    if (entry.isDirectory())
      await handleDirectory(ctx, entry.name, rel);
    else if (entry.isFile())
      handleFile(ctx.state, rel, entry.name, ctx.inBuildOutput, ctx.exclude);
    else if (entry.isSymbolicLink())
      await handleSymlink(ctx, entry.name, rel);
  }
}
async function readManifest(absPath) {
  try {
    const parsed = JSON.parse(await readFile4(absPath, "utf8"));
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}
function stringEntries(value) {
  if (!Array.isArray(value))
    return [];
  return value.filter((entry) => typeof entry === "string");
}
function manifestWorkspaceGlobs(rootManifest) {
  const workspaces = rootManifest.workspaces;
  if (Array.isArray(workspaces))
    return stringEntries(workspaces);
  if (typeof workspaces === "object" && workspaces !== null) {
    return stringEntries(workspaces.packages);
  }
  return [];
}
async function pnpmWorkspaceGlobs(root) {
  try {
    const parsed = yaml3.load(await readFile4(join5(root, "pnpm-workspace.yaml"), "utf8"));
    return stringEntries(parsed?.packages);
  } catch {
    return [];
  }
}
async function readWorkspaceGlobs(root, rootManifest) {
  return [...manifestWorkspaceGlobs(rootManifest), ...await pnpmWorkspaceGlobs(root)];
}
function isDeclared(globs, dir) {
  const positive = globs.filter((glob) => !glob.startsWith("!"));
  const negative = globs.filter((glob) => glob.startsWith("!")).map((glob) => glob.slice(1));
  return matchAnyGlob(positive, dir) && !matchAnyGlob(negative, dir);
}
function ownerOf(relPath, manifestDirs) {
  let owner = ".";
  let depth = 0;
  for (const dir of manifestDirs) {
    if (dir !== "" && relPath.startsWith(`${dir}/`)) {
      const dirDepth = dir.split("/").length;
      if (dirDepth > depth) {
        owner = dir;
        depth = dirDepth;
      }
    }
  }
  return owner;
}
function byPath(a, b) {
  if (a.path === ".")
    return b.path === "." ? 0 : -1;
  if (b.path === ".")
    return 1;
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}
async function discoverSourceInventory(root, opts = {}) {
  const absRoot = resolve2(root);
  const exclude = opts.source?.exclude ?? [];
  const state = {
    tsFiles: [],
    excluded: [],
    unsupportedByExt: new Map,
    ignored: [],
    manifestDirs: []
  };
  await walk({ absDir: absRoot, relDir: "", inBuildOutput: false, exclude, state });
  const manifestDirs = [...new Set(state.manifestDirs)].sort();
  const rootManifest = await readManifest(join5(absRoot, "package.json"));
  const workspaceGlobs = await readWorkspaceGlobs(absRoot, rootManifest);
  const packages = [];
  for (const dir of manifestDirs) {
    const path = dir === "" ? "." : dir;
    const manifest = dir === "" ? rootManifest : await readManifest(join5(absRoot, dir, "package.json"));
    const name = typeof manifest.name === "string" ? manifest.name : undefined;
    packages.push({
      path,
      ...name === undefined ? {} : { name },
      hasManifest: true,
      declared: dir === "" || isDeclared(workspaceGlobs, dir)
    });
  }
  if (!manifestDirs.includes("")) {
    packages.push({ path: ".", hasManifest: false, declared: false });
  }
  const files = state.tsFiles.map((rel) => {
    const { sourceSet, rule } = classifyTsFile(rel, opts.source);
    return { path: rel, sourceSet, packagePath: ownerOf(rel, manifestDirs), rule };
  });
  const ownedTs = new Set(files.map((file) => file.packagePath));
  const unsupportedPackages = packages.filter((pkg) => pkg.hasManifest && !ownedTs.has(pkg.path)).map((pkg) => pkg.path).sort();
  return {
    root: absRoot,
    packages: packages.sort(byPath),
    files: files.sort(byPath),
    excluded: state.excluded.sort(byPath),
    unsupported: {
      files: [...state.unsupportedByExt.values()].reduce((sum, n) => sum + n, 0),
      byExtension: Object.fromEntries([...state.unsupportedByExt.entries()].sort())
    },
    ignored: state.ignored.sort(byPath),
    unsupportedPackages
  };
}
function toSourceCoverage(inventory) {
  const count = (set) => inventory.files.filter((file) => file.sourceSet === set).length;
  const coverage = {
    production: { files: count("production") },
    test: { files: count("test") }
  };
  const generated = count("generated");
  if (generated > 0)
    coverage.generated = { files: generated };
  const vendored = count("vendored");
  if (vendored > 0)
    coverage.vendored = { files: vendored };
  const declarations = count("declaration-only");
  if (declarations > 0)
    coverage["declaration-only"] = { files: declarations };
  if (inventory.excluded.length > 0) {
    coverage.excluded = {
      files: inventory.excluded.length,
      note: "build outputs and config-excluded paths — not analyzed"
    };
  }
  if (inventory.unsupported.files > 0) {
    coverage.unsupported = {
      files: inventory.unsupported.files,
      note: "unsupported source languages, not analyzed"
    };
  }
  return coverage;
}
// src/audit/assemble.ts
function collectMetrics(sources) {
  const seen = new Set;
  const metrics = sources.flatMap((source) => source.metrics);
  for (const metric of metrics) {
    if (seen.has(metric.id)) {
      throw new Error(`duplicate metric id "${metric.id}" across analyzers`);
    }
    seen.add(metric.id);
  }
  return metrics.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
function orderFindings(sources) {
  return sources.flatMap((source) => source.findings).sort((a, b) => a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0);
}
function slocBySet(syntax) {
  const sums = new Map;
  for (const file of syntax.files) {
    sums.set(file.sourceSet, (sums.get(file.sourceSet) ?? 0) + file.lines.code);
  }
  return sums;
}
function reportCoverage(source, syntax) {
  const coverage = toSourceCoverage(source);
  const sloc = slocBySet(syntax);
  const withSloc = (set) => {
    const lines = sloc.get(set);
    return lines === undefined ? {} : { sloc: lines };
  };
  return {
    ...coverage,
    production: { ...coverage.production, ...withSloc("production") },
    test: { ...coverage.test, ...withSloc("test") },
    ...coverage.generated === undefined ? {} : { generated: { ...coverage.generated, ...withSloc("generated") } },
    ...coverage.vendored === undefined ? {} : { vendored: { ...coverage.vendored, ...withSloc("vendored") } },
    ...coverage["declaration-only"] === undefined ? {} : {
      "declaration-only": {
        ...coverage["declaration-only"],
        ...withSloc("declaration-only")
      }
    }
  };
}
function repoMetadata(source) {
  const rootPackage = source.packages.find((pkg) => pkg.path === ".");
  return {
    root: source.root,
    ...rootPackage?.name === undefined ? {} : { identity: rootPackage.name }
  };
}
function evidenceEntry(analysis) {
  const { metrics, findings, cloneEvidence, ...provenance } = analysis.result;
  if (analysis.result.provider.kind === "native") {
    return {
      scoring: analysis.scoring,
      metricIds: [...analysis.metricIds],
      ...provenance
    };
  }
  return {
    scoring: analysis.scoring,
    metricIds: [...analysis.metricIds],
    ...provenance,
    ...metrics === undefined ? {} : { metrics },
    ...findings === undefined ? {} : { findings },
    ...cloneEvidence === undefined ? {} : { cloneEvidence }
  };
}
function providerEvidenceEntry(result) {
  return { scoring: "advisory", metricIds: [], ...result };
}
function assembleEvidence(analyses, providers, metrics) {
  const entries = [...analyses.map(evidenceEntry), ...providers.map(providerEvidenceEntry)].sort((a, b) => a.provider.id < b.provider.id ? -1 : a.provider.id > b.provider.id ? 1 : 0);
  return {
    completeness: rollUpEvidenceCompleteness(entries, metrics),
    analyses: entries
  };
}
function assembleReport(measurements, scoring, meta = {}) {
  const metrics = collectMetrics(measurements.analyses);
  const findings = orderFindings([...measurements.analyses, measurements.safeguards]);
  const run = meta.auditedAt === undefined && meta.durationMs === undefined ? {} : {
    run: {
      ...meta.auditedAt === undefined ? {} : { auditedAt: meta.auditedAt },
      ...meta.durationMs === undefined ? {} : { durationMs: meta.durationMs }
    }
  };
  return evidenceAuditReportSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    analyzerVersion: ANALYZER_VERSION,
    scoringVersion: scoring.scoringVersion,
    repo: repoMetadata(measurements.source),
    sourceCoverage: reportCoverage(measurements.source, measurements.syntax),
    completeness: rollUpCompleteness(metrics.map((metric) => metric.state)),
    evidence: assembleEvidence(measurements.analyses, measurements.providers ?? [], metrics),
    metrics: Object.fromEntries(metrics.map((metric) => [metric.id, metric])),
    score: scoring.score,
    findings,
    safeguards: measurements.safeguards.results,
    ...run
  });
}

// src/audit/progress.ts
var ANALYZER_IDS = [
  "complexity",
  "dependency-graph",
  "duplication",
  "import-cycles"
];
var NATIVE_ID_NAMESPACE = "trellis.";
function analyzerProgressId(registryId) {
  const id = registryId.slice(NATIVE_ID_NAMESPACE.length);
  for (const known of ANALYZER_IDS) {
    if (known === id)
      return known;
  }
  throw new Error(`native analyzer "${registryId}" has no progress id in ANALYZER_IDS`);
}

// src/providers/capabilities.ts
import { z as z17 } from "zod";
var PROVIDER_SUPPORT_STATUSES = ["delivered", "adapter-pending", "deferred"];
var seedsIdSchema = z17.string().regex(/^trellis-[a-z0-9]{4}$/, "must be a seeds tracker id");
var decisionRecordPathSchema = relativePathSchema.refine((path) => path.startsWith("docs/"), "the decision record is a repo-relative path under docs/");
var deferredDecisionSchema = z17.strictObject({
  outcome: z17.literal("deferred"),
  record: decisionRecordPathSchema,
  issue: seedsIdSchema,
  prerequisite: seedsIdSchema
});
var providerCapabilityStatusSchema = z17.strictObject({
  providerId: providerIdSchema,
  capabilityIds: z17.array(dottedIdSchema).min(1),
  unscored: z17.literal(true),
  status: z17.enum(PROVIDER_SUPPORT_STATUSES),
  requestState: providerStateSchema.optional(),
  reason: z17.string().min(1),
  decision: deferredDecisionSchema.optional()
}).superRefine((entry, ctx) => {
  const isNativeNamespace = entry.providerId === NATIVE_NAMESPACE || entry.providerId.startsWith(`${NATIVE_NAMESPACE}.`);
  if (isNativeNamespace) {
    ctx.addIssue({
      code: "custom",
      message: "external provider metadata must not use the reserved 'trellis.' namespace",
      path: ["providerId"]
    });
  }
  if (entry.status === "delivered") {
    if (entry.requestState !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "a delivered capability resolves per run — requestState records only capabilities whose requests cannot execute",
        path: ["requestState"]
      });
    }
  } else if (entry.requestState !== "unsupported") {
    ctx.addIssue({
      code: "custom",
      message: "a provider in this table has no executable capability: its requests resolve to 'unsupported'",
      path: ["requestState"]
    });
  }
  if (entry.status === "deferred" && entry.decision === undefined) {
    ctx.addIssue({
      code: "custom",
      message: "a deferred provider must carry the recorded decision",
      path: ["status"]
    });
  }
  if (entry.status !== "deferred" && entry.decision !== undefined) {
    ctx.addIssue({
      code: "custom",
      message: "only a deferred provider carries a decision record",
      path: ["decision"]
    });
  }
});
var SUPPORTED_PROVIDERS = (() => {
  const table = [
    {
      providerId: "jscpd",
      capabilityIds: ["duplication.exact", "duplication.normalized", "duplication.near"],
      unscored: true,
      status: "delivered",
      reason: "duplication-evidence adapter delivered (src/providers/jscpd/, trellis-f4e2) and selectable through declarative provider configuration (plan pl-43c5 step 15, trellis-15e3): requests resolve per run"
    },
    {
      providerId: "dependency-cruiser",
      capabilityIds: ["architecture.declared-rules"],
      unscored: true,
      status: "delivered",
      reason: "architecture-evidence adapter delivered (src/providers/dependency-cruiser/, trellis-adbf) evaluating the declarative architecture-policy subset over staged views and selectable through declarative provider configuration: requests resolve per run"
    },
    {
      providerId: "knip",
      capabilityIds: ["reachability.contextual"],
      unscored: true,
      status: "delivered",
      reason: "reachability-evidence adapter delivered (src/providers/knip/, trellis-8ebc) evaluating the " + "prepared declarative reachability context over staged views with every runtime plugin " + "disabled and selectable through declarative provider configuration: requests resolve per run"
    },
    {
      providerId: "sonarjs",
      capabilityIds: ["reasoning.cognitive-complexity", "bugs.selected-syntax-rules"],
      unscored: true,
      status: "deferred",
      requestState: "unsupported",
      reason: "explicitly deferred by the distribution and metric-interface decision (docs/sonarjs-decision.md): the pinned eslint-plugin-sonarjs 3.0.5 distribution carries conflicting license evidence (LGPL-3.0-only package metadata vs SONAR Source-Available License v1.0 shipped headers) and no permitted distribution route is established",
      decision: {
        outcome: "deferred",
        record: "docs/sonarjs-decision.md",
        issue: "trellis-db3e",
        prerequisite: "trellis-7f5d"
      }
    }
  ];
  const validated = z17.array(providerCapabilityStatusSchema).parse(table);
  capabilityDeclarationsSchema.parse(validated.flatMap((entry) => entry.capabilityIds.map((capabilityId) => ({
    providerId: entry.providerId,
    capabilityId
  }))));
  return validated;
})();
function providerCapabilityStatus(id) {
  return SUPPORTED_PROVIDERS.find((entry) => entry.providerId === id);
}

// src/providers/staging.ts
import { createHash as createHash2 } from "node:crypto";
import { readFile as readFile5, rm } from "node:fs/promises";
import { isAbsolute, join as join6, relative as relative2 } from "node:path";
class InvalidStagingRequestError extends Error {
  constructor(reason) {
    super(`invalid staging request: ${reason}`);
    this.name = "InvalidStagingRequestError";
  }
}

class StagingError extends Error {
  constructor(reason) {
    super(`staging failed: ${reason}`);
    this.name = "StagingError";
  }
}
function sha256Hex(data) {
  return createHash2("sha256").update(data).digest("hex");
}
function containsPath(parent, child) {
  if (parent === child)
    return false;
  const rel = relative2(parent, child);
  return rel !== "" && rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel);
}
function byRelativePath(a, b) {
  if (a === ".")
    return b === "." ? 0 : -1;
  if (b === ".")
    return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
function computeSnapshotDigest(entries) {
  const lines = entries.map((entry) => `${entry.path}	${entry.kind}	${entry.sha256}`).sort();
  return sha256Hex(`${lines.join(`
`)}
`);
}
function makeDetectDrift(rootReal, stagedFiles, contextFiles) {
  return async () => {
    const entries = [];
    for (const staged of [...stagedFiles, ...contextFiles]) {
      const reread = await readFile5(join6(rootReal, staged.path)).then((content) => ({ ok: true, content }), (error) => ({ ok: false, reason: messageOf(error) }));
      if (!reread.ok) {
        entries.push({ path: staged.path, kind: "unreadable", reason: reread.reason });
        continue;
      }
      const currentSha256 = sha256Hex(reread.content);
      if (currentSha256 !== staged.sha256) {
        entries.push({
          path: staged.path,
          kind: "changed",
          snapshotSha256: staged.sha256,
          currentSha256
        });
      }
    }
    return { entries: entries.sort((a, b) => byRelativePath(a.path, b.path)) };
  };
}
function makeCleanup(scratchReal) {
  let scratchCleaned = false;
  return async () => {
    if (scratchCleaned)
      return { status: "already-clean" };
    try {
      await rm(scratchReal, { recursive: true, force: true });
      scratchCleaned = true;
      return { status: "cleaned" };
    } catch (error) {
      return { status: "failed", reason: messageOf(error) };
    }
  };
}
function assertSelectionEntry(entry) {
  if (entry === null || typeof entry !== "object") {
    throw new InvalidStagingRequestError("each selected file must be an object");
  }
  const { path, sourceSet, packagePath } = entry;
  if (typeof path !== "string" || path === "." || path.includes("\x00") || !isRepoRelativePath(path)) {
    throw new InvalidStagingRequestError(`selected file path ${JSON.stringify(path)} must be a repo-relative POSIX path`);
  }
  if (typeof sourceSet !== "string" || !SOURCE_SETS.includes(sourceSet)) {
    throw new InvalidStagingRequestError(`selected file ${JSON.stringify(path)} has invalid sourceSet ${JSON.stringify(sourceSet)}`);
  }
  if (typeof packagePath !== "string" || packagePath.includes("\x00") || packagePath !== "." && !isRepoRelativePath(packagePath)) {
    throw new InvalidStagingRequestError(`selected file ${JSON.stringify(path)} has invalid packagePath ${JSON.stringify(packagePath)}`);
  }
  return { path, sourceSet, packagePath };
}
function normalizeSelectionFiles(files) {
  if (!Array.isArray(files)) {
    throw new InvalidStagingRequestError("files must be an array of selection entries");
  }
  const seen = new Set;
  const selection = [];
  for (const entry of files) {
    const normalized = assertSelectionEntry(entry);
    if (!seen.has(normalized.path)) {
      seen.add(normalized.path);
      selection.push(normalized);
    }
  }
  return selection.sort((a, b) => byRelativePath(a.path, b.path));
}
function normalizePackageRoots(packageRoots, selection) {
  if (packageRoots === undefined) {
    return [...new Set([".", ...selection.map((file) => file.packagePath)])].sort(byRelativePath);
  }
  if (!Array.isArray(packageRoots)) {
    throw new InvalidStagingRequestError("packageRoots must be an array of repo-relative paths");
  }
  for (const pkg of packageRoots) {
    if (typeof pkg !== "string" || pkg.includes("\x00") || !isRepoRelativePath(pkg)) {
      throw new InvalidStagingRequestError(`invalid package root ${JSON.stringify(pkg)} (must be repo-relative POSIX)`);
    }
  }
  return [...new Set(packageRoots)].sort(byRelativePath);
}
function normalizeStagingRequest(request) {
  if (request === null || typeof request !== "object") {
    throw new InvalidStagingRequestError("request must be an object");
  }
  const { root, files, packageRoots, mode } = request;
  if (typeof root !== "string" || root === "" || root.includes("\x00")) {
    throw new InvalidStagingRequestError("root must be a non-empty string without NUL");
  }
  if (mode !== undefined && mode !== "source-only" && mode !== "project-aware") {
    throw new InvalidStagingRequestError(`invalid staging mode ${JSON.stringify(mode)}`);
  }
  const selection = normalizeSelectionFiles(files);
  return {
    root,
    files: selection,
    packageRoots: normalizePackageRoots(packageRoots, selection),
    mode: mode === "project-aware" ? "project-aware" : "source-only"
  };
}

// src/providers/workspace.ts
import { mkdir, mkdtemp, readFile as readFile7, realpath, rm as rm2, stat as stat3, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname as dirname3, join as join8, resolve as resolve3 } from "node:path";

// src/providers/context.ts
import { readdir as readdir3, readFile as readFile6 } from "node:fs/promises";
import { join as join7 } from "node:path";
var DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies"
];
var TSCONFIG_NAME_RE = /^tsconfig\.[^.]+\.json$/;
var ENTRY_FIELDS = ["main", "module", "types", "typings"];
function isTsconfigName(name) {
  return name === "tsconfig.json" || TSCONFIG_NAME_RE.test(name);
}
function toPackageRelative(pkg, name) {
  return pkg === "." ? name : `${pkg}/${name}`;
}
function sortedUnique(values) {
  return [...new Set(values)].sort();
}
function dependencyNames(sectionValue) {
  if (typeof sectionValue !== "object" || sectionValue === null || Array.isArray(sectionValue)) {
    return [];
  }
  return sortedUnique(Object.keys(sectionValue));
}
function declaredEntryRoots(manifest) {
  const entries = [];
  for (const field of ENTRY_FIELDS) {
    const value = manifest[field];
    if (typeof value === "string")
      entries.push(value);
  }
  const bin = manifest.bin;
  if (typeof bin === "string")
    entries.push(bin);
  else if (typeof bin === "object" && bin !== null) {
    for (const value of Object.values(bin)) {
      if (typeof value === "string")
        entries.push(value);
    }
  }
  return sortedUnique(entries);
}
async function readManifest2(root, pkg, files, readFailures, issues) {
  const manifestPath = toPackageRelative(pkg, "package.json");
  const manifestRead = await readFile6(join7(root, manifestPath)).then((bytes) => ({ ok: true, bytes }), (error) => ({ ok: false, reason: messageOf(error) }));
  if (!manifestRead.ok) {
    readFailures.push({ path: manifestPath, reason: manifestRead.reason });
    return;
  }
  files.push({
    path: manifestPath,
    role: "manifest",
    bytes: manifestRead.bytes,
    sha256: sha256Hex(manifestRead.bytes)
  });
  try {
    const parsed = JSON.parse(new TextDecoder().decode(manifestRead.bytes));
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed;
    }
    issues.push({ path: manifestPath, reason: "manifest is valid JSON but not an object" });
  } catch (error) {
    issues.push({ path: manifestPath, reason: `manifest is not valid JSON (${messageOf(error)})` });
  }
  return;
}
async function readTsconfigs(root, pkg, dir, files, readFailures) {
  const listing = await readdir3(dir).then((names) => ({ ok: true, names }), (error) => ({ ok: false, reason: messageOf(error) }));
  if (!listing.ok) {
    readFailures.push({ path: pkg, reason: `package directory not listable (${listing.reason})` });
    return;
  }
  for (const name of [...listing.names].sort()) {
    if (!isTsconfigName(name))
      continue;
    const tsconfigPath = toPackageRelative(pkg, name);
    const tsconfigRead = await readFile6(join7(root, tsconfigPath)).then((bytes) => ({ ok: true, bytes }), (error) => ({ ok: false, reason: messageOf(error) }));
    if (!tsconfigRead.ok) {
      readFailures.push({ path: tsconfigPath, reason: tsconfigRead.reason });
    } else {
      files.push({
        path: tsconfigPath,
        role: "tsconfig",
        bytes: tsconfigRead.bytes,
        sha256: sha256Hex(tsconfigRead.bytes)
      });
    }
  }
}
function manifestDeclarations(pkg, manifest) {
  const sections = {};
  for (const section of DEPENDENCY_SECTIONS) {
    sections[section] = dependencyNames(manifest[section]);
  }
  return {
    dependencies: { packagePath: pkg, sections },
    entryRoots: { packagePath: pkg, entries: declaredEntryRoots(manifest) }
  };
}
async function enumerateProjectContext(root, packageRoots) {
  const files = [];
  const readFailures = [];
  const issues = [];
  const dependencies = [];
  const entryRoots = [];
  for (const pkg of [...new Set(packageRoots)].sort(byRelativePath)) {
    const manifest = await readManifest2(root, pkg, files, readFailures, issues);
    await readTsconfigs(root, pkg, pkg === "." ? root : join7(root, pkg), files, readFailures);
    if (manifest !== undefined) {
      const declarations = manifestDeclarations(pkg, manifest);
      dependencies.push(declarations.dependencies);
      entryRoots.push(declarations.entryRoots);
    }
  }
  return {
    files: files.sort((a, b) => byRelativePath(a.path, b.path)),
    readFailures: readFailures.sort((a, b) => byRelativePath(a.path, b.path)),
    issues: issues.sort((a, b) => byRelativePath(a.path, b.path)),
    dependencies: dependencies.sort((a, b) => byRelativePath(a.packagePath, b.packagePath)),
    entryRoots: entryRoots.sort((a, b) => byRelativePath(a.packagePath, b.packagePath))
  };
}

// src/providers/workspace.ts
async function resolveAuditedRoot(root) {
  let rootReal;
  try {
    rootReal = await realpath(resolve3(root));
  } catch (error) {
    throw new StagingError(`could not resolve audited root ${JSON.stringify(root)} (${messageOf(error)})`);
  }
  if (!(await stat3(rootReal)).isDirectory()) {
    throw new StagingError(`audited root ${rootReal} is not a directory`);
  }
  return rootReal;
}
async function createScratch(rootReal) {
  const scratchDir = await mkdtemp(join8(tmpdir(), "trellis-staged-"));
  try {
    const scratchReal = await realpath(scratchDir);
    if (containsPath(rootReal, scratchReal)) {
      throw new StagingError(`temporary directory ${scratchReal} resolves inside the audited root; refusing to stage into the target workspace`);
    }
    const stagedRoot = join8(scratchReal, "source");
    const workDir = join8(scratchReal, "work");
    await mkdir(stagedRoot, { recursive: true });
    await mkdir(workDir, { recursive: true });
    return { scratchDir, scratchReal, stagedRoot, workDir };
  } catch (error) {
    await rm2(scratchDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}
async function writeStagedCopy(stagedRoot, path, bytes) {
  const stagedPath = join8(stagedRoot, path);
  await mkdir(dirname3(stagedPath), { recursive: true });
  await writeFile(stagedPath, bytes);
  return stagedPath;
}
async function snapshotSelection(rootReal, stagedRoot, selection) {
  const stagedFiles = [];
  const readFailures = [];
  const rejected = [];
  for (const entry of selection) {
    const realFile = await realpath(join8(rootReal, entry.path)).then((path) => ({ ok: true, path }), (error) => ({ ok: false, reason: messageOf(error) }));
    if (!realFile.ok) {
      readFailures.push({ path: entry.path, reason: `could not be resolved (${realFile.reason})` });
      continue;
    }
    if (!containsPath(rootReal, realFile.path)) {
      rejected.push({
        path: entry.path,
        reason: "resolves outside the audited root (symlink or traversal escape)"
      });
      continue;
    }
    const bytes = await readFile7(realFile.path).then((content) => ({ ok: true, content }), (error) => ({ ok: false, reason: messageOf(error) }));
    if (!bytes.ok) {
      readFailures.push({ path: entry.path, reason: `could not be read (${bytes.reason})` });
      continue;
    }
    stagedFiles.push({
      path: entry.path,
      stagedPath: await writeStagedCopy(stagedRoot, entry.path, bytes.content),
      sourceSet: entry.sourceSet,
      packagePath: entry.packagePath,
      sha256: sha256Hex(bytes.content),
      bytes: bytes.content.byteLength
    });
  }
  return { stagedFiles, readFailures, rejected };
}
function buildProvenance(mode, stagedFiles, contextFiles, context) {
  const filesBySourceSet = {};
  for (const set of SOURCE_SETS)
    filesBySourceSet[set] = 0;
  for (const file of stagedFiles)
    filesBySourceSet[file.sourceSet] += 1;
  return {
    mode,
    filesBySourceSet,
    contextFiles: contextFiles.map((file) => ({ path: file.path, role: file.role })),
    dependencyDeclarations: context.dependencyDeclarations,
    entryRoots: context.entryRoots,
    contextIssues: context.contextIssues,
    snapshotDigest: computeSnapshotDigest([
      ...stagedFiles.map((file) => ({
        path: file.path,
        kind: file.sourceSet,
        sha256: file.sha256
      })),
      ...contextFiles.map((file) => ({ path: file.path, kind: file.role, sha256: file.sha256 }))
    ])
  };
}
async function stageWorkspaceView(request) {
  const { root, files: selection, packageRoots, mode } = normalizeStagingRequest(request);
  let scratchDir;
  try {
    const rootReal = await resolveAuditedRoot(root);
    const scratch = await createScratch(rootReal);
    scratchDir = scratch.scratchDir;
    const snapshot = await snapshotSelection(rootReal, scratch.stagedRoot, selection);
    const stagedFiles = snapshot.stagedFiles;
    const contextFiles = [];
    const context = {
      dependencyDeclarations: [],
      entryRoots: [],
      contextIssues: []
    };
    if (mode === "project-aware") {
      const enumerated = await enumerateProjectContext(rootReal, packageRoots);
      for (const contextFile of enumerated.files) {
        contextFiles.push({
          path: contextFile.path,
          stagedPath: await writeStagedCopy(scratch.stagedRoot, contextFile.path, contextFile.bytes),
          role: contextFile.role,
          sha256: contextFile.sha256,
          bytes: contextFile.bytes.byteLength
        });
      }
      snapshot.readFailures.push(...enumerated.readFailures);
      context.dependencyDeclarations = enumerated.dependencies;
      context.entryRoots = enumerated.entryRoots;
      context.contextIssues = enumerated.issues;
    }
    return {
      root: rootReal,
      scratchDir: scratch.scratchReal,
      stagedRoot: scratch.stagedRoot,
      workDir: scratch.workDir,
      provenance: buildProvenance(mode, stagedFiles, contextFiles, context),
      files: stagedFiles,
      contextFiles,
      readFailures: snapshot.readFailures.sort((a, b) => byRelativePath(a.path, b.path)),
      rejected: snapshot.rejected.sort((a, b) => byRelativePath(a.path, b.path)),
      detectDrift: makeDetectDrift(rootReal, stagedFiles, contextFiles),
      cleanup: makeCleanup(scratch.scratchReal)
    };
  } catch (error) {
    if (scratchDir !== undefined) {
      await rm2(scratchDir, { recursive: true, force: true }).catch(() => {});
    }
    if (error instanceof StagingError) {
      throw error;
    }
    throw new StagingError(messageOf(error));
  }
}

// src/providers/staged-run.ts
var NEVER_SETTLES = new Promise(() => {});
function assertOptions(run, options) {
  if (typeof run !== "function") {
    throw new InvalidStagingRequestError("run must be a function accepting the staged view");
  }
  if (options === null || typeof options !== "object") {
    throw new InvalidStagingRequestError("options must be an object");
  }
  const { timeoutMs, signal } = options;
  if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)) {
    throw new InvalidStagingRequestError("timeoutMs must be a positive integer");
  }
  if (signal !== undefined && (typeof signal !== "object" || signal === null || typeof signal.addEventListener !== "function")) {
    throw new InvalidStagingRequestError("signal must be an AbortSignal");
  }
}
async function withStagedWorkspaceView(request, run, options = {}) {
  assertOptions(run, options);
  const { timeoutMs, signal } = options;
  if (signal?.aborted) {
    return { kind: "cancelled", cleanup: { status: "nothing-to-clean" } };
  }
  const view = await stageWorkspaceView(request);
  const controller = new AbortController;
  const runSettled = (async () => {
    try {
      return { ok: true, value: await run(view, controller.signal) };
    } catch (error) {
      return { ok: false, error };
    }
  })();
  let timer;
  let onAbort;
  const winner = await Promise.race([
    runSettled.then((result) => ({ kind: "run", result })),
    timeoutMs === undefined ? NEVER_SETTLES : new Promise((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ kind: "timeout" });
      }, timeoutMs);
    }),
    signal === undefined ? NEVER_SETTLES : new Promise((resolve) => {
      if (signal.aborted) {
        controller.abort();
        resolve({ kind: "cancelled" });
      } else {
        onAbort = () => {
          controller.abort();
          resolve({ kind: "cancelled" });
        };
        signal.addEventListener("abort", onAbort);
      }
    })
  ]);
  if (timer !== undefined)
    clearTimeout(timer);
  if (onAbort !== undefined)
    signal?.removeEventListener("abort", onAbort);
  const cleanup = await view.cleanup();
  if (winner.kind === "run") {
    return winner.result.ok ? { kind: "completed", value: winner.result.value, cleanup } : { kind: "adapter-failed", error: winner.result.error, cleanup };
  }
  return winner.kind === "timeout" ? { kind: "timeout", cleanup } : { kind: "cancelled", cleanup };
}

// src/providers/manifest.ts
import { z as z18 } from "zod";
var hex64Schema = z18.string().regex(/^[0-9a-f]{64}$/, "must be a lowercase sha-256 hex digest");
var exactVersionSchema = z18.string().regex(/^\d+\.\d+\.\d+$/, "must be an exact version — ranges are forbidden");
var PINNED_TOOL_EXECUTION_RECORDS = [
  "tested",
  "research-tested",
  "declared-untested"
];
var pinnedToolPlatformSchema = z18.strictObject({
  key: z18.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  packageName: z18.string().min(1),
  os: z18.string().min(1),
  cpu: z18.string().min(1),
  libc: z18.enum(["glibc", "musl"]).optional(),
  binaryRelPath: z18.string().min(1),
  execution: z18.enum(PINNED_TOOL_EXECUTION_RECORDS),
  evidence: z18.string().min(1),
  binarySha256: hex64Schema.optional()
}).superRefine((platform, ctx) => {
  const isWindows = platform.os === "win32";
  if (isWindows !== platform.binaryRelPath.endsWith(".exe")) {
    ctx.addIssue({
      code: "custom",
      message: "win32 platform binaries must end in .exe and no other may",
      path: ["binaryRelPath"]
    });
  }
  if (platform.execution !== "declared-untested" !== (platform.binarySha256 !== undefined)) {
    ctx.addIssue({
      code: "custom",
      message: "a binary digest may only be recorded where a real host exercised the platform, and an exercised host must record one",
      path: ["binarySha256"]
    });
  }
});
var pinnedToolManifestEntrySchema = z18.strictObject({
  providerId: providerIdSchema,
  packageName: z18.string().min(1),
  pinnedVersion: exactVersionSchema,
  versionOutput: z18.string().min(1),
  binCommand: z18.string().min(1),
  binEntry: z18.string().min(1),
  launcherRelPath: z18.string().min(1),
  platformMapRelPath: z18.string().min(1),
  launcherSha256: hex64Schema,
  platformMapSha256: hex64Schema,
  platforms: z18.array(pinnedToolPlatformSchema).min(1),
  installInstructions: z18.string().min(1)
}).superRefine((entry, ctx) => {
  if (!entry.versionOutput.includes(entry.pinnedVersion)) {
    ctx.addIssue({
      code: "custom",
      message: "versionOutput must report the pinned version",
      path: ["versionOutput"]
    });
  }
  const keys = new Set;
  const packageNames = new Map;
  const hosts = new Set;
  for (const platform of entry.platforms) {
    if (keys.has(platform.key)) {
      ctx.addIssue({ code: "custom", message: `duplicate platform key "${platform.key}"` });
    }
    keys.add(platform.key);
    const isSharedLauncher = platform.packageName === entry.packageName && platform.binaryRelPath === entry.launcherRelPath && platform.binarySha256 === entry.launcherSha256;
    const permitsSharedPackage = isSharedLauncher && packageNames.get(platform.packageName) === true;
    if (packageNames.has(platform.packageName) && !permitsSharedPackage) {
      ctx.addIssue({
        code: "custom",
        message: `duplicate platform package "${platform.packageName}"`
      });
    }
    packageNames.set(platform.packageName, isSharedLauncher);
    const host = `${platform.os}/${platform.cpu}/${platform.libc ?? "any"}`;
    if (hosts.has(host)) {
      ctx.addIssue({ code: "custom", message: `duplicate host ${host}` });
    }
    hosts.add(host);
  }
});
var PINNED_TOOLS = (() => {
  const table = [
    {
      providerId: "jscpd",
      packageName: "jscpd",
      pinnedVersion: "5.2.1",
      versionOutput: "jscpd 5.2.1",
      binCommand: "jscpd",
      binEntry: "./run-jscpd.js",
      launcherRelPath: "run-jscpd.js",
      platformMapRelPath: "platform-map.js",
      launcherSha256: "e81342e628de62d9b15fe94a918d25cc98e2e90a9b85c3f8ec636578c278467a",
      platformMapSha256: "ad6f2a21dfcae532d675125663cd349fac478f220334e34d3a90bc6d3fe28b2a",
      platforms: [
        {
          key: "linux-x64-gnu",
          packageName: "jscpd-linux-x64-gnu",
          os: "linux",
          cpu: "x64",
          libc: "glibc",
          binaryRelPath: "bin/jscpd",
          execution: "tested",
          evidence: "scripts/smoke-provider-tools.ts (plan pl-43c5 step 11)",
          binarySha256: "26d613a8ca8cb276dd50721f98c7695e8b6449bd03b9e0568570c824e9c407f2"
        },
        {
          key: "darwin-arm64",
          packageName: "jscpd-darwin-arm64",
          os: "darwin",
          cpu: "arm64",
          binaryRelPath: "bin/jscpd",
          execution: "research-tested",
          evidence: "docs/research/jscpd-provider-spike/summary.json (trellis-ff55)",
          binarySha256: "272c2833e2dcff607058cdfb9a4b27db3a772759400ceaaf9ce2e67d3c764d23"
        },
        {
          key: "linux-arm64-gnu",
          packageName: "jscpd-linux-arm64-gnu",
          os: "linux",
          cpu: "arm64",
          libc: "glibc",
          binaryRelPath: "bin/jscpd",
          execution: "declared-untested",
          evidence: "declared by jscpd@5.2.1 platform-map.js; never executed by trellis"
        },
        {
          key: "linux-x64-musl",
          packageName: "jscpd-linux-x64-musl",
          os: "linux",
          cpu: "x64",
          libc: "musl",
          binaryRelPath: "bin/jscpd",
          execution: "declared-untested",
          evidence: "declared by jscpd@5.2.1 platform-map.js; never executed by trellis"
        },
        {
          key: "linux-arm64-musl",
          packageName: "jscpd-linux-arm64-musl",
          os: "linux",
          cpu: "arm64",
          libc: "musl",
          binaryRelPath: "bin/jscpd",
          execution: "declared-untested",
          evidence: "declared by jscpd@5.2.1 platform-map.js; never executed by trellis"
        },
        {
          key: "darwin-x64",
          packageName: "jscpd-darwin-x64",
          os: "darwin",
          cpu: "x64",
          binaryRelPath: "bin/jscpd",
          execution: "declared-untested",
          evidence: "declared by jscpd@5.2.1 platform-map.js; never executed by trellis"
        },
        {
          key: "windows-x64-msvc",
          packageName: "jscpd-windows-x64-msvc",
          os: "win32",
          cpu: "x64",
          binaryRelPath: "bin/jscpd.exe",
          execution: "declared-untested",
          evidence: "declared by jscpd@5.2.1 platform-map.js; never executed by trellis"
        },
        {
          key: "windows-arm64-msvc",
          packageName: "jscpd-windows-arm64-msvc",
          os: "win32",
          cpu: "arm64",
          binaryRelPath: "bin/jscpd.exe",
          execution: "declared-untested",
          evidence: "declared by jscpd@5.2.1 platform-map.js; never executed by trellis"
        }
      ],
      installInstructions: "prepare the pinned tool locally where trellis resolves from (never at audit time): " + "run `bun install` in this repository (jscpd 5.2.1 is a pinned devDependency), or in the " + "package tree a trellis CLI install runs from run `npm install --save-exact --save-dev " + "jscpd@5.2.1` / `bun add --dev jscpd@5.2.1`; trellis then discovers and verifies the " + "artifact offline (SPEC §16.4)"
    },
    {
      providerId: "dependency-cruiser",
      packageName: "dependency-cruiser",
      pinnedVersion: "18.3.1",
      versionOutput: "18.3.1",
      binCommand: "dependency-cruiser",
      binEntry: "bin/dependency-cruiser.mjs",
      launcherRelPath: "bin/dependency-cruiser.mjs",
      platformMapRelPath: "package.json",
      launcherSha256: "3a57384034c8b33016761ea022df1a9f1476f187a8c250573ccdcf301d169ba6",
      platformMapSha256: "6aed892071cdd9ebca9517665d19a67ded18510f64a608beb611f711623c6cbd",
      platforms: [
        {
          key: "darwin-arm64",
          packageName: "dependency-cruiser",
          os: "darwin",
          cpu: "arm64",
          binaryRelPath: "bin/dependency-cruiser.mjs",
          execution: "tested",
          evidence: "macOS 26.5.2 ARM64, Bun 1.3.14: dependency-cruiser conformance and " + "cross-provider suites passed; docs/provider-acceptance.md (trellis-b18d)",
          binarySha256: "3a57384034c8b33016761ea022df1a9f1476f187a8c250573ccdcf301d169ba6"
        },
        {
          key: "linux-x64-gnu",
          packageName: "dependency-cruiser",
          os: "linux",
          cpu: "x64",
          libc: "glibc",
          binaryRelPath: "bin/dependency-cruiser.mjs",
          execution: "tested",
          evidence: "src/providers/dependency-cruiser conformance suite + scripts/smoke-provider-tools.ts " + "(plan pl-43c5 step 22, trellis-adbf)",
          binarySha256: "3a57384034c8b33016761ea022df1a9f1476f187a8c250573ccdcf301d169ba6"
        }
      ],
      installInstructions: "prepare the pinned tool locally where trellis resolves from (never at audit time): " + "run `bun install` in this repository (dependency-cruiser 18.3.1 is a pinned " + "devDependency, alongside a local typescript install it can resolve as its parser), or " + "in the package tree a trellis CLI install runs from run `npm install --save-exact " + "--save-dev dependency-cruiser@18.3.1` / `bun add --dev dependency-cruiser@18.3.1`; trellis " + "then discovers and verifies the artifact offline (SPEC §16.4)"
    },
    {
      providerId: "knip",
      packageName: "knip",
      pinnedVersion: "6.16.1",
      versionOutput: "6.16.1",
      binCommand: "knip-bun",
      binEntry: "bin/knip-bun.js",
      launcherRelPath: "bin/knip-bun.js",
      platformMapRelPath: "package.json",
      launcherSha256: "0decd26eef37578c2574b6a83f711f19775ca04c132fb89049a23e9cecb80388",
      platformMapSha256: "331cb6aa29cf65ff754257ba01aee8c695f3dbf836d2539722a20771cb55a272",
      platforms: [
        {
          key: "darwin-arm64",
          packageName: "knip",
          os: "darwin",
          cpu: "arm64",
          binaryRelPath: "bin/knip-bun.js",
          execution: "tested",
          evidence: "macOS ARM64: conformance, failure, combined surface and offline acceptance " + "passed with oxc-parser 0.133.0; docs/provider-acceptance.md (trellis-639c)",
          binarySha256: "0decd26eef37578c2574b6a83f711f19775ca04c132fb89049a23e9cecb80388"
        },
        {
          key: "linux-x64-gnu",
          packageName: "knip",
          os: "linux",
          cpu: "x64",
          libc: "glibc",
          binaryRelPath: "bin/knip-bun.js",
          execution: "tested",
          evidence: "src/providers/knip conformance suite + scripts/smoke-provider-tools.ts " + "(plan pl-43c5 step 24, trellis-8ebc)",
          binarySha256: "0decd26eef37578c2574b6a83f711f19775ca04c132fb89049a23e9cecb80388"
        }
      ],
      installInstructions: "prepare the pinned tool locally where trellis resolves from (never at audit time): " + "run `bun install` in this repository (knip 6.16.1 is a pinned devDependency — the same " + "install this repository's own check:deps gate uses), or in the package tree a trellis " + "CLI install runs from run `npm install --save-exact --save-dev knip@6.16.1` / `bun add " + "--dev knip@6.16.1`; trellis then discovers and verifies the artifact offline (SPEC §16.4)"
    }
  ];
  const validated = z18.array(pinnedToolManifestEntrySchema).parse(table);
  for (const entry of validated) {
    if (!SUPPORTED_PROVIDERS.some((provider) => provider.providerId === entry.providerId)) {
      throw new Error(`pinned tool "${entry.providerId}" is not a known supported provider`);
    }
  }
  return validated;
})();
function pinnedTool(providerId) {
  return PINNED_TOOLS.find((entry) => entry.providerId === providerId);
}
function detectLinuxLibc(getReport = () => process.report?.getReport(), platform = process.platform) {
  if (platform !== "linux")
    return;
  try {
    const report = getReport();
    return report?.header?.glibcVersionRuntime !== undefined ? "glibc" : "musl";
  } catch {
    return "musl";
  }
}
function pinnedToolHost() {
  return { platform: process.platform, arch: process.arch, libc: detectLinuxLibc() };
}

// src/providers/resolve.ts
import { createHash as createHash3 } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname as dirname4, isAbsolute as isAbsolute2, join as join9 } from "node:path";
var TRELLIS_MODULE_DIR = import.meta.dir;
function unavailable(entry, reason) {
  return {
    state: "unavailable",
    providerId: entry.providerId,
    reason,
    instructions: entry.installInstructions
  };
}
function findInstalledPackageRoot(packageName, fromDir) {
  let current = fromDir;
  while (true) {
    const candidate = join9(current, "node_modules", packageName);
    if (existsSync(join9(candidate, "package.json")))
      return candidate;
    const parent = dirname4(current);
    if (parent === current)
      return;
    current = parent;
  }
}
function readPackageJson(root) {
  try {
    const parsed = JSON.parse(readFileSync(join9(root, "package.json"), "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return;
    return parsed;
  } catch {
    return;
  }
}
function digestOf(path) {
  try {
    return createHash3("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return;
  }
}
function isRegularFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
function verifyPackageIdentity(entry, packageRoot, manifest) {
  if (manifest.name !== entry.packageName) {
    return `the package at ${packageRoot} reports name ${JSON.stringify(manifest.name)}, expected ` + `"${entry.packageName}" — refusing a mismatched artifact`;
  }
  if (manifest.version !== entry.pinnedVersion) {
    return `the resolved ${entry.packageName} at ${packageRoot} is version ${JSON.stringify(manifest.version)}, ` + `but the pin is exactly ${entry.pinnedVersion} — trellis never installs, updates, or downgrades tools`;
  }
  const bin = manifest.bin;
  const binEntry = typeof bin === "object" && bin !== null ? bin[entry.binCommand] : undefined;
  if (binEntry !== entry.binEntry) {
    return `the resolved ${entry.packageName}@${entry.pinnedVersion} has bin.${entry.binCommand} ` + `${JSON.stringify(binEntry)}, expected ${JSON.stringify(entry.binEntry)}`;
  }
  return;
}
function verifyDistributionDigests(entry, packageRoot) {
  const files = [
    [entry.launcherRelPath, entry.launcherSha256],
    [entry.platformMapRelPath, entry.platformMapSha256]
  ];
  for (const [relativePath, expected] of files) {
    const actual = digestOf(join9(packageRoot, relativePath));
    if (actual !== expected) {
      return `the resolved ${entry.packageName}@${entry.pinnedVersion} fails artifact verification: ` + `${relativePath} has sha-256 ${actual ?? "unreadable"}, expected ${expected} — the pinned ` + `distribution was modified or is not the pinned artifact`;
    }
  }
  return;
}
function selectHostPlatform(entry, host) {
  return entry.platforms.find((platform) => platform.os === host.platform && platform.cpu === host.arch && (platform.libc ?? host.libc) === host.libc);
}
function unsupportedHost(entry, host) {
  return {
    state: "unsupported",
    providerId: entry.providerId,
    reason: `no pinned ${entry.providerId} platform binary is declared for ${host.platform}/${host.arch}` + `${host.libc === undefined ? "" : ` (${host.libc})`}; declared platforms: ` + `${entry.platforms.map((platform) => platform.key).join(", ")} — platforms beyond the ` + `exercised hosts are untested by trellis and claimed only as the tool ships them`,
    instructions: entry.installInstructions
  };
}
function resolvePlatformBinary(entry, platform, packageRoot) {
  let resolvedRoot = packageRoot;
  try {
    resolvedRoot = realpathSync(packageRoot);
  } catch {}
  const platformRoot = join9(dirname4(resolvedRoot), platform.packageName);
  const manifest = readPackageJson(platformRoot);
  if (manifest === undefined || manifest.name !== platform.packageName) {
    return unavailable(entry, `the pinned platform package ${platform.packageName}@${entry.pinnedVersion} is not installed ` + `next to the resolved ${entry.packageName} (no matching package at ${platformRoot})`);
  }
  if (manifest.version !== entry.pinnedVersion) {
    return unavailable(entry, `the resolved platform package ${platform.packageName} is version ` + `${JSON.stringify(manifest.version)}, but the pin is exactly ${entry.pinnedVersion}`);
  }
  const binaryPath = join9(platformRoot, platform.binaryRelPath);
  if (!isRegularFile(binaryPath)) {
    return unavailable(entry, `the resolved platform package ${platform.packageName}@${entry.pinnedVersion} has no ` + `${platform.binaryRelPath} binary at ${platformRoot}`);
  }
  const binaryDigestVerified = platform.binarySha256 === undefined ? false : digestOf(binaryPath) === platform.binarySha256;
  if (platform.binarySha256 !== undefined && !binaryDigestVerified) {
    return unavailable(entry, `the ${platform.key} binary at ${binaryPath} fails artifact verification: its sha-256 does ` + `not match the digest recorded from the host that exercised this platform`);
  }
  return {
    state: "available",
    providerId: entry.providerId,
    executablePath: binaryPath,
    platformKey: platform.key,
    toolVersion: entry.pinnedVersion,
    binaryDigestVerified
  };
}
function resolvePinnedToolEntry(entry, options = {}) {
  const host = options.host ?? pinnedToolHost();
  const fromDir = options.fromDir ?? TRELLIS_MODULE_DIR;
  const packageRoot = findInstalledPackageRoot(entry.packageName, fromDir);
  if (packageRoot === undefined) {
    return unavailable(entry, `pinned tool "${entry.providerId}" (${entry.packageName}@${entry.pinnedVersion}) is not ` + `installed where trellis resolves from — no ${entry.packageName} package exists in the ` + `node_modules chain upward from ${fromDir}`);
  }
  const manifest = readPackageJson(packageRoot);
  if (manifest === undefined) {
    return unavailable(entry, `the resolved ${entry.packageName} package at ${packageRoot} has no readable package.json`);
  }
  const identityFailure = verifyPackageIdentity(entry, packageRoot, manifest);
  if (identityFailure !== undefined) {
    return unavailable(entry, identityFailure);
  }
  const digestFailure = verifyDistributionDigests(entry, packageRoot);
  if (digestFailure !== undefined) {
    return unavailable(entry, digestFailure);
  }
  const platform = selectHostPlatform(entry, host);
  if (platform === undefined) {
    return unsupportedHost(entry, host);
  }
  return resolvePlatformBinary(entry, platform, packageRoot);
}
function resolvePinnedTool(providerId, options = {}) {
  const entry = pinnedTool(providerId);
  if (entry === undefined) {
    throw new Error(`no pinned tool manifest entry for provider id "${providerId}"`);
  }
  return resolvePinnedToolEntry(entry, options);
}

class PinnedToolUnavailableError extends Error {
  providerId;
  resolution;
  constructor(resolution) {
    super(`pinned tool "${resolution.providerId}" is ${resolution.state}: ${resolution.reason} — ` + resolution.instructions);
    this.name = "PinnedToolUnavailableError";
    this.providerId = resolution.providerId;
    this.resolution = resolution;
  }
}
function requirePinnedToolExecutable(providerId, options = {}) {
  const resolution = resolvePinnedTool(providerId, options);
  if (resolution.state !== "available") {
    throw new PinnedToolUnavailableError(resolution);
  }
  if (!isAbsolute2(resolution.executablePath)) {
    throw new Error(`pinned tool "${providerId}" resolved a non-absolute path`);
  }
  return resolution.executablePath;
}

// src/providers/process.ts
var SENSITIVE_ENV_KEY_NAMES = [
  "token",
  "api_key",
  "password",
  "secret",
  "authorization",
  "set-cookie"
];
var REDACTED = "[redacted]";
var IS_WINDOWS = process.platform === "win32";

class UnsupportedExecutableError extends Error {
  id;
  constructor(id, supported) {
    super(`unsupported executable identifier "${id}" (must be one of: ${supported.join(", ")})`);
    this.name = "UnsupportedExecutableError";
    this.id = id;
  }
}

class InvalidProcessRequestError extends Error {
  constructor(reason) {
    super(`invalid controlled process request: ${reason}`);
    this.name = "InvalidProcessRequestError";
  }
}
var SUPPORTED_EXECUTABLES = {
  bun: () => process.execPath,
  jscpd: () => requirePinnedToolExecutable("jscpd")
};
function resolveExecutable(id) {
  const resolver = Object.hasOwn(SUPPORTED_EXECUTABLES, id) ? SUPPORTED_EXECUTABLES[id] : undefined;
  if (resolver === undefined) {
    throw new UnsupportedExecutableError(id, Object.keys(SUPPORTED_EXECUTABLES));
  }
  return pinnedExecutable(id, resolver());
}
function pinnedExecutable(id, path) {
  if (typeof id !== "string" || id === "") {
    throw new UnsupportedExecutableError(String(id), Object.keys(SUPPORTED_EXECUTABLES));
  }
  if (typeof path !== "string" || path === "" || !path.startsWith("/") || path.includes("\x00")) {
    throw new InvalidProcessRequestError(`executable for "${id}" must be an absolute, non-empty path (got: ${JSON.stringify(path)})`);
  }
  return { id, path };
}
function isStringArray(value) {
  if (!Array.isArray(value))
    return false;
  return value.every((entry) => typeof entry === "string");
}
function isEnvRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  for (const [key, entry] of Object.entries(value)) {
    if (key === "" || key.includes("=") || key.includes("\x00"))
      return false;
    if (typeof entry !== "string" || entry.includes("\x00"))
      return false;
  }
  return true;
}
function assertRequest(request) {
  if (request === null || typeof request !== "object") {
    throw new InvalidProcessRequestError("request must be an object");
  }
  if (!isStringArray(request.args)) {
    throw new InvalidProcessRequestError("args must be a fixed array of strings");
  }
  if (request.env !== undefined && !isEnvRecord(request.env)) {
    throw new InvalidProcessRequestError("env must map string keys to string values");
  }
  if (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs <= 0) {
    throw new InvalidProcessRequestError("timeoutMs must be a positive integer");
  }
  if (!Number.isSafeInteger(request.maxOutputBytes) || request.maxOutputBytes <= 0) {
    throw new InvalidProcessRequestError("maxOutputBytes must be a positive integer");
  }
}
function isSensitiveEnvKey(key) {
  const lowered = key.toLowerCase();
  return SENSITIVE_ENV_KEY_NAMES.some((name) => lowered.includes(name));
}
function scrubSensitiveValues(text, env) {
  let scrubbed = text;
  for (const [key, value] of Object.entries(env)) {
    if (value === "" || !isSensitiveEnvKey(key))
      continue;
    scrubbed = scrubbed.split(value).join(REDACTED);
  }
  return scrubbed;
}
function errorMessage(error, env) {
  const raw = error instanceof Error ? error.message : String(error);
  return scrubSensitiveValues(raw, env);
}
function concatBytes(chunks) {
  const merged = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}
async function readBounded(stream, maxBytes, onOverflow) {
  const reader = stream.getReader();
  const decoder = new TextDecoder;
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done || value === undefined) {
      return { text: decoder.decode(concatBytes(chunks)), overflowed: false };
    }
    if (total + value.byteLength > maxBytes) {
      const keep = maxBytes - total;
      if (keep > 0)
        chunks.push(value.subarray(0, keep));
      onOverflow();
      try {
        await reader.cancel();
      } catch {}
      return { text: decoder.decode(concatBytes(chunks)), overflowed: true };
    }
    chunks.push(value);
    total += value.byteLength;
  }
  return { text: decoder.decode(concatBytes(chunks)), overflowed: false };
}
async function runControlledProcess(executable, request) {
  assertRequest(request);
  const env = request.env ?? {};
  if (request.signal?.aborted) {
    return finished(executable, { kind: "cancelled", reason: "cancelled before start; nothing was executed" }, "", "", env);
  }
  let proc;
  try {
    proc = Bun.spawn([executable.path, ...request.args], {
      cwd: request.cwd,
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      detached: !IS_WINDOWS
    });
  } catch (error) {
    const reason = errorMessage(error, env);
    const code = error instanceof Error ? error.code : undefined;
    const outcome = code === "ENOENT" ? { kind: "missing-executable", reason } : { kind: "startup-failed", reason };
    return finished(executable, outcome, "", "", env);
  }
  let outcome;
  const take = (candidate) => {
    if (outcome === undefined)
      outcome = candidate;
  };
  const terminateGroup = () => {
    try {
      if (IS_WINDOWS)
        proc.kill();
      else
        process.kill(-proc.pid, "SIGKILL");
    } catch {}
  };
  const readStdout = readBounded(proc.stdout, request.maxOutputBytes, () => {
    take({
      kind: "output-overflow",
      reason: `stdout exceeded the ${request.maxOutputBytes}-byte limit; output truncated and process group terminated`,
      stream: "stdout"
    });
    terminateGroup();
  });
  const readStderr = readBounded(proc.stderr, request.maxOutputBytes, () => {
    take({
      kind: "output-overflow",
      reason: `stderr exceeded the ${request.maxOutputBytes}-byte limit; output truncated and process group terminated`,
      stream: "stderr"
    });
    terminateGroup();
  });
  const exitedWatch = proc.exited.then(() => {
    if (proc.exitCode !== null)
      take({ kind: "exited", exitCode: proc.exitCode });
    else
      take({ kind: "signaled", signalCode: proc.signalCode ?? "unknown" });
  });
  const timer = setTimeout(() => {
    take({
      kind: "timeout",
      reason: `wall-time limit of ${request.timeoutMs}ms exceeded; process group terminated`
    });
    terminateGroup();
  }, request.timeoutMs);
  const onAbort = () => {
    take({ kind: "cancelled", reason: "cancelled by caller; process group terminated" });
    terminateGroup();
  };
  request.signal?.addEventListener("abort", onAbort);
  const [stdout, stderr] = await Promise.all([readStdout, readStderr, exitedWatch]);
  clearTimeout(timer);
  request.signal?.removeEventListener("abort", onAbort);
  const finalOutcome = outcome ?? {
    kind: "signaled",
    signalCode: proc.signalCode ?? "unknown"
  };
  const stdoutText = stdout.overflowed ? `${stdout.text}...[truncated at ${request.maxOutputBytes} bytes]` : stdout.text;
  const stderrText = stderr.overflowed ? `${stderr.text}...[truncated at ${request.maxOutputBytes} bytes]` : stderr.text;
  return finished(executable, finalOutcome, stdoutText, stderrText, env);
}
function finished(executable, outcome, stdout, stderr, env) {
  return {
    executableId: executable.id,
    outcome,
    stdout,
    stderr: scrubSensitiveValues(stderr, env)
  };
}

// src/providers/dependency-cruiser/cruise-run.ts
import { mkdir as mkdir2, writeFile as writeFile2 } from "node:fs/promises";
import { join as join11 } from "node:path";

// src/providers/dependency-cruiser/invocation.ts
import { existsSync as existsSync2, readFileSync as readFileSync2 } from "node:fs";
import { dirname as dirname5, join as join10 } from "node:path";

// src/providers/dependency-cruiser/raw.ts
import { z as z19 } from "zod";
var DEPENDENCY_CRUISER_PROVIDER_ID = "dependency-cruiser";
var DEPENDENCY_CRUISER_ADAPTER_VERSION = "0.1.0";
var DEPENDENCY_CRUISER_PARSER_ENGINE = "dependency-cruiser.typescript";
var DEPENDENCY_CRUISER_MODE = "declared-rules";
var MAX_REASONS = 8;
function capReasons(reasons) {
  const capped = reasons.slice(0, MAX_REASONS);
  const omitted = reasons.length - capped.length;
  return omitted > 0 ? [...capped, `…and ${omitted} more problems`] : capped;
}
var RAW_VIOLATION_TYPES = ["dependency", "cycle"];
var rawViolationTypeSchema = z19.enum(RAW_VIOLATION_TYPES);
var rawSeveritySchema = z19.enum(["error", "warn", "info", "ignore"]);
var rawCycleMemberSchema = z19.strictObject({
  name: z19.string().min(1),
  dependencyTypes: z19.array(z19.string().min(1)).min(1)
});
var rawViolationSchema = z19.strictObject({
  type: rawViolationTypeSchema,
  rule: z19.strictObject({ severity: rawSeveritySchema, name: z19.string().min(1) }),
  from: z19.string().min(1),
  to: z19.string().min(1),
  unresolvedTo: z19.string().min(1).optional(),
  dependencyTypes: z19.array(z19.string().min(1)).min(1),
  cycle: z19.array(rawCycleMemberSchema).optional()
}).superRefine((violation, ctx) => {
  if (violation.type === "cycle" && violation.cycle === undefined) {
    ctx.addIssue({
      code: "custom",
      message: "a cycle violation carries its cycle path",
      path: ["cycle"]
    });
  }
});
var rawDependencySchema = z19.strictObject({
  module: z19.string().min(1),
  resolved: z19.string().min(1),
  moduleSystem: z19.string().min(1),
  dependencyTypes: z19.array(z19.string().min(1)).min(1),
  dynamic: z19.boolean(),
  coreModule: z19.boolean(),
  followable: z19.boolean(),
  couldNotResolve: z19.boolean(),
  matchesDoNotFollow: z19.boolean(),
  exoticallyRequired: z19.boolean(),
  circular: z19.boolean(),
  valid: z19.boolean(),
  protocol: z19.string().min(1).optional(),
  mimeType: z19.string().min(1).optional(),
  cycle: z19.array(rawCycleMemberSchema).optional(),
  rules: z19.array(z19.strictObject({ severity: rawSeveritySchema, name: z19.string().min(1) })).optional()
});
var rawModuleSchema = z19.strictObject({
  source: z19.string().min(1),
  dependencies: z19.array(rawDependencySchema),
  dependents: z19.array(z19.string().min(1)),
  orphan: z19.boolean(),
  valid: z19.boolean(),
  coreModule: z19.boolean().optional(),
  couldNotResolve: z19.boolean().optional(),
  followable: z19.boolean().optional(),
  matchesDoNotFollow: z19.boolean().optional(),
  dependencyTypes: z19.array(z19.string().min(1)).optional()
});
var rawDependencyCruiserReportSchema = z19.strictObject({
  modules: z19.array(rawModuleSchema),
  summary: z19.object({
    violations: z19.array(rawViolationSchema),
    error: z19.number().int().nonnegative(),
    warn: z19.number().int().nonnegative(),
    info: z19.number().int().nonnegative(),
    ignore: z19.number().int().nonnegative(),
    totalCruised: z19.number().int().nonnegative(),
    totalDependenciesCruised: z19.number().int().nonnegative()
  }).superRefine((summary, ctx) => {
    if (summary.error + summary.warn + summary.info + summary.ignore < summary.violations.length) {
      ctx.addIssue({
        code: "custom",
        message: "the severity totals must account for every reported violation — the report contradicts itself",
        path: ["error"]
      });
    }
  })
});
function parseRawDependencyCruiserReport(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      reasons: [`raw dependency-cruiser report is not valid JSON: ${messageOf(error)}`]
    };
  }
  const result = rawDependencyCruiserReportSchema.safeParse(parsed);
  if (result.success) {
    return { ok: true, report: result.data };
  }
  return {
    ok: false,
    reasons: capReasons(result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`))
  };
}
function validateRawDependencyCruiserEvidence(report, selectionPaths, ruleNames) {
  const reasons = [];
  const sources = new Set;
  for (const module of report.modules) {
    if (sources.has(module.source)) {
      reasons.push(`module "${module.source}" is reported twice — the graph is not a graph`);
    }
    sources.add(module.source);
  }
  for (const [index, violation] of report.summary.violations.entries()) {
    if (!ruleNames.has(violation.rule.name)) {
      reasons.push(`violation #${index} names rule "${violation.rule.name}", which the compiled policy does not declare`);
    }
    if (!selectionPaths.has(violation.from)) {
      reasons.push(`violation #${index} originates in "${violation.from}", which is outside the staged selection`);
    }
  }
  return capReasons(reasons);
}

// src/providers/dependency-cruiser/invocation.ts
class InvalidDependencyCruiserRequestError extends Error {
  constructor(reason) {
    super(`invalid dependency-cruiser request: ${reason}`);
    this.name = "InvalidDependencyCruiserRequestError";
  }
}
var DEPENDENCY_CRUISER_DEFAULT_TIMEOUT_MS = 60000;
var DEPENDENCY_CRUISER_DEFAULT_MAX_OUTPUT_BYTES = 4000000;
function normalizeLimit(name, value, fallback) {
  if (value === undefined)
    return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new InvalidDependencyCruiserRequestError(`${name} must be a positive integer`);
  }
  return value;
}
function normalizeDependencyCruiserRequest(request = {}) {
  const { signal } = request;
  if (signal !== undefined && (typeof signal !== "object" || signal === null)) {
    throw new InvalidDependencyCruiserRequestError("signal must be an AbortSignal");
  }
  return {
    timeoutMs: normalizeLimit("timeoutMs", request.timeoutMs, DEPENDENCY_CRUISER_DEFAULT_TIMEOUT_MS),
    maxOutputBytes: normalizeLimit("maxOutputBytes", request.maxOutputBytes, DEPENDENCY_CRUISER_DEFAULT_MAX_OUTPUT_BYTES),
    signal,
    resolve: request.resolve ?? {}
  };
}
function pinnedEntry() {
  const entry = pinnedTool(DEPENDENCY_CRUISER_PROVIDER_ID);
  if (entry === undefined) {
    throw new Error(`no pinned tool manifest entry for "${DEPENDENCY_CRUISER_PROVIDER_ID}"`);
  }
  return entry;
}
function dependencyCruiserPinnedToolVersion() {
  return pinnedEntry().pinnedVersion;
}
function resolveDependencyCruiserTypescript(resolution) {
  const launcherDir = dirname5(resolution.executablePath);
  const packageRoot = dirname5(launcherDir);
  let current = packageRoot;
  while (true) {
    const manifestPath = join10(current, "node_modules", "typescript", "package.json");
    if (existsSync2(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync2(manifestPath, "utf8"));
        if (manifest.name === "typescript" && typeof manifest.version === "string") {
          return { version: manifest.version };
        }
      } catch {}
    }
    const parent = dirname5(current);
    if (parent === current) {
      return {
        state: "unavailable",
        reason: "the pinned dependency-cruiser resolves no local TypeScript compiler — without one it " + "exits successfully with an empty graph (the research record), so the analysis would " + "fabricate coverage; prepare a local typescript installation in the pinned tool's " + "resolution chain (e.g. `bun install` where trellis resolves from)"
      };
    }
    current = parent;
  }
}
function pinnedLauncherInvocation(resolution) {
  return {
    interpreter: resolveExecutable("bun"),
    launcher: pinnedExecutable(DEPENDENCY_CRUISER_PROVIDER_ID, resolution.executablePath),
    args: [resolution.executablePath]
  };
}
function dependencyCruiserProviderOptions(policy) {
  return {
    ...policy.identityOptions,
    "ts-pre-compilation-deps": true,
    "do-not-follow": "node_modules",
    extensions: ".ts,.tsx,.js,.json",
    "condition-names": "import,require,node,default",
    "ts-config": "generated-minimal",
    "output-type": "json"
  };
}
function dependencyCruiserEnvironment(homeDir) {
  return { HOME: homeDir, USERPROFILE: homeDir };
}
function dependencyCruiserProviderIdentity(policy) {
  return {
    kind: "external",
    id: DEPENDENCY_CRUISER_PROVIDER_ID,
    toolVersion: dependencyCruiserPinnedToolVersion(),
    adapterVersion: DEPENDENCY_CRUISER_ADAPTER_VERSION,
    mode: DEPENDENCY_CRUISER_MODE,
    options: dependencyCruiserProviderOptions(policy)
  };
}
function sourceSelectionFromStagedView(view) {
  if (view.files.length === 0)
    return;
  return {
    sourceSets: [...new Set(view.files.map((file) => file.sourceSet))].sort(),
    files: view.files.map((file) => ({ path: file.path, fingerprint: file.sha256 })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  };
}
function dependencyCruiserAnalysisIdentity(view, policy, parserVersion) {
  const selection = sourceSelectionFromStagedView(view);
  if (selection === undefined)
    return;
  return {
    selection,
    parser: { engine: DEPENDENCY_CRUISER_PARSER_ENGINE, version: parserVersion },
    options: dependencyCruiserProviderOptions(policy)
  };
}
function neverRan(policy, state, reason) {
  return { provider: dependencyCruiserProviderIdentity(policy), state, reason };
}

// src/providers/dependency-cruiser/tool-config.ts
function edgeKindFilter(edges) {
  if (edges.length === 1 && edges[0] === "type-only") {
    return { dependencyTypes: ["type-only"] };
  }
  if (edges.includes("type-only")) {
    return {};
  }
  return { dependencyTypesNot: ["type-only"] };
}
function forbiddenRule(rule) {
  return { severity: "error", ...rule };
}
function forbiddenRules(rules) {
  const generated = [];
  for (const rule of rules) {
    switch (rule.kind) {
      case "boundary":
        if (rule.allowance === "forbidden") {
          generated.push(forbiddenRule({
            name: rule.name,
            from: { path: rule.from },
            to: { path: rule.to, ...edgeKindFilter(rule.edges) }
          }));
        }
        break;
      case "cycle":
        generated.push(forbiddenRule({
          name: rule.name,
          from: {},
          to: { circular: true, ...edgeKindFilter(rule.edges) }
        }));
        break;
      case "unresolved":
        generated.push(forbiddenRule({
          name: rule.name,
          from: {},
          to: {
            couldNotResolve: true,
            pathNot: "^[A-Za-z@]"
          }
        }));
        break;
    }
  }
  return generated;
}
function dependencyCruiserToolConfig(policy, paths) {
  return {
    forbidden: forbiddenRules(policy.rules),
    options: {
      doNotFollow: { path: "node_modules" },
      tsPreCompilationDeps: true,
      tsConfig: { fileName: paths.tsConfigPath },
      enhancedResolveOptions: {
        extensions: [".ts", ".tsx", ".js", ".json"],
        conditionNames: ["import", "require", "node", "default"]
      }
    }
  };
}
function dependencyCruiserTsConfig() {
  return `${JSON.stringify({
    compilerOptions: {
      module: "ESNext",
      moduleResolution: "Bundler",
      allowImportingTsExtensions: true,
      noEmit: true
    },
    include: ["../source/**/*"]
  }, undefined, 2)}
`;
}
function dependencyCruiserInvocationArgs(configPath) {
  return ["--config", configPath, "--output-type", "json", "."];
}
function generatedRuleNames(policy) {
  return new Set(policy.rules.filter((rule) => rule.kind !== "boundary" || rule.allowance === "forbidden").map((rule) => rule.name));
}

// src/providers/dependency-cruiser/cruise-run.ts
var MAX_EXCERPT_CHARS = 240;
var MAX_NAMED_MISSING_FILES = 5;
function cruiseOutcomeReason(outcome) {
  switch (outcome.kind) {
    case "exited":
      return `the provider process exited with code ${outcome.exitCode}`;
    case "signaled":
      return `the provider process was terminated by signal ${outcome.signalCode}`;
    default:
      return outcome.reason;
  }
}
function excerpt(text) {
  const collapsed = text.replaceAll(/\s+/g, " ").trim();
  return collapsed.length > MAX_EXCERPT_CHARS ? `${collapsed.slice(0, MAX_EXCERPT_CHARS)}…` : collapsed;
}
function classifyStub(source, module) {
  if (module.coreModule === true)
    return "builtin";
  if (module.couldNotResolve === true && /^(\.{1,2}\/|\/|#)/.test(source)) {
    return "unresolved-local";
  }
  return "external";
}
function cruiseCoverage(view, report) {
  const selection = new Set(view.files.map((file) => file.path));
  const represented = [];
  const stubs = [];
  for (const module of report.modules) {
    if (selection.has(module.source)) {
      represented.push(module.source);
      continue;
    }
    stubs.push({ source: module.source, kind: classifyStub(module.source, module) });
  }
  const representedSet = new Set(represented);
  return {
    selectedFiles: selection.size,
    representedFiles: represented.sort((a, b) => a < b ? -1 : a > b ? 1 : 0),
    missingFiles: view.files.map((file) => file.path).filter((path) => !representedSet.has(path)).sort((a, b) => a < b ? -1 : a > b ? 1 : 0),
    stubs: stubs.sort((a, b) => a.source < b.source ? -1 : a.source > b.source ? 1 : a.kind < b.kind ? -1 : 1),
    totalCruised: report.summary.totalCruised
  };
}
function stagingGapReason(view) {
  const unreadable = view.readFailures.length;
  const refused = view.rejected.length;
  if (unreadable === 0 && refused === 0)
    return;
  return `${unreadable} selected file(s) could not be read and ${refused} were refused staging — the staged view does not cover the full intended selection`;
}
function missingFilesReason(coverage) {
  const named = coverage.missingFiles.slice(0, MAX_NAMED_MISSING_FILES).map((path) => `"${path}"`);
  const further = coverage.missingFiles.length - named.length;
  const suffix = further > 0 ? `, …and ${further} more` : "";
  return `the reported graph does not assert ${coverage.missingFiles.length} of ` + `${coverage.selectedFiles} staged files (${named.join(", ")}${suffix}) — a missing or unsupported ` + `TypeScript parser, an unresolvable tsconfig or an excluded module set produces a successful empty ` + `graph, so these files are not asserted analyzed`;
}
async function runDependencyCruiserCruise(view, policy, invocation, parserVersion, limits) {
  const provider = dependencyCruiserProviderIdentity(policy);
  const analysis = dependencyCruiserAnalysisIdentity(view, policy, parserVersion);
  if (analysis === undefined) {
    return {
      state: "unavailable",
      provider,
      reason: "the staged selection is empty — architecture evidence requires at least one staged file to analyze"
    };
  }
  const unavailable = (reason) => ({
    state: "unavailable",
    provider,
    reason
  });
  const configPath = join11(view.workDir, "dependency-cruiser.json");
  const tsConfigPath = join11(view.workDir, "tsconfig.json");
  try {
    await mkdir2(view.workDir, { recursive: true });
    await writeFile2(configPath, `${JSON.stringify(dependencyCruiserToolConfig(policy, { tsConfigPath }), undefined, 2)}
`);
    await writeFile2(tsConfigPath, dependencyCruiserTsConfig());
  } catch (error) {
    return unavailable(`owned scratch could not be prepared (${messageOf(error)})`);
  }
  const result = await runControlledProcess(invocation.interpreter, {
    args: [invocation.launcher.path, ...dependencyCruiserInvocationArgs(configPath)],
    cwd: view.stagedRoot,
    env: dependencyCruiserEnvironment(view.workDir),
    timeoutMs: limits.timeoutMs,
    maxOutputBytes: limits.maxOutputBytes,
    signal: limits.signal
  });
  if (result.outcome.kind !== "exited") {
    return unavailable(cruiseOutcomeReason(result.outcome));
  }
  const exitCode = result.outcome.exitCode;
  if (exitCode !== 0) {
    const diagnostics = excerpt(result.stderr);
    return {
      state: "incomplete",
      provider,
      analysis,
      reason: `dependency-cruiser exited with code ${exitCode}` + (diagnostics === "" ? " (no diagnostics)" : `: ${diagnostics}`),
      exitCode
    };
  }
  const parsed = parseRawDependencyCruiserReport(result.stdout);
  if (!parsed.ok) {
    return {
      state: "incomplete",
      provider,
      analysis,
      reason: `raw dependency-cruiser report failed validation: ${parsed.reasons.join("; ")}`,
      exitCode
    };
  }
  const report = parsed.report;
  const coverage = cruiseCoverage(view, report);
  const selectionPaths = new Set(view.files.map((file) => file.path));
  const suspect = validateRawDependencyCruiserEvidence(report, selectionPaths, generatedRuleNames(policy));
  const gap = stagingGapReason(view);
  if (suspect.length === 0 && coverage.missingFiles.length === 0 && gap === undefined) {
    return { state: "complete", provider, analysis, report, coverage, exitCode };
  }
  const parts = [];
  if (coverage.missingFiles.length > 0)
    parts.push(missingFilesReason(coverage));
  if (suspect.length > 0)
    parts.push(`the raw report carries suspect evidence: ${suspect.join("; ")}`);
  if (gap !== undefined)
    parts.push(gap);
  return {
    state: "incomplete",
    provider,
    analysis,
    reason: parts.join("; "),
    report,
    coverage,
    exitCode
  };
}

// src/providers/dependency-cruiser/policy.ts
function compileRule(rule) {
  switch (rule.kind) {
    case "boundary":
      return {
        kind: "boundary",
        name: rule.name,
        allowance: rule.allowance,
        edges: rule.edges,
        from: rule.from.path,
        to: rule.to.path
      };
    case "cycle":
      return { kind: "cycle", name: rule.name, edges: rule.edges };
    case "unresolved":
      return { kind: "unresolved", name: rule.name };
  }
}
function canonicalRule(rule) {
  switch (rule.kind) {
    case "boundary":
      return {
        kind: rule.kind,
        name: rule.name,
        allowance: rule.allowance,
        edges: rule.edges,
        from: rule.from,
        to: rule.to
      };
    case "cycle":
      return { kind: rule.kind, name: rule.name, edges: rule.edges };
    case "unresolved":
      return { kind: rule.kind, name: rule.name };
  }
}
function compileArchitecturePolicy(request) {
  const parsed = dependencyCruiserProviderRequestSchema.parse(request);
  const rules = (parsed.rules ?? []).map(compileRule).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const canonical = JSON.stringify({
    version: ARCHITECTURE_POLICY_VERSION,
    rules: rules.map(canonicalRule)
  });
  const digest = sha256Hex(canonical);
  const ruleCount = rules.length;
  return {
    version: ARCHITECTURE_POLICY_VERSION,
    rules,
    ruleCount,
    bounds: {
      maxRules: MAX_ARCHITECTURE_RULES,
      maxPatternLength: MAX_ARCHITECTURE_PATTERN_LENGTH,
      maxRuleNameLength: MAX_ARCHITECTURE_RULE_NAME_LENGTH
    },
    canonical,
    digest,
    identityOptions: {
      "architecture-policy-version": ARCHITECTURE_POLICY_VERSION,
      "architecture-rule-count": ruleCount,
      "architecture-policy-digest": `sha256:${digest}`
    }
  };
}

// src/providers/dependency-cruiser/adapter.ts
async function verifyPinnedVersion(invocation, homeDir, limits, expected) {
  const result = await runControlledProcess(invocation.interpreter, {
    args: [invocation.launcher.path, "--version"],
    env: dependencyCruiserEnvironment(homeDir),
    timeoutMs: limits.timeoutMs,
    maxOutputBytes: limits.maxOutputBytes,
    signal: limits.signal
  });
  if (result.outcome.kind !== "exited") {
    const reason = "reason" in result.outcome ? result.outcome.reason : `the provider process ${result.outcome.kind}`;
    return {
      ok: false,
      reason: `pinned dependency-cruiser version check could not run (${reason})`
    };
  }
  const reported = result.stdout.trim();
  if (result.outcome.exitCode !== 0 || reported !== expected) {
    return {
      ok: false,
      reason: `the resolved dependency-cruiser is not the pinned tool: --version reported ${JSON.stringify(reported)}, ` + `expected ${JSON.stringify(expected)}`
    };
  }
  return { ok: true };
}
function unavailableOutcome(request, reason, instructions) {
  return {
    state: "unavailable",
    provider: dependencyCruiserProviderIdentity(compileArchitecturePolicy(request)),
    reason,
    ...instructions === undefined ? {} : { instructions }
  };
}
async function runDependencyCruiserAdapter(view, request, options = {}) {
  const normalized = normalizeDependencyCruiserRequest(options);
  const policy = compileArchitecturePolicy(request);
  const entry = pinnedTool(DEPENDENCY_CRUISER_PROVIDER_ID);
  if (entry === undefined) {
    throw new Error(`no pinned tool manifest entry for "${DEPENDENCY_CRUISER_PROVIDER_ID}"`);
  }
  const base = {
    toolVersion: entry.pinnedVersion,
    adapterVersion: DEPENDENCY_CRUISER_ADAPTER_VERSION
  };
  const neverRanParser = { engine: "unresolved", version: "0.0.0" };
  const resolution = resolvePinnedTool(DEPENDENCY_CRUISER_PROVIDER_ID, normalized.resolve);
  if (resolution.state !== "available") {
    return {
      ...base,
      resolution: {
        state: resolution.state,
        reason: resolution.reason,
        instructions: resolution.instructions
      },
      parser: neverRanParser,
      outcome: unavailableOutcome(request, resolution.reason, resolution.instructions)
    };
  }
  const availableResolution = {
    state: "available",
    platformKey: resolution.platformKey,
    binaryDigestVerified: resolution.binaryDigestVerified
  };
  const parser = resolveDependencyCruiserTypescript(resolution);
  if (!("version" in parser)) {
    return {
      ...base,
      resolution: availableResolution,
      parser: { state: "unavailable", reason: parser.reason },
      outcome: unavailableOutcome(request, parser.reason)
    };
  }
  const invocation = pinnedLauncherInvocation(resolution);
  const limits = {
    timeoutMs: normalized.timeoutMs,
    maxOutputBytes: normalized.maxOutputBytes,
    ...normalized.signal === undefined ? {} : { signal: normalized.signal }
  };
  const version = await verifyPinnedVersion(invocation, view.workDir, limits, entry.versionOutput);
  if (!version.ok) {
    return {
      ...base,
      resolution: availableResolution,
      parser: { engine: DEPENDENCY_CRUISER_PARSER_ENGINE, version: parser.version },
      outcome: unavailableOutcome(request, version.reason)
    };
  }
  const outcome = await runDependencyCruiserCruise(view, policy, invocation, parser.version, limits);
  return {
    ...base,
    resolution: availableResolution,
    parser: { engine: DEPENDENCY_CRUISER_PARSER_ENGINE, version: parser.version },
    outcome
  };
}

// src/providers/dependency-cruiser/normalize.ts
class InvalidDependencyCruiserEvidenceError extends Error {
  constructor(reason) {
    super(`invalid dependency-cruiser evidence: ${reason}`);
    this.name = "InvalidDependencyCruiserEvidenceError";
  }
}
var MODULE_RANGE = { start: { line: 1 }, end: { line: 1 } };
function edgeFlavors(dependencyTypes) {
  return dependencyTypes.includes("type-only") ? ["type-only"] : ["runtime"];
}
function ruleKindOf(policy, name) {
  for (const rule of policy.rules) {
    if (rule.name !== name)
      continue;
    if (rule.kind === "unresolved")
      return "unresolved";
    if (rule.kind === "cycle")
      return "cycle";
    return "boundary";
  }
  throw new InvalidDependencyCruiserEvidenceError(`violation names rule "${name}", which the compiled policy does not declare`);
}
function exemptingRule(policy, violation) {
  for (const rule of policy.rules) {
    if (rule.kind !== "boundary" || rule.allowance !== "allowed")
      continue;
    const from = new RegExp(rule.from);
    const to = new RegExp(rule.to);
    if (!from.test(violation.from) || !to.test(violation.to))
      continue;
    if (rule.edges.some((edge) => violation.edges.includes(edge)))
      return rule.name;
  }
  return;
}
function byNormalizedUnit(a, b) {
  if (a.rule !== b.rule)
    return a.rule < b.rule ? -1 : 1;
  if (a.from !== b.from)
    return a.from < b.from ? -1 : 1;
  if (a.to !== b.to)
    return a.to < b.to ? -1 : 1;
  const aSpecifier = a.specifier ?? "";
  const bSpecifier = b.specifier ?? "";
  return aSpecifier < bSpecifier ? -1 : 1;
}
function violationFinding(violation) {
  const target = violation.type === "cycle" ? `cycle ${violation.cycle.length > 0 ? violation.cycle.join(" -> ") : violation.to}` : violation.type === "unresolved" ? `unresolved import '${violation.specifier}'` : `imports ${violation.to}`;
  return {
    kind: namespacedEvidenceId(DEPENDENCY_CRUISER_PROVIDER_ID, violation.rule),
    path: violation.from,
    range: MODULE_RANGE,
    summary: `${violation.type} rule '${violation.rule}': ${violation.from} ${target}`,
    facts: {
      rule: violation.rule,
      violationType: violation.type,
      to: violation.to,
      specifier: violation.specifier,
      edges: [...violation.edges],
      ...violation.cycle.length === 0 ? {} : { cycle: [...violation.cycle] }
    }
  };
}
function allowedFinding(dependency) {
  return {
    kind: namespacedEvidenceId(DEPENDENCY_CRUISER_PROVIDER_ID, "allowed-dependency"),
    path: dependency.from,
    range: MODULE_RANGE,
    summary: `allowed boundary '${dependency.rule}' exempts ${dependency.from} -> ${dependency.to} ` + `('${dependency.specifier}') from every forbidden boundary`,
    facts: {
      rule: dependency.rule,
      to: dependency.to,
      specifier: dependency.specifier
    }
  };
}
function countMetric(name, value, detail) {
  return {
    id: namespacedEvidenceId(DEPENDENCY_CRUISER_PROVIDER_ID, name),
    state: "complete",
    value,
    unit: "count",
    ...detail === undefined ? {} : { detail }
  };
}
function stubCounts(stubs) {
  const counts = { builtin: 0, external: 0, "unresolved-local": 0 };
  for (const stub of stubs) {
    counts[stub.kind] = (counts[stub.kind] ?? 0) + 1;
  }
  return counts;
}
function normalizeViolations(report, policy, selection) {
  const violations = [];
  const allowed = [];
  for (const violation of report.summary.violations) {
    const normalized = {
      rule: violation.rule.name,
      type: ruleKindOf(policy, violation.rule.name),
      from: violation.from,
      to: violation.to,
      specifier: violation.unresolvedTo ?? violation.to,
      edges: edgeFlavors(violation.dependencyTypes),
      cycle: violation.cycle?.map((member) => member.name) ?? []
    };
    if (!selection.has(normalized.from)) {
      throw new InvalidDependencyCruiserEvidenceError(`violation of '${normalized.rule}' originates in "${normalized.from}", which is outside the staged selection`);
    }
    const exempt = normalized.type === "boundary" ? exemptingRule(policy, normalized) : undefined;
    if (exempt !== undefined) {
      allowed.push({
        rule: exempt,
        from: normalized.from,
        to: normalized.to,
        specifier: normalized.specifier
      });
      continue;
    }
    violations.push(normalized);
  }
  violations.sort(byNormalizedUnit);
  allowed.sort(byNormalizedUnit);
  return { violations, allowed };
}
function countLocalEdges(report, selection) {
  let local = 0;
  let typeOnly = 0;
  let dynamic = 0;
  for (const module of report.modules) {
    if (!selection.has(module.source))
      continue;
    for (const dependency of module.dependencies) {
      if (!selection.has(dependency.resolved))
        continue;
      local += 1;
      if (dependency.dependencyTypes.includes("type-only"))
        typeOnly += 1;
      if (dependency.dynamic)
        dynamic += 1;
    }
  }
  return { local, typeOnly, dynamic };
}
function normalizedMetrics(coverage, violations, allowed, edges) {
  const perRule = {};
  for (const violation of violations) {
    perRule[violation.rule] = (perRule[violation.rule] ?? 0) + 1;
  }
  const isFullyAsserted = coverage.missingFiles.length === 0;
  const nodesMetric = {
    id: namespacedEvidenceId(DEPENDENCY_CRUISER_PROVIDER_ID, "graph.nodes"),
    state: isFullyAsserted ? "complete" : "incomplete",
    value: coverage.representedFiles.length,
    unit: "count",
    ...isFullyAsserted ? {} : { reason: missingFilesReason(coverage) }
  };
  return [
    nodesMetric,
    countMetric("graph.stubs", coverage.stubs.length, { classes: stubCounts(coverage.stubs) }),
    countMetric("graph.edges", edges.local, { typeOnly: edges.typeOnly, dynamic: edges.dynamic }),
    countMetric("violations", violations.length, { byRule: perRule }),
    countMetric("allowed-dependencies", allowed.length)
  ].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
function byFinding(a, b) {
  if (a.kind !== b.kind)
    return a.kind < b.kind ? -1 : 1;
  if (a.path !== b.path)
    return a.path < b.path ? -1 : 1;
  return a.summary < b.summary ? -1 : 1;
}
function normalizeDependencyCruiserReport(report, policy, coverage, selectionPaths) {
  const selection = new Set(selectionPaths);
  const { violations, allowed } = normalizeViolations(report, policy, selection);
  const edges = countLocalEdges(report, selection);
  const findings = [
    ...violations.map(violationFinding),
    ...allowed.map(allowedFinding)
  ].sort(byFinding);
  return {
    metrics: normalizedMetrics(coverage, violations, allowed, edges),
    findings,
    violations,
    allowedDependencies: allowed
  };
}

// src/providers/dependency-cruiser/analysis.ts
function stagedBySourceSet(view) {
  const bySourceSet = {};
  for (const file of view.files) {
    bySourceSet[file.sourceSet] = (bySourceSet[file.sourceSet] ?? 0) + 1;
  }
  return bySourceSet;
}
function stagingDiagnostics(view) {
  return [
    ...view.readFailures.map((failure) => ({ path: failure.path, message: failure.reason })),
    ...view.rejected.map((rejection) => ({ path: rejection.path, message: rejection.reason }))
  ];
}
function normalizedEvidence(view, request, outcome) {
  if (!("report" in outcome) || outcome.report === undefined) {
    throw new Error("the outcome carries no raw report to normalize");
  }
  const coverage = "coverage" in outcome && outcome.coverage !== undefined ? outcome.coverage : { selectedFiles: 0, representedFiles: [], missingFiles: [], stubs: [], totalCruised: 0 };
  return normalizeDependencyCruiserReport(outcome.report, compileArchitecturePolicy(request), coverage, view.files.map((file) => file.path));
}
function observedCoverage(view, analyzedFiles, diagnostics) {
  return {
    analyzedFiles: [...analyzedFiles].sort((a, b) => a < b ? -1 : a > b ? 1 : 0),
    bySourceSet: stagedBySourceSet(view),
    diagnostics,
    unsupported: []
  };
}
async function foldOutcome(view, request, adapter) {
  const outcome = adapter.outcome;
  if (outcome.state !== "complete" && outcome.state !== "incomplete") {
    const reason = "instructions" in outcome && outcome.instructions !== undefined ? `${outcome.reason} — ${outcome.instructions}` : outcome.reason;
    return neverRan(compileArchitecturePolicy(request), outcome.state, reason);
  }
  if (outcome.state === "incomplete") {
    const base = {
      provider: outcome.provider,
      state: "incomplete",
      analysis: outcome.analysis,
      reason: outcome.reason
    };
    const analyzed = "coverage" in outcome ? outcome.coverage?.representedFiles ?? [] : [];
    const diagnostics = [...stagingDiagnostics(view), { message: outcome.reason }];
    try {
      const normalized = normalizedEvidence(view, request, outcome);
      return {
        ...base,
        observedCoverage: observedCoverage(view, analyzed, diagnostics),
        metrics: [...normalized.metrics],
        findings: [...normalized.findings]
      };
    } catch {
      return { ...base, observedCoverage: observedCoverage(view, analyzed, diagnostics) };
    }
  }
  try {
    const normalized = normalizedEvidence(view, request, outcome);
    return {
      provider: outcome.provider,
      state: "complete",
      analysis: outcome.analysis,
      observedCoverage: {
        analyzedFiles: [...outcome.coverage.representedFiles],
        bySourceSet: stagedBySourceSet(view),
        diagnostics: [],
        unsupported: []
      },
      metrics: [...normalized.metrics],
      findings: [...normalized.findings]
    };
  } catch (error) {
    return {
      provider: outcome.provider,
      state: "incomplete",
      analysis: outcome.analysis,
      reason: `validated dependency-cruiser evidence failed to normalize over the staged snapshot: ${messageOf(error)}`,
      observedCoverage: {
        analyzedFiles: [...outcome.coverage.representedFiles],
        bySourceSet: stagedBySourceSet(view),
        diagnostics: [{ message: messageOf(error) }],
        unsupported: []
      }
    };
  }
}
function degradedForCleanup(result, cleanup) {
  if (cleanup.status !== "failed")
    return result;
  const note = `owned scratch cleanup failed: ${cleanup.reason}`;
  const coverage = result.observedCoverage;
  if (result.state === "complete" && coverage !== undefined) {
    return {
      ...result,
      state: "incomplete",
      reason: note,
      observedCoverage: {
        ...coverage,
        diagnostics: [...coverage.diagnostics, { message: note }]
      }
    };
  }
  return {
    ...result,
    reason: result.reason === undefined ? note : `${result.reason}; ${note}`
  };
}
async function runDependencyCruiserAnalysis(root, selection, request, options = {}) {
  const policy = compileArchitecturePolicy(request);
  if (selection.length === 0) {
    return neverRan(policy, "unsupported", "the measured selection is empty — architecture evidence requires at least one staged file to analyze");
  }
  const runRequest = {
    ...options.signal === undefined ? {} : { signal: options.signal },
    ...options.resolve === undefined ? {} : { resolve: options.resolve }
  };
  const lifecycleOptions = {
    ...options.signal === undefined ? {} : { signal: options.signal },
    ...options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }
  };
  let lifecycle;
  try {
    lifecycle = await withStagedWorkspaceView({ root, files: selection }, async (view) => await foldOutcome(view, request, await runDependencyCruiserAdapter(view, request, runRequest)), lifecycleOptions);
  } catch (error) {
    const reason = error instanceof InvalidStagingRequestError || error instanceof StagingError ? error.message : `staging failed unexpectedly: ${messageOf(error)}`;
    return neverRan(policy, "unavailable", reason);
  }
  switch (lifecycle.kind) {
    case "completed":
      return degradedForCleanup(lifecycle.value, lifecycle.cleanup);
    case "adapter-failed":
      return degradedForCleanup(neverRan(policy, "unavailable", `the dependency-cruiser adapter failed: ${messageOf(lifecycle.error)}`), lifecycle.cleanup);
    case "cancelled":
      return degradedForCleanup(neverRan(policy, "unavailable", "the audit was cancelled before the architecture analysis completed; the provider process group was terminated and no evidence was produced"), lifecycle.cleanup);
    case "timeout":
      return degradedForCleanup(neverRan(policy, "unavailable", "the architecture analysis exceeded its wall-time limit"), lifecycle.cleanup);
  }
}

// src/providers/jscpd/analysis.ts
import { readFile as readFile9 } from "node:fs/promises";

// src/providers/jscpd/invocation.ts
import { join as join12 } from "node:path";
import { z as z21 } from "zod";

// src/providers/jscpd/raw.ts
import { z as z20 } from "zod";
var JSCPD_PROVIDER_ID = "jscpd";
var JSCPD_ADAPTER_VERSION = "0.1.0";
var JSCPD_PARSER_ENGINE = "jscpd.tokenizer";
var JSCPD_RAW_MATCH_KINDS = ["exact", "renamed", "similar"];
var rawJscpdMatchKindSchema = z20.enum(JSCPD_RAW_MATCH_KINDS);
var MATCH_MODE_BY_RAW_KIND = {
  exact: "exact",
  renamed: "normalized",
  similar: "near"
};
var RAW_KINDS_BY_MODE = {
  exact: ["exact"],
  normalized: ["exact", "renamed"],
  near: ["exact", "renamed", "similar"]
};
var MAX_REASONS2 = 8;
function capReasons2(reasons) {
  const capped = reasons.slice(0, MAX_REASONS2);
  const omitted = reasons.length - capped.length;
  return omitted > 0 ? [...capped, `…and ${omitted} more problems`] : capped;
}
var rawJscpdLocSchema = z20.strictObject({
  column: z20.number().int().nonnegative(),
  line: z20.number().int().min(1),
  position: z20.number().int().nonnegative()
});
var rawJscpdCloneFileSchema = z20.strictObject({
  name: z20.string().min(1),
  start: z20.number().int().min(1),
  end: z20.number().int().min(1),
  startLoc: rawJscpdLocSchema,
  endLoc: rawJscpdLocSchema
}).superRefine((file, ctx) => {
  if (file.end < file.start) {
    ctx.addIssue({
      code: "custom",
      message: "clone span end line must not precede its start line",
      path: ["end"]
    });
    return;
  }
  if (file.startLoc.line !== file.start) {
    ctx.addIssue({
      code: "custom",
      message: "startLoc.line must agree with the reported start line",
      path: ["startLoc", "line"]
    });
  }
  if (file.endLoc.line !== file.end) {
    ctx.addIssue({
      code: "custom",
      message: "endLoc.line must agree with the reported end line",
      path: ["endLoc", "line"]
    });
  }
});
var rawJscpdCloneSchema = z20.strictObject({
  firstFile: rawJscpdCloneFileSchema,
  secondFile: rawJscpdCloneFileSchema,
  format: z20.string().min(1),
  fragment: z20.string(),
  isNew: z20.boolean(),
  kind: rawJscpdMatchKindSchema,
  lines: z20.number().int().min(1),
  tokens: z20.number().int().min(1),
  method: z20.string().min(1).optional(),
  similarity: z20.number().finite().gt(0).lte(1).optional()
}).superRefine((clone, ctx) => {
  const hasNearMissFields = clone.method !== undefined || clone.similarity !== undefined;
  if (clone.kind === "similar" && (!clone.method || clone.similarity === undefined)) {
    ctx.addIssue({
      code: "custom",
      message: "a similar clone must carry its method and similarity",
      path: ["kind"]
    });
    return;
  }
  if (clone.kind !== "similar" && hasNearMissFields) {
    ctx.addIssue({
      code: "custom",
      message: "method and similarity are near-miss fields only a similar clone carries",
      path: ["method"]
    });
  }
});
var rawJscpdFormatStatisticsSchema = z20.strictObject({
  clones: z20.number().int().nonnegative(),
  duplicatedLines: z20.number().int().nonnegative(),
  duplicatedTokens: z20.number().int().nonnegative(),
  lines: z20.number().int().nonnegative(),
  newClones: z20.number().int().nonnegative(),
  newDuplicatedLines: z20.number().int().nonnegative(),
  percentage: z20.number().finite().nonnegative(),
  percentageTokens: z20.number().finite().nonnegative(),
  sources: z20.number().int().nonnegative(),
  tokens: z20.number().int().nonnegative()
});
var rawJscpdStatisticsSchema = z20.strictObject({
  detectionDate: z20.string().min(1),
  formats: z20.record(z20.string().min(1), rawJscpdFormatStatisticsSchema),
  total: rawJscpdFormatStatisticsSchema
});
var rawJscpdReportSchema = z20.strictObject({
  duplicates: z20.array(rawJscpdCloneSchema),
  statistics: rawJscpdStatisticsSchema
}).superRefine((report, ctx) => {
  if (report.statistics.total.clones !== report.duplicates.length) {
    ctx.addIssue({
      code: "custom",
      message: `statistics.total.clones (${report.statistics.total.clones}) must equal the number of reported duplicates (${report.duplicates.length})`,
      path: ["statistics", "total", "clones"]
    });
  }
});
function parseRawJscpdReport(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, reasons: [`raw jscpd report is not valid JSON: ${messageOf(error)}`] };
  }
  const result = rawJscpdReportSchema.safeParse(parsed);
  if (result.success) {
    return { ok: true, report: result.data };
  }
  const reasons = capReasons2(result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
  return { ok: false, reasons };
}
function normalizeCloneName(name) {
  return name.replaceAll("\\", "/");
}
function validateRawJscpdEvidence(report, selectionPaths, mode) {
  const allowedKinds = new Set(RAW_KINDS_BY_MODE[mode]);
  const reasons = [];
  for (const [index, clone] of report.duplicates.entries()) {
    for (const side of ["firstFile", "secondFile"]) {
      const name = normalizeCloneName(clone[side].name);
      if (!selectionPaths.has(name)) {
        reasons.push(`duplicate #${index} (${side}) references "${name}", which is outside the staged selection`);
      }
    }
    if (!allowedKinds.has(clone.kind)) {
      reasons.push(`duplicate #${index} reports kind "${clone.kind}", which the "${mode}" mode never produces in the pinned tool`);
    }
  }
  if (report.statistics.total.sources > selectionPaths.size) {
    reasons.push(`statistics.total.sources (${report.statistics.total.sources}) exceeds the staged selection (${selectionPaths.size} files)`);
  }
  return capReasons2(reasons);
}

// src/providers/jscpd/invocation.ts
class InvalidJscpdRequestError extends Error {
  constructor(reason) {
    super(`invalid jscpd request: ${reason}`);
    this.name = "InvalidJscpdRequestError";
  }
}
var jscpdThresholdsSchema = z21.strictObject({
  minTokens: z21.number().int().positive(),
  minLines: z21.number().int().positive(),
  maxGapLines: z21.number().int().nonnegative(),
  similarity: z21.number().finite().gt(0).lte(1)
});
var JSCPD_DEFAULT_THRESHOLDS = {
  minTokens: 50,
  minLines: 3,
  maxGapLines: 2,
  similarity: 0.85
};
var JSCPD_DETECTION_MODE = "weak";
var JSCPD_MAX_FILE_SIZE = "100mb";
var JSCPD_WORKERS = 1;
function pinnedJscpdEntry() {
  const entry = pinnedTool(JSCPD_PROVIDER_ID);
  if (entry === undefined) {
    throw new Error(`no pinned tool manifest entry for "${JSCPD_PROVIDER_ID}"`);
  }
  return entry;
}
function jscpdPinnedToolVersion() {
  return pinnedJscpdEntry().pinnedVersion;
}
function jscpdModeFlags(mode, thresholds) {
  if (mode === "exact") {
    return [];
  }
  if (mode === "normalized") {
    return ["--ignore-identifiers", "--ignore-literals"];
  }
  return [
    "--ignore-identifiers",
    "--ignore-literals",
    "--max-gap-lines",
    String(thresholds.maxGapLines),
    "--similarity",
    String(thresholds.similarity)
  ];
}
function jscpdProviderOptions(mode, thresholds) {
  const options = {
    "min-tokens": thresholds.minTokens,
    "min-lines": thresholds.minLines,
    "skip-comments": true,
    "no-gitignore": true,
    workers: JSCPD_WORKERS,
    "max-size": JSCPD_MAX_FILE_SIZE,
    reporters: "json"
  };
  if (mode === "normalized" || mode === "near") {
    options["ignore-identifiers"] = true;
    options["ignore-literals"] = true;
  }
  if (mode === "near") {
    options["max-gap-lines"] = thresholds.maxGapLines;
    options.similarity = thresholds.similarity;
  }
  return options;
}
function jscpdInvocationArgs(input) {
  return [
    input.stagedRoot,
    "--config",
    input.configPath,
    "--min-tokens",
    String(input.thresholds.minTokens),
    "--min-lines",
    String(input.thresholds.minLines),
    "--mode",
    JSCPD_DETECTION_MODE,
    "--no-gitignore",
    "--workers",
    String(JSCPD_WORKERS),
    "--max-size",
    JSCPD_MAX_FILE_SIZE,
    "--reporters",
    "json",
    "--output",
    input.outputDir,
    "--silent",
    "--no-tips",
    ...jscpdModeFlags(input.mode, input.thresholds)
  ];
}
function jscpdProviderIdentity(mode, thresholds) {
  return {
    kind: "external",
    id: JSCPD_PROVIDER_ID,
    toolVersion: jscpdPinnedToolVersion(),
    adapterVersion: JSCPD_ADAPTER_VERSION,
    mode,
    options: jscpdProviderOptions(mode, thresholds)
  };
}
function sourceSelectionFromStagedView2(view) {
  if (view.files.length === 0) {
    throw new InvalidJscpdRequestError("the staged selection is empty — jscpd evidence requires at least one staged file");
  }
  return {
    sourceSets: [...new Set(view.files.map((file) => file.sourceSet))].sort(),
    files: view.files.map((file) => ({ path: file.path, fingerprint: file.sha256 })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  };
}
function jscpdAnalysisIdentity(view, mode, thresholds) {
  return {
    selection: sourceSelectionFromStagedView2(view),
    parser: { engine: JSCPD_PARSER_ENGINE, version: jscpdPinnedToolVersion() },
    options: jscpdProviderOptions(mode, thresholds)
  };
}
function jscpdConfigPath(view) {
  return join12(view.workDir, "config.json");
}
function jscpdOutputDir(view, mode) {
  return join12(view.workDir, `report-${mode}`);
}

// src/providers/jscpd/mode-run.ts
import { mkdir as mkdir3, readFile as readFile8, writeFile as writeFile3 } from "node:fs/promises";
import { join as join13 } from "node:path";
var JSCPD_REPORT_FILE_NAME = "jscpd-report.json";
var MAX_EXCERPT_CHARS2 = 240;
function outcomeReason(outcome) {
  if (outcome.kind === "exited") {
    return `the provider process exited with code ${outcome.exitCode}`;
  }
  if (outcome.kind === "signaled") {
    return `the provider process was terminated by signal ${outcome.signalCode}`;
  }
  return outcome.reason;
}
function excerpt2(text) {
  const collapsed = text.replaceAll(/\s+/g, " ").trim();
  return collapsed.length > MAX_EXCERPT_CHARS2 ? `${collapsed.slice(0, MAX_EXCERPT_CHARS2)}…` : collapsed;
}
function coverageAccount(view, report) {
  const selectedFiles = view.files.length;
  const reportedSources = report.statistics.total.sources;
  return {
    selectedFiles,
    reportedSources,
    omittedFromSourceStatistics: Math.max(0, selectedFiles - reportedSources)
  };
}
function stagingGapReason2(view) {
  const unreadable = view.readFailures.length;
  const refused = view.rejected.length;
  if (unreadable === 0 && refused === 0) {
    return;
  }
  return `${unreadable} selected file(s) could not be read and ${refused} were refused staging — the staged view does not cover the full intended selection`;
}
async function runJscpdMode(view, executable, mode, options) {
  const provider = jscpdProviderIdentity(mode, options.thresholds);
  const analysis = jscpdAnalysisIdentity(view, mode, options.thresholds);
  const unavailable = (reason) => ({
    state: "unavailable",
    mode,
    provider,
    reason
  });
  const configPath = jscpdConfigPath(view);
  const outputDir = jscpdOutputDir(view, mode);
  try {
    await writeFile3(configPath, "{}");
    await mkdir3(outputDir, { recursive: true });
  } catch (error) {
    return unavailable(`owned scratch could not be prepared (${messageOf(error)})`);
  }
  const result = await runControlledProcess(executable, {
    args: jscpdInvocationArgs({
      stagedRoot: view.stagedRoot,
      configPath,
      outputDir,
      mode,
      thresholds: options.thresholds
    }),
    cwd: view.scratchDir,
    env: {},
    timeoutMs: options.limits.timeoutMs,
    maxOutputBytes: options.limits.maxOutputBytes,
    signal: options.limits.signal
  });
  if (result.outcome.kind !== "exited") {
    return unavailable(outcomeReason(result.outcome));
  }
  const exitCode = result.outcome.exitCode;
  if (exitCode !== 0) {
    const diagnostics = excerpt2(result.stderr);
    return {
      state: "incomplete",
      mode,
      provider,
      analysis,
      reason: `jscpd exited with code ${exitCode}` + (diagnostics === "" ? " (no diagnostics)" : `: ${diagnostics}`),
      exitCode
    };
  }
  const text = await readFile8(join13(outputDir, JSCPD_REPORT_FILE_NAME), "utf8").catch(() => {
    return;
  });
  if (text === undefined) {
    return {
      state: "incomplete",
      mode,
      provider,
      analysis,
      reason: `jscpd exited 0 but wrote no readable JSON report (expected ${JSCPD_REPORT_FILE_NAME} in the owned output area)`,
      exitCode
    };
  }
  const parsed = parseRawJscpdReport(text);
  if (!parsed.ok) {
    return {
      state: "incomplete",
      mode,
      provider,
      analysis,
      reason: `raw jscpd report failed validation: ${parsed.reasons.join("; ")}`,
      exitCode
    };
  }
  const report = parsed.report;
  const coverage = coverageAccount(view, report);
  const selectionPaths = new Set(view.files.map((file) => file.path));
  const reasons = validateRawJscpdEvidence(report, selectionPaths, mode);
  if (reasons.length > 0) {
    return {
      state: "incomplete",
      mode,
      provider,
      analysis,
      reason: `raw jscpd report carries suspect evidence: ${reasons.join("; ")}`,
      report,
      coverage,
      exitCode
    };
  }
  const gap = stagingGapReason2(view);
  if (coverage.omittedFromSourceStatistics === 0 && gap === undefined) {
    return {
      state: "complete",
      mode,
      provider,
      analysis,
      report,
      coverage: { ...coverage, analyzedFiles: [...selectionPaths].sort() },
      exitCode
    };
  }
  const parts = [];
  if (coverage.omittedFromSourceStatistics > 0) {
    parts.push(`${coverage.omittedFromSourceStatistics} of ${coverage.selectedFiles} staged files are omitted from ` + `jscpd's source statistics (below the ${options.thresholds.minTokens}-token threshold or skipped by ` + `the tool) — they are not asserted analyzed, so per-file observed coverage cannot be enumerated`);
  }
  if (gap !== undefined) {
    parts.push(gap);
  }
  return {
    state: "incomplete",
    mode,
    provider,
    analysis,
    reason: parts.join("; "),
    report,
    coverage: coverage.omittedFromSourceStatistics === 0 ? { ...coverage, analyzedFiles: [...selectionPaths].sort() } : coverage,
    exitCode
  };
}

// src/providers/jscpd/adapter.ts
var JSCPD_DEFAULT_TIMEOUT_MS = 60000;
var JSCPD_DEFAULT_MAX_OUTPUT_BYTES = 1e6;
function normalizeModes(requested) {
  if (!Array.isArray(requested) || requested.length === 0) {
    throw new InvalidJscpdRequestError("modes must be a non-empty array of match modes");
  }
  const modes = [];
  for (const mode of new Set(requested)) {
    if (typeof mode !== "string" || !CLONE_MATCH_MODES.includes(mode)) {
      throw new InvalidJscpdRequestError(`unknown jscpd match mode "${String(mode)}"`);
    }
    modes.push(mode);
  }
  return modes.sort((a, b) => CLONE_MATCH_MODES.indexOf(a) - CLONE_MATCH_MODES.indexOf(b));
}
function normalizeThresholds(thresholds) {
  const parsed = jscpdThresholdsSchema.safeParse(thresholds ?? JSCPD_DEFAULT_THRESHOLDS);
  if (!parsed.success) {
    throw new InvalidJscpdRequestError(`invalid thresholds: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
  }
  return parsed.data;
}
function normalizeLimit2(name, value, fallback) {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new InvalidJscpdRequestError(`${name} must be a positive integer`);
  }
  return value;
}
function normalizeRequest(request) {
  if (request === null || typeof request !== "object") {
    throw new InvalidJscpdRequestError("request must be an object");
  }
  const { signal } = request;
  if (signal !== undefined && (typeof signal !== "object" || signal === null)) {
    throw new InvalidJscpdRequestError("signal must be an AbortSignal");
  }
  return {
    modes: normalizeModes(request.modes ?? CLONE_MATCH_MODES),
    thresholds: normalizeThresholds(request.thresholds),
    timeoutMs: normalizeLimit2("timeoutMs", request.timeoutMs, JSCPD_DEFAULT_TIMEOUT_MS),
    maxOutputBytes: normalizeLimit2("maxOutputBytes", request.maxOutputBytes, JSCPD_DEFAULT_MAX_OUTPUT_BYTES),
    signal,
    resolve: request.resolve ?? {}
  };
}
async function verifyPinnedVersion2(executable, limits, expected) {
  const result = await runControlledProcess(executable, {
    args: ["--version"],
    env: {},
    timeoutMs: limits.timeoutMs,
    maxOutputBytes: limits.maxOutputBytes,
    signal: limits.signal
  });
  if (result.outcome.kind !== "exited") {
    return {
      ok: false,
      reason: `pinned jscpd version check could not run (${outcomeReason(result.outcome)})`
    };
  }
  const reported = result.stdout.trim();
  if (result.outcome.exitCode !== 0 || reported !== expected) {
    return {
      ok: false,
      reason: `the resolved jscpd binary is not the pinned tool: --version reported ${JSON.stringify(reported)}, ` + `expected ${JSON.stringify(expected)}`
    };
  }
  return { ok: true };
}
async function runJscpdAdapter(view, request = {}) {
  const normalized = normalizeRequest(request);
  const entry = pinnedTool(JSCPD_PROVIDER_ID);
  if (entry === undefined) {
    throw new Error(`no pinned tool manifest entry for "${JSCPD_PROVIDER_ID}"`);
  }
  const base = { toolVersion: entry.pinnedVersion, adapterVersion: JSCPD_ADAPTER_VERSION };
  if (view.files.length === 0) {
    throw new InvalidJscpdRequestError("the staged selection is empty — jscpd evidence requires at least one staged file");
  }
  const resolution = resolvePinnedTool(JSCPD_PROVIDER_ID, normalized.resolve);
  if (resolution.state !== "available") {
    return {
      ...base,
      resolution: {
        state: resolution.state,
        reason: resolution.reason,
        instructions: resolution.instructions
      },
      outcomes: normalized.modes.map((mode) => ({
        state: resolution.state,
        mode,
        provider: jscpdProviderIdentity(mode, normalized.thresholds),
        reason: resolution.reason,
        instructions: resolution.instructions
      }))
    };
  }
  const executable = pinnedExecutable(JSCPD_PROVIDER_ID, resolution.executablePath);
  const limits = {
    timeoutMs: normalized.timeoutMs,
    maxOutputBytes: normalized.maxOutputBytes,
    signal: normalized.signal
  };
  const version = await verifyPinnedVersion2(executable, limits, entry.versionOutput);
  if (!version.ok) {
    return {
      ...base,
      resolution: {
        state: "available",
        platformKey: resolution.platformKey,
        binaryDigestVerified: resolution.binaryDigestVerified
      },
      outcomes: normalized.modes.map((mode) => ({
        state: "unavailable",
        mode,
        provider: jscpdProviderIdentity(mode, normalized.thresholds),
        reason: version.reason
      }))
    };
  }
  const outcomes = [];
  for (const mode of normalized.modes) {
    outcomes.push(await runJscpdMode(view, executable, mode, {
      thresholds: normalized.thresholds,
      limits
    }));
  }
  return {
    ...base,
    resolution: {
      state: "available",
      platformKey: resolution.platformKey,
      binaryDigestVerified: resolution.binaryDigestVerified
    },
    outcomes
  };
}

// src/providers/jscpd/evidence.ts
var EVIDENCE_IDS = {
  pairKind: "clone-pair",
  groupKind: "clone-group",
  affectedLines: (set) => `duplication.affected-code-lines.${set}`,
  pairs: "duplication.clone-pairs",
  groups: "duplication.clone-groups"
};
function describe(location) {
  return `${location.path}:${location.range.start.line}-${location.range.end.line}`;
}
function compareMembersTotal(a, b) {
  const byContract = compareCloneLocations(a, b);
  if (byContract !== 0) {
    return byContract;
  }
  const endA = a.range.end.column ?? 0;
  const endB = b.range.end.column ?? 0;
  if (endA !== endB) {
    return endA - endB;
  }
  const serializedA = JSON.stringify([a.path, a.range]);
  const serializedB = JSON.stringify([b.path, b.range]);
  return serializedA < serializedB ? -1 : serializedA > serializedB ? 1 : 0;
}
function fragmentLineCount(fragment) {
  const lines = fragment.split(`
`);
  return lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
}
function memberFacts(evidence) {
  return evidence.members.map((member) => ({ path: member.path, range: member.range }));
}
function firstMemberOf(evidence) {
  const first = evidence.members[0];
  if (first === undefined) {
    throw new Error("clone evidence must carry at least one member");
  }
  return first;
}
function pairEntry(clone) {
  const members = [clone.first, clone.second].sort(compareMembersTotal);
  const first = members[0];
  const second = members[1];
  if (first === undefined || second === undefined) {
    throw new Error("a clone pair requires two member locations");
  }
  const evidence = {
    kind: "pair",
    matchMode: MATCH_MODE_BY_RAW_KIND[clone.record.kind],
    members: [first, second]
  };
  return {
    evidence,
    finding: {
      kind: namespacedEvidenceId(JSCPD_PROVIDER_ID, EVIDENCE_IDS.pairKind),
      path: first.path,
      range: first.range,
      summary: `jscpd ${evidence.matchMode} clone pair (${describe(first)} ~ ${describe(second)})`,
      facts: {
        matchMode: evidence.matchMode,
        rawKind: clone.record.kind,
        format: clone.record.format,
        lines: clone.record.lines,
        tokens: clone.record.tokens,
        isNew: clone.record.isNew,
        ...clone.record.method === undefined ? {} : { method: clone.record.method },
        ...clone.record.similarity === undefined ? {} : { similarity: clone.record.similarity },
        members: memberFacts(evidence)
      }
    }
  };
}
function groupEntry(fragment, classRecords) {
  const members = classRecords.flatMap((clone) => [clone.first, clone.second]).sort(compareMembersTotal);
  const unique = [];
  for (const member of members) {
    const previous = unique[unique.length - 1];
    if (previous === undefined || compareCloneLocations(previous, member) !== 0) {
      unique.push(member);
    }
  }
  const allExact = classRecords.every((clone) => clone.record.kind === "exact");
  const evidence = {
    kind: "group",
    matchMode: allExact ? "exact" : "normalized",
    members: unique
  };
  const first = firstMemberOf(evidence);
  return {
    evidence,
    finding: {
      kind: namespacedEvidenceId(JSCPD_PROVIDER_ID, EVIDENCE_IDS.groupKind),
      path: first.path,
      range: first.range,
      summary: `jscpd ${evidence.matchMode} clone group: ${unique.length} locations of identical content`,
      facts: {
        matchMode: evidence.matchMode,
        memberCount: unique.length,
        rawKinds: [...new Set(classRecords.map((clone) => clone.record.kind))].sort(),
        contentLines: fragmentLineCount(fragment),
        members: memberFacts(evidence)
      }
    }
  };
}
function compareEvidence(a, b) {
  const byLocation = compareCloneLocations(firstMemberOf(a), firstMemberOf(b));
  if (byLocation !== 0) {
    return byLocation;
  }
  if (a.kind !== b.kind) {
    return a.kind < b.kind ? -1 : 1;
  }
  if (a.members.length !== b.members.length) {
    return a.members.length - b.members.length;
  }
  const serializedA = JSON.stringify(a.members);
  const serializedB = JSON.stringify(b.members);
  return serializedA < serializedB ? -1 : serializedA > serializedB ? 1 : 0;
}
function rawTotalsOf(report) {
  const formats = {};
  for (const [format, totals] of Object.entries(report.statistics.formats).sort(([a], [b]) => a < b ? -1 : 1)) {
    formats[format] = totals;
  }
  return { total: report.statistics.total, formats };
}
function lineMetric(set, account) {
  return {
    id: namespacedEvidenceId(JSCPD_PROVIDER_ID, EVIDENCE_IDS.affectedLines(set)),
    state: "complete",
    value: account.affectedCodeLines,
    unit: "lines",
    ...account.codeLines > 0 ? { numerator: account.affectedCodeLines, denominator: account.codeLines } : {},
    detail: { files: account.files }
  };
}
function countMetric2(name, count) {
  return {
    id: namespacedEvidenceId(JSCPD_PROVIDER_ID, name),
    state: "complete",
    value: count,
    unit: "count"
  };
}
function unitCountMetrics(pairCount, groupCount) {
  return [countMetric2(EVIDENCE_IDS.pairs, pairCount), countMetric2(EVIDENCE_IDS.groups, groupCount)];
}

// src/providers/jscpd/lines.ts
class InvalidJscpdEvidenceError extends Error {
  constructor(reason) {
    super(`invalid jscpd evidence: ${reason}`);
    this.name = "InvalidJscpdEvidenceError";
  }
}
function requireAccountable(file, seen) {
  if (seen.has(file.path)) {
    throw new InvalidJscpdEvidenceError(`accounted file "${file.path}" is listed more than once`);
  }
  if (file.sourceSet !== "production" && file.sourceSet !== "test") {
    throw new InvalidJscpdEvidenceError(`accounted file "${file.path}" belongs to the ${JSON.stringify(file.sourceSet)} source set; ` + "jscpd line accounting covers the measured production/test sets only");
  }
}
function indexAccountedFiles(files) {
  const byPath = new Map;
  const seen = new Set;
  for (const file of files) {
    requireAccountable(file, seen);
    seen.add(file.path);
    byPath.set(file.path, {
      file,
      kinds: classifyLines(parseSource(file.path, file.text).sourceFile)
    });
  }
  return byPath;
}
function coverMember(flags, member, lineCount) {
  const first = Math.max(1, member.startLine);
  const last = Math.min(member.endLine, lineCount);
  for (let line = first;line <= last; line += 1)
    flags[line - 1] = true;
}
function coveredLinesByPath(members, byPath) {
  const covered = new Map;
  for (const member of members) {
    const accounted = byPath.get(member.path);
    if (accounted === undefined) {
      throw new InvalidJscpdEvidenceError(`clone member references "${member.path}", which is not an accounted file`);
    }
    if (member.endLine < member.startLine) {
      throw new InvalidJscpdEvidenceError(`clone member span in "${member.path}" ends (${member.endLine}) before it starts (${member.startLine})`);
    }
    let flags = covered.get(member.path);
    if (flags === undefined) {
      flags = new Array(accounted.kinds.length).fill(false);
      covered.set(member.path, flags);
    }
    coverMember(flags, member, accounted.kinds.length);
  }
  return covered;
}
function foldFile(account, entry, flags) {
  account.files += 1;
  for (const [index, kind] of entry.kinds.entries()) {
    if (kind !== "code")
      continue;
    account.codeLines += 1;
    if (flags !== undefined && flags[index] === true)
      account.affectedCodeLines += 1;
  }
}
function accountCloneLines(files, members) {
  const byPath = indexAccountedFiles(files);
  const covered = coveredLinesByPath(members, byPath);
  const accounts = {
    production: { files: 0, codeLines: 0, affectedCodeLines: 0 },
    test: { files: 0, codeLines: 0, affectedCodeLines: 0 }
  };
  for (const entry of byPath.values()) {
    foldFile(accounts[entry.file.sourceSet], entry, covered.get(entry.file.path));
  }
  return accounts;
}

// src/providers/jscpd/normalize.ts
var EQUIVALENT_KINDS = new Set(["exact", "renamed"]);
function canonicalPath(name, selectionPaths) {
  const normalized = name.replaceAll("\\", "/").replace(/^(\.\/)+/, "");
  let best;
  for (const path of selectionPaths) {
    if (path === normalized) {
      return path;
    }
    if (normalized.endsWith(`/${path}`) && (best === undefined || path.length > best.length)) {
      best = path;
    }
  }
  if (best !== undefined) {
    return best;
  }
  throw new InvalidJscpdEvidenceError(`clone references "${name}", which does not resolve against the accounted selection`);
}
function cloneLocation(side, selectionPaths) {
  return {
    path: canonicalPath(side.name, selectionPaths),
    range: {
      start: { line: side.start, column: side.startLoc.column + 1 },
      end: { line: side.end, column: side.endLoc.column + 1 }
    }
  };
}
function canonicalClones(report, selectionPaths) {
  return report.duplicates.map((record) => ({
    first: cloneLocation(record.firstFile, selectionPaths),
    second: cloneLocation(record.secondFile, selectionPaths),
    record
  }));
}
function fragmentClasses(clones) {
  const classes = new Map;
  for (const clone of clones) {
    if (!EQUIVALENT_KINDS.has(clone.record.kind)) {
      continue;
    }
    const classRecords = classes.get(clone.record.fragment);
    if (classRecords === undefined) {
      classes.set(clone.record.fragment, [clone]);
    } else {
      classRecords.push(clone);
    }
  }
  return classes;
}
function groupEntries(classes) {
  const entries = [];
  const grouped = new Set;
  for (const [fragment, classRecords] of [...classes.entries()].sort(([a], [b]) => a < b ? -1 : 1)) {
    if (classRecords.length < 2) {
      continue;
    }
    const entry = groupEntry(fragment, classRecords);
    if (entry.evidence.members.length < 2) {
      continue;
    }
    entries.push(entry);
    for (const clone of classRecords) {
      grouped.add(clone);
    }
  }
  return { entries, grouped };
}
function pairEntries(clones, grouped) {
  const entries = [];
  let degenerateRecords = 0;
  for (const clone of clones) {
    if (grouped.has(clone)) {
      continue;
    }
    if (compareCloneLocations(clone.first, clone.second) === 0) {
      degenerateRecords += 1;
      continue;
    }
    entries.push(pairEntry(clone));
  }
  return { entries, degenerateRecords };
}
function memberSpansOf(clones) {
  return clones.flatMap((clone) => [
    {
      path: clone.first.path,
      startLine: clone.first.range.start.line,
      endLine: clone.first.range.end.line
    },
    {
      path: clone.second.path,
      startLine: clone.second.range.start.line,
      endLine: clone.second.range.end.line
    }
  ]);
}
function normalizeJscpdReport(report, files) {
  const selectionPaths = files.map((file) => file.path);
  const clones = canonicalClones(report, selectionPaths);
  const classes = fragmentClasses(clones);
  const groups = groupEntries(classes);
  const pairs = pairEntries(clones, groups.grouped);
  const entries = [...groups.entries, ...pairs.entries].sort((a, b) => compareEvidence(a.evidence, b.evidence));
  const evidence = entries.map((entry) => entry.evidence);
  const lineAccounting = accountCloneLines(files, memberSpansOf(clones));
  const pairCount = evidence.filter((entry) => entry.kind === "pair").length;
  const groupCount = evidence.filter((entry) => entry.kind === "group").length;
  const metrics = [
    lineMetric("production", lineAccounting.production),
    lineMetric("test", lineAccounting.test),
    ...unitCountMetrics(pairCount, groupCount)
  ].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return {
    cloneEvidence: evidence,
    metrics,
    findings: entries.map((entry) => entry.finding),
    lineAccounting,
    rawTotals: rawTotalsOf(report),
    degenerateRecords: pairs.degenerateRecords
  };
}

// src/providers/jscpd/analysis.ts
function requestedIdentity(mode) {
  return jscpdProviderIdentity(mode, JSCPD_DEFAULT_THRESHOLDS);
}
function neverRan2(mode, state, reason) {
  return { provider: requestedIdentity(mode), state, reason };
}
async function accountedFiles(view) {
  const accounted = [];
  for (const file of view.files) {
    if (file.sourceSet !== "production" && file.sourceSet !== "test")
      continue;
    accounted.push({
      path: file.path,
      sourceSet: file.sourceSet,
      text: await readFile9(file.stagedPath, "utf8")
    });
  }
  return accounted;
}
function stagedBySourceSet2(view) {
  const bySourceSet = {};
  for (const file of view.files) {
    bySourceSet[file.sourceSet] = (bySourceSet[file.sourceSet] ?? 0) + 1;
  }
  return bySourceSet;
}
async function normalizedEvidence2(view, outcome) {
  if (!("report" in outcome) || outcome.report === undefined) {
    throw new Error("the outcome carries no raw report to normalize");
  }
  return normalizeJscpdReport(outcome.report, await accountedFiles(view));
}
function stagingDiagnostics2(view) {
  return [
    ...view.readFailures.map((failure) => ({ path: failure.path, message: failure.reason })),
    ...view.rejected.map((rejection) => ({ path: rejection.path, message: rejection.reason }))
  ];
}
function incompleteCoverage(view, outcome) {
  const analyzed = "coverage" in outcome ? outcome.coverage?.analyzedFiles ?? [] : [];
  const diagnostics = stagingDiagnostics2(view);
  const hasGap = analyzed.length !== view.files.length || diagnostics.length > 0;
  return {
    analyzedFiles: [...analyzed].sort((a, b) => a < b ? -1 : a > b ? 1 : 0),
    diagnostics: hasGap ? diagnostics : [...diagnostics, { message: outcome.reason }],
    unsupported: []
  };
}
async function foldJscpdOutcome(view, adapter, mode) {
  const outcome = adapter.outcomes[0];
  if (outcome === undefined || outcome.mode !== mode || adapter.outcomes.length !== 1) {
    throw new Error(`the jscpd adapter returned ${adapter.outcomes.length} outcomes for the single requested mode "${mode}"`);
  }
  if (outcome.state !== "complete" && outcome.state !== "incomplete") {
    const reason = "instructions" in outcome && outcome.instructions !== undefined ? `${outcome.reason} — ${outcome.instructions}` : outcome.reason;
    return neverRan2(mode, outcome.state, reason);
  }
  if (outcome.state === "incomplete") {
    const base = {
      provider: outcome.provider,
      state: "incomplete",
      analysis: outcome.analysis,
      reason: outcome.reason,
      observedCoverage: incompleteCoverage(view, outcome)
    };
    try {
      const normalized = await normalizedEvidence2(view, outcome);
      return {
        ...base,
        metrics: [...normalized.metrics],
        findings: [...normalized.findings],
        cloneEvidence: [...normalized.cloneEvidence]
      };
    } catch {
      return base;
    }
  }
  try {
    const normalized = await normalizedEvidence2(view, outcome);
    return {
      provider: outcome.provider,
      state: "complete",
      analysis: outcome.analysis,
      observedCoverage: {
        analyzedFiles: [...outcome.coverage.analyzedFiles],
        bySourceSet: stagedBySourceSet2(view),
        diagnostics: [],
        unsupported: []
      },
      metrics: [...normalized.metrics],
      findings: [...normalized.findings],
      cloneEvidence: [...normalized.cloneEvidence]
    };
  } catch (error) {
    return {
      provider: outcome.provider,
      state: "incomplete",
      analysis: outcome.analysis,
      reason: `validated jscpd evidence failed to normalize over the staged snapshot: ${messageOf(error)}`,
      observedCoverage: {
        analyzedFiles: [],
        bySourceSet: stagedBySourceSet2(view),
        diagnostics: [{ message: messageOf(error) }],
        unsupported: []
      }
    };
  }
}
function degradedForCleanup2(result, cleanup) {
  if (cleanup.status !== "failed")
    return result;
  const note = `owned scratch cleanup failed: ${cleanup.reason}`;
  const coverage = result.observedCoverage;
  if (result.state === "complete" && coverage !== undefined) {
    return {
      ...result,
      state: "incomplete",
      reason: note,
      observedCoverage: {
        ...coverage,
        diagnostics: [...coverage.diagnostics, { message: note }]
      }
    };
  }
  return {
    ...result,
    reason: result.reason === undefined ? note : `${result.reason}; ${note}`
  };
}
async function runJscpdAnalysis(root, selection, mode, options = {}) {
  if (selection.length === 0) {
    return neverRan2(mode, "unsupported", "the measured production/test selection is empty — jscpd evidence requires at least one staged file to analyze");
  }
  const request = {
    modes: [mode],
    thresholds: JSCPD_DEFAULT_THRESHOLDS,
    ...options.resolve === undefined ? {} : { resolve: options.resolve }
  };
  let lifecycle;
  try {
    lifecycle = await withStagedWorkspaceView({ root, files: selection }, async (view, signal) => await foldJscpdOutcome(view, await runJscpdAdapter(view, { ...request, signal }), mode), options.signal === undefined ? {} : { signal: options.signal });
  } catch (error) {
    const reason = error instanceof InvalidStagingRequestError || error instanceof StagingError ? error.message : `staging failed unexpectedly: ${messageOf(error)}`;
    return neverRan2(mode, "unavailable", reason);
  }
  switch (lifecycle.kind) {
    case "completed":
      return degradedForCleanup2(lifecycle.value, lifecycle.cleanup);
    case "adapter-failed":
      return degradedForCleanup2(neverRan2(mode, "unavailable", `the jscpd adapter failed: ${messageOf(lifecycle.error)}`), lifecycle.cleanup);
    case "cancelled":
      return degradedForCleanup2(neverRan2(mode, "unavailable", "the audit was cancelled before the jscpd analysis completed; the provider process group was terminated and no evidence was produced"), lifecycle.cleanup);
    case "timeout":
      return degradedForCleanup2(neverRan2(mode, "unavailable", "the jscpd analysis exceeded its wall-time limit"), lifecycle.cleanup);
  }
}

// src/providers/knip/adapter.ts
import { dirname as dirname7 } from "node:path";

// src/providers/knip/invocation.ts
import { existsSync as existsSync3, readFileSync as readFileSync3 } from "node:fs";
import { dirname as dirname6, join as join14 } from "node:path";

// src/providers/knip/raw.ts
import { z as z22 } from "zod";
var KNIP_PROVIDER_ID = "knip";
var KNIP_ADAPTER_VERSION = "0.1.0";
var KNIP_PARSER_ENGINE = "knip.oxc-parser";
var KNIP_MODE = "contextual";
var KNIP_INCLUDE = "files,exports,types,unresolved";
var MAX_REASONS3 = 8;
function capReasons3(reasons) {
  const capped = reasons.slice(0, MAX_REASONS3);
  const omitted = reasons.length - capped.length;
  return omitted > 0 ? [...capped, `…and ${omitted} more problems`] : capped;
}
var rawSymbolSchema = z22.strictObject({
  name: z22.string().min(1),
  namespace: z22.string().min(1).optional(),
  line: z22.number().int().min(1),
  col: z22.number().int().min(1),
  pos: z22.number().int().nonnegative()
});
var rawFileSchema = z22.strictObject({
  name: z22.string().min(1)
});
var rawKnipRowSchema = z22.strictObject({
  file: z22.string().min(1),
  exports: z22.array(rawSymbolSchema),
  files: z22.array(rawFileSchema),
  types: z22.array(rawSymbolSchema),
  unresolved: z22.array(rawSymbolSchema)
});
var rawKnipReportSchema = z22.strictObject({
  issues: z22.array(rawKnipRowSchema)
});
function parseRawKnipReport(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, reasons: [`raw knip report is not valid JSON: ${messageOf(error)}`] };
  }
  const result = rawKnipReportSchema.safeParse(parsed);
  if (result.success) {
    return { ok: true, report: result.data };
  }
  return {
    ok: false,
    reasons: capReasons3(result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`))
  };
}
function rowReasons(row, index, selectionPaths, rows) {
  const reasons = [];
  if (rows.has(row.file)) {
    reasons.push(`row #${index} repeats file "${row.file}" — the report is not one row per file`);
  }
  rows.add(row.file);
  if (!selectionPaths.has(row.file)) {
    reasons.push(`row #${index} names file "${row.file}", which is outside the staged selection`);
    return reasons;
  }
  for (const file of row.files) {
    if (file.name !== row.file) {
      reasons.push(`row #${index} carries an orphan record for "${file.name}", which is not the row's own file`);
    }
  }
  for (const [category, records] of [
    ["exports", row.exports],
    ["types", row.types],
    ["unresolved", row.unresolved]
  ]) {
    const seen = new Set;
    for (const record of records) {
      if (seen.has(record.name)) {
        reasons.push(`row #${index} reports ${category} record "${record.name}" twice — the report ` + "contradicts itself");
      }
      seen.add(record.name);
    }
  }
  return reasons;
}
function validateRawKnipEvidence(report, selectionPaths) {
  const reasons = [];
  const rows = new Set;
  for (const [index, row] of report.issues.entries()) {
    reasons.push(...rowReasons(row, index, selectionPaths, rows));
  }
  return capReasons3(reasons);
}

// src/providers/knip/invocation.ts
class InvalidKnipRequestError extends Error {
  constructor(reason) {
    super(`invalid knip request: ${reason}`);
    this.name = "InvalidKnipRequestError";
  }
}
var KNIP_DEFAULT_TIMEOUT_MS = 60000;
var KNIP_DEFAULT_MAX_OUTPUT_BYTES = 4000000;
function normalizeLimit3(name, value, fallback) {
  if (value === undefined)
    return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new InvalidKnipRequestError(`${name} must be a positive integer`);
  }
  return value;
}
function normalizeKnipRequest(request = {}) {
  const { signal } = request;
  if (signal !== undefined && (typeof signal !== "object" || signal === null)) {
    throw new InvalidKnipRequestError("signal must be an AbortSignal");
  }
  return {
    timeoutMs: normalizeLimit3("timeoutMs", request.timeoutMs, KNIP_DEFAULT_TIMEOUT_MS),
    maxOutputBytes: normalizeLimit3("maxOutputBytes", request.maxOutputBytes, KNIP_DEFAULT_MAX_OUTPUT_BYTES),
    signal,
    resolve: request.resolve ?? {}
  };
}
function pinnedEntry2() {
  const entry = pinnedTool(KNIP_PROVIDER_ID);
  if (entry === undefined) {
    throw new Error(`no pinned tool manifest entry for "${KNIP_PROVIDER_ID}"`);
  }
  return entry;
}
function knipPinnedToolVersion() {
  return pinnedEntry2().pinnedVersion;
}
function resolveKnipParser(resolution) {
  const packageRoot = dirname6(dirname6(resolution.executablePath));
  let current = packageRoot;
  while (true) {
    const manifestPath = join14(current, "node_modules", "oxc-parser", "package.json");
    if (existsSync3(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync3(manifestPath, "utf8"));
        if (manifest.name === "oxc-parser" && typeof manifest.version === "string") {
          return { version: manifest.version };
        }
      } catch {}
    }
    const parent = dirname6(current);
    if (parent === current) {
      return {
        state: "unavailable",
        reason: "the pinned knip resolves no local oxc-parser — its own analysis stack is incomplete; " + "prepare the pinned installation where trellis resolves from (e.g. `bun install` in this " + "repository) so the parser identity can be recorded instead of assumed"
      };
    }
    current = parent;
  }
}
function pinnedLauncherInvocation2(resolution) {
  return {
    interpreter: resolveExecutable("bun"),
    launcher: pinnedExecutable(KNIP_PROVIDER_ID, resolution.executablePath)
  };
}
function knipEnvironment(homeDir) {
  return { HOME: homeDir, USERPROFILE: homeDir };
}
function knipProviderOptions(context) {
  return {
    ...context.identityOptions,
    "resolved-entry-roots": context.entryRoots.length,
    "test-roots": context.testRoots.length,
    "project-files": context.projectFiles.length,
    "plugin-registry": "disabled",
    include: KNIP_INCLUDE,
    reporter: "json",
    gitignore: false,
    "config-hints": "errors"
  };
}
function knipProviderIdentity(context) {
  return {
    kind: "external",
    id: KNIP_PROVIDER_ID,
    toolVersion: knipPinnedToolVersion(),
    adapterVersion: KNIP_ADAPTER_VERSION,
    mode: KNIP_MODE,
    options: knipProviderOptions(context)
  };
}
function knipSourceSelection(view) {
  if (view.files.length === 0)
    return;
  return {
    sourceSets: [...new Set(view.files.map((file) => file.sourceSet))].sort(),
    files: view.files.map((file) => ({ path: file.path, fingerprint: file.sha256 })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  };
}
function knipAnalysisIdentity(view, context, parserVersion) {
  const selection = knipSourceSelection(view);
  if (selection === undefined)
    return;
  return {
    selection,
    parser: { engine: KNIP_PARSER_ENGINE, version: parserVersion },
    options: knipProviderOptions(context)
  };
}
function knipNeverRan(context, state, reason) {
  return { provider: knipProviderIdentity(context), state, reason };
}

// src/providers/knip/knip-run.ts
import { existsSync as existsSync4 } from "node:fs";
import { mkdir as mkdir4, writeFile as writeFile4 } from "node:fs/promises";
import { join as join16 } from "node:path";

// src/providers/knip/tool-config.ts
import { readFileSync as readFileSync4 } from "node:fs";
import { join as join15 } from "node:path";
var KNIP_PLUGIN_REGISTRY_REL_PATH = "dist/plugins/index.js";
function knipTsConfig() {
  return `${JSON.stringify({
    compilerOptions: {
      module: "ESNext",
      moduleResolution: "Bundler",
      allowImportingTsExtensions: true,
      noEmit: true
    }
  }, undefined, 2)}
`;
}
function knipWorkspaceManifest() {
  return `${JSON.stringify({
    name: "trellis-staged-reachability-view",
    private: true,
    type: "module"
  }, undefined, 2)}
`;
}
var GLOB_METACHARACTERS = new Set("*?[]{}!()+@|^\\".split(""));
function escapeGlobPattern(path) {
  return [...path].map((char) => GLOB_METACHARACTERS.has(char) ? `\\${char}` : char).join("");
}
function disabledPluginNames(packageRoot) {
  let text;
  try {
    text = readFileSync4(join15(packageRoot, KNIP_PLUGIN_REGISTRY_REL_PATH), "utf8");
  } catch {
    return {
      state: "unavailable",
      reason: `the pinned knip artifact has no readable "${KNIP_PLUGIN_REGISTRY_REL_PATH}" — the runtime ` + "plugin registry cannot be enumerated, so plugin discovery cannot be explicitly disabled"
    };
  }
  const match = /export const Plugins = \{\n([\s\S]*?)\n\};/.exec(text);
  if (match === null) {
    return {
      state: "unavailable",
      reason: `the pinned knip artifact's "${KNIP_PLUGIN_REGISTRY_REL_PATH}" does not carry the expected ` + "Plugins export table — the runtime plugin registry cannot be enumerated"
    };
  }
  const names = new Set;
  for (const line of match[1]?.split(`
`) ?? []) {
    const trimmed = line.trim().replace(/,$/, "");
    const quoted = /^'([^']+)':/.exec(trimmed);
    if (quoted !== null && quoted[1] !== undefined) {
      names.add(quoted[1]);
      continue;
    }
    const shorthand = /^([A-Za-z0-9_$-]+)$/.exec(trimmed);
    if (shorthand !== null && shorthand[1] !== undefined) {
      names.add(shorthand[1]);
    }
  }
  if (names.size === 0) {
    return {
      state: "unavailable",
      reason: "the pinned knip artifact's plugin registry enumerated to zero plugins — refusing to guess"
    };
  }
  return { names: [...names].sort((a, b) => a < b ? -1 : a > b ? 1 : 0) };
}
function knipToolConfig(context, pluginNames) {
  const entryRoots = new Set(context.entryRoots);
  const entry = [...new Set([...context.entryRoots, ...context.testRoots])].sort((a, b) => a < b ? -1 : a > b ? 1 : 0).map(escapeGlobPattern);
  const project = context.projectFiles.filter((path) => !entryRoots.has(path)).map(escapeGlobPattern);
  const config = {
    entry,
    project
  };
  for (const name of pluginNames) {
    config[name] = false;
  }
  return config;
}
var KNIP_MAX_ISSUES_NEUTRALIZER = "1000000000";
function knipInvocationArgs(paths) {
  return [
    "--directory",
    paths.directory,
    "--config",
    paths.configPath,
    "--tsConfig",
    paths.tsConfigPath,
    "--reporter",
    "json",
    "--include",
    "files,exports,types,unresolved",
    "--no-tag-hints",
    "--no-progress",
    "--no-gitignore",
    "--max-issues",
    KNIP_MAX_ISSUES_NEUTRALIZER,
    "--treat-config-hints-as-errors"
  ];
}

// src/providers/knip/knip-run.ts
var MAX_EXCERPT_CHARS3 = 240;
var MAX_NAMED_SCOPE_GAPS = 5;
function knipOutcomeReason(outcome) {
  switch (outcome.kind) {
    case "exited":
      return `the provider process exited with code ${outcome.exitCode}`;
    case "signaled":
      return `the provider process was terminated by signal ${outcome.signalCode}`;
    default:
      return outcome.reason;
  }
}
function excerpt3(text) {
  const collapsed = text.replaceAll(/\s+/g, " ").trim();
  return collapsed.length > MAX_EXCERPT_CHARS3 ? `${collapsed.slice(0, MAX_EXCERPT_CHARS3)}…` : collapsed;
}
function reachabilityCoverage(view, context, report) {
  const staged = new Set(view.files.map((file) => file.path));
  const scope = [
    ...new Set([...context.entryRoots, ...context.testRoots, ...context.projectFiles])
  ].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  return {
    scopeFiles: scope,
    missingScopeFiles: scope.filter((path) => !staged.has(path)),
    candidateFiles: report === undefined ? [] : report.issues.map((row) => row.file).sort((a, b) => a < b ? -1 : a > b ? 1 : 0),
    issueRows: report?.issues.length ?? 0
  };
}
function scopeGapReason(coverage) {
  if (coverage.missingScopeFiles.length === 0)
    return;
  const named = coverage.missingScopeFiles.slice(0, MAX_NAMED_SCOPE_GAPS).map((path) => `"${path}"`);
  const further = coverage.missingScopeFiles.length - named.length;
  const suffix = further > 0 ? `, …and ${further} more` : "";
  return `${coverage.missingScopeFiles.length} submitted scope file(s) could not be staged ` + `(${named.join(", ")}${suffix}) — the pass ran over an incomplete copy of the declared ` + "reachability scope";
}
async function prepareOwnedScratch(view, context, pluginNames) {
  const manifestPath = join16(view.stagedRoot, "package.json");
  if (existsSync4(manifestPath)) {
    return {
      unavailable: "the staged source view unexpectedly carries a package manifest — the source-only staging " + "invariant is broken, so a target manifest could reach the analysis"
    };
  }
  const configPath = join16(view.workDir, "knip.json");
  const tsConfigPath = join16(view.workDir, "tsconfig.json");
  try {
    await mkdir4(view.workDir, { recursive: true });
    await writeFile4(configPath, `${JSON.stringify(knipToolConfig(context, pluginNames), undefined, 2)}
`);
    await writeFile4(tsConfigPath, knipTsConfig());
    await writeFile4(manifestPath, knipWorkspaceManifest());
  } catch (error) {
    return { unavailable: `owned scratch could not be prepared (${messageOf(error)})` };
  }
  return { configPath, tsConfigPath };
}
function decodePassOutcome(result, view, context, identities) {
  const { provider, analysis } = identities;
  const exitCode = result.outcome.exitCode;
  const parsed = parseRawKnipReport(result.stdout);
  if (exitCode === 2) {
    const diagnostics = excerpt3(result.stderr);
    return {
      state: "incomplete",
      provider,
      analysis,
      reason: `knip could not run its analysis (exit code 2)` + (diagnostics === "" ? " (no diagnostics)" : `: ${diagnostics}`),
      exitCode
    };
  }
  if (!parsed.ok) {
    return {
      state: "incomplete",
      provider,
      analysis,
      reason: `raw knip report failed validation: ${parsed.reasons.join("; ")}`,
      exitCode
    };
  }
  const report = parsed.report;
  const stagedPaths = new Set(view.files.map((file) => file.path));
  const suspect = validateRawKnipEvidence(report, stagedPaths);
  const coverage = reachabilityCoverage(view, context, report);
  const gap = scopeGapReason(coverage);
  const hintReason = "knip reported configuration hints — a submitted entry/project pattern matched no staged " + "file (the JSON report carries no hint detail); the pass is an empty or partial analysis of " + "the declared scope, never a clean pass";
  const parts = [];
  if (exitCode === 1)
    parts.push(hintReason);
  if (gap !== undefined)
    parts.push(gap);
  if (suspect.length > 0)
    parts.push(`the raw report carries suspect evidence: ${suspect.join("; ")}`);
  if (parts.length === 0) {
    return { state: "complete", provider, analysis, report, coverage, exitCode };
  }
  return {
    state: "incomplete",
    provider,
    analysis,
    reason: parts.join("; "),
    report,
    coverage,
    exitCode
  };
}
async function runKnipReachabilityPass(view, context, invocation, pluginNames, parserVersion, limits) {
  const provider = knipProviderIdentity(context);
  const analysis = knipAnalysisIdentity(view, context, parserVersion);
  if (analysis === undefined) {
    return {
      state: "unavailable",
      provider,
      reason: "the staged scope is empty — reachability evidence requires at least one staged file to analyze"
    };
  }
  const unavailable = (reason) => ({ state: "unavailable", provider, reason });
  const scratch = await prepareOwnedScratch(view, context, pluginNames);
  if ("unavailable" in scratch)
    return unavailable(scratch.unavailable);
  const result = await runControlledProcess(invocation.interpreter, {
    args: [
      invocation.launcher.path,
      ...knipInvocationArgs({
        directory: view.stagedRoot,
        configPath: scratch.configPath,
        tsConfigPath: scratch.tsConfigPath
      })
    ],
    cwd: view.stagedRoot,
    env: knipEnvironment(view.workDir),
    timeoutMs: limits.timeoutMs,
    maxOutputBytes: limits.maxOutputBytes,
    signal: limits.signal
  });
  if (result.outcome.kind !== "exited") {
    return unavailable(knipOutcomeReason(result.outcome));
  }
  return decodePassOutcome({ outcome: result.outcome, stdout: result.stdout, stderr: result.stderr }, view, context, { provider, analysis });
}

// src/providers/knip/adapter.ts
async function verifyPinnedVersion3(invocation, homeDir, limits, expected) {
  const result = await runControlledProcess(invocation.interpreter, {
    args: [invocation.launcher.path, "--version"],
    env: knipEnvironment(homeDir),
    timeoutMs: limits.timeoutMs,
    maxOutputBytes: limits.maxOutputBytes,
    signal: limits.signal
  });
  if (result.outcome.kind !== "exited") {
    const reason = "reason" in result.outcome ? result.outcome.reason : `the provider process ${result.outcome.kind}`;
    return {
      ok: false,
      reason: `pinned knip version check could not run (${reason})`
    };
  }
  const reported = result.stdout.trim();
  if (result.outcome.exitCode !== 0 || reported !== expected) {
    return {
      ok: false,
      reason: `the resolved knip is not the pinned tool: --version reported ${JSON.stringify(reported)}, ` + `expected ${JSON.stringify(expected)}`
    };
  }
  return { ok: true };
}
function unavailableOutcome2(context, reason, instructions) {
  return {
    state: "unavailable",
    provider: knipProviderIdentity(context),
    reason,
    ...instructions === undefined ? {} : { instructions }
  };
}
async function runKnipAdapter(view, context, options = {}) {
  const normalized = normalizeKnipRequest(options);
  const entry = pinnedTool(KNIP_PROVIDER_ID);
  if (entry === undefined) {
    throw new Error(`no pinned tool manifest entry for "${KNIP_PROVIDER_ID}"`);
  }
  const base = {
    toolVersion: entry.pinnedVersion,
    adapterVersion: KNIP_ADAPTER_VERSION
  };
  const resolution = resolvePinnedTool(KNIP_PROVIDER_ID, normalized.resolve);
  if (resolution.state !== "available") {
    return {
      ...base,
      resolution: {
        state: resolution.state,
        reason: resolution.reason,
        instructions: resolution.instructions
      },
      parser: { engine: "unresolved", version: "0.0.0" },
      disabledPlugins: { state: "unavailable", reason: resolution.reason },
      outcome: unavailableOutcome2(context, resolution.reason, resolution.instructions)
    };
  }
  const availableResolution = {
    state: "available",
    platformKey: resolution.platformKey,
    binaryDigestVerified: resolution.binaryDigestVerified
  };
  const parser = resolveKnipParser(resolution);
  if (!("version" in parser)) {
    return {
      ...base,
      resolution: availableResolution,
      parser: { state: "unavailable", reason: parser.reason },
      disabledPlugins: { state: "unavailable", reason: parser.reason },
      outcome: unavailableOutcome2(context, parser.reason)
    };
  }
  const parserIdentity = { engine: KNIP_PARSER_ENGINE, version: parser.version };
  const packageRoot = dirname7(dirname7(resolution.executablePath));
  const plugins = disabledPluginNames(packageRoot);
  if ("state" in plugins) {
    return {
      ...base,
      resolution: availableResolution,
      parser: parserIdentity,
      disabledPlugins: plugins,
      outcome: unavailableOutcome2(context, plugins.reason)
    };
  }
  const invocation = pinnedLauncherInvocation2(resolution);
  const limits = {
    timeoutMs: normalized.timeoutMs,
    maxOutputBytes: normalized.maxOutputBytes,
    ...normalized.signal === undefined ? {} : { signal: normalized.signal }
  };
  const version = await verifyPinnedVersion3(invocation, view.workDir, limits, entry.versionOutput);
  if (!version.ok) {
    return {
      ...base,
      resolution: availableResolution,
      parser: parserIdentity,
      disabledPlugins: plugins.names.length,
      outcome: unavailableOutcome2(context, version.reason)
    };
  }
  const outcome = await runKnipReachabilityPass(view, context, invocation, plugins.names, parser.version, limits);
  return {
    ...base,
    resolution: availableResolution,
    parser: parserIdentity,
    disabledPlugins: plugins.names.length,
    outcome
  };
}

// src/providers/knip/context.ts
function mergeSortedUnique(a, b) {
  const merged = [...new Set([...a, ...b])];
  return merged.sort((x, y) => x < y ? -1 : x > y ? 1 : 0);
}
function byPath2(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
function scopeSets(sourceSets) {
  const projectFiles = [];
  const testFiles = [];
  for (const [path, sourceSet] of sourceSets) {
    if (sourceSet === "production")
      projectFiles.push(path);
    else if (sourceSet === "test")
      testFiles.push(path);
  }
  projectFiles.sort(byPath2);
  testFiles.sort(byPath2);
  return { projectFiles, testFiles };
}
function resolveEntries(policy, sourceSets) {
  const entryRoots = [];
  const declaredTestEntries = [];
  const missingEntries = [];
  for (const path of policy.entries) {
    const sourceSet = sourceSets.get(path);
    if (sourceSet === "production")
      entryRoots.push(path);
    else if (sourceSet === "test")
      declaredTestEntries.push(path);
    else
      missingEntries.push(path);
  }
  return { entryRoots, declaredTestEntries, missingEntries };
}
function resolvePublicSurfaces(policy, sourceSets) {
  const publicSurfaces = [];
  const missingSurfaces = [];
  const nonProductionSurfaces = [];
  for (const surface of policy.publicSurfaces) {
    const sourceSet = sourceSets.get(surface.path);
    if (sourceSet === "production")
      publicSurfaces.push(surface);
    else if (sourceSet === undefined)
      missingSurfaces.push(surface.path);
    else
      nonProductionSurfaces.push(surface.path);
  }
  return { publicSurfaces, missingSurfaces, nonProductionSurfaces };
}
function collectAssumptions(policy, gaps, testFiles) {
  const assumptions = [...policy.assumptions];
  if (gaps.missingEntries.length > 0) {
    assumptions.push({
      id: "declared-entry-not-in-selection",
      paths: mergeSortedUnique(gaps.missingEntries, [])
    });
  }
  if (gaps.missingSurfaces.length > 0) {
    assumptions.push({
      id: "declared-public-surface-not-in-selection",
      paths: mergeSortedUnique(gaps.missingSurfaces, [])
    });
  }
  if (gaps.nonProductionSurfaces.length > 0) {
    assumptions.push({
      id: "public-surface-not-production",
      paths: mergeSortedUnique(gaps.nonProductionSurfaces, [])
    });
  }
  if (policy.testMode === "excluded" && testFiles.length > 0) {
    assumptions.push({ id: "tests-excluded", paths: [] });
  }
  assumptions.push({ id: "dependency-context-unverified", paths: [] });
  return assumptions.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
function prepareReachabilityContext(policy, selection) {
  const sourceSets = new Map;
  for (const file of selection)
    sourceSets.set(file.path, file.sourceSet);
  const { projectFiles, testFiles } = scopeSets(sourceSets);
  const { entryRoots, declaredTestEntries, missingEntries } = resolveEntries(policy, sourceSets);
  const { publicSurfaces, missingSurfaces, nonProductionSurfaces } = resolvePublicSurfaces(policy, sourceSets);
  const testRoots = mergeSortedUnique(policy.testMode === "roots" ? testFiles : [], declaredTestEntries);
  return {
    version: policy.version,
    digest: policy.digest,
    identityOptions: policy.identityOptions,
    pluginDiscovery: policy.pluginDiscovery,
    testMode: policy.testMode,
    entryRoots,
    testRoots,
    publicSurfaces,
    projectFiles,
    testFiles,
    assumptions: collectAssumptions(policy, { missingEntries, missingSurfaces, nonProductionSurfaces }, testFiles)
  };
}

// src/providers/knip/normalize.ts
var FILE_RANGE = { start: { line: 1 }, end: { line: 1 } };
function byCandidate(a, b) {
  if (a.path !== b.path)
    return a.path < b.path ? -1 : 1;
  const aSymbol = a.symbol ?? "";
  const bSymbol = b.symbol ?? "";
  if (aSymbol !== bSymbol)
    return aSymbol < bSymbol ? -1 : 1;
  if (a.category !== b.category)
    return a.category < b.category ? -1 : 1;
  return (a.line ?? 0) - (b.line ?? 0);
}
function byExemption(a, b) {
  if (a.surface !== b.surface)
    return a.surface < b.surface ? -1 : 1;
  if (a.path !== b.path)
    return a.path < b.path ? -1 : 1;
  if (a.category !== b.category)
    return a.category < b.category ? -1 : 1;
  return (a.symbol ?? "") < (b.symbol ?? "") ? -1 : 1;
}
function byFinding2(a, b) {
  if (a.path !== b.path)
    return a.path < b.path ? -1 : 1;
  if (a.kind !== b.kind)
    return a.kind < b.kind ? -1 : 1;
  return a.summary < b.summary ? -1 : 1;
}
function candidatesOf(report) {
  const candidates = [];
  for (const row of report.issues) {
    if (row.files.length > 0)
      candidates.push({ category: "file", path: row.file });
    const located = (category, records) => {
      for (const record of records) {
        candidates.push({
          category,
          path: row.file,
          symbol: record.name,
          ...record.namespace === undefined ? {} : { namespace: record.namespace },
          line: record.line,
          column: record.col
        });
      }
    };
    located("export", row.exports);
    located("type", row.types);
    located("unresolved", row.unresolved);
  }
  return candidates;
}
function exemptingSurface(context, candidate) {
  for (const surface of context.publicSurfaces) {
    if (surface.path !== candidate.path)
      continue;
    const isFileCandidate = candidate.category === "file";
    const isSymbolCandidate = candidate.category === "export" || candidate.category === "type";
    if (surface.export === undefined) {
      if (isFileCandidate || isSymbolCandidate)
        return surface.path;
      continue;
    }
    if (isFileCandidate)
      return `${surface.path}#${surface.export}`;
    if (isSymbolCandidate && candidate.symbol === surface.export) {
      return `${surface.path}#${surface.export}`;
    }
  }
  return;
}
function applyPublicSurfaces(context, candidates) {
  const standing = [];
  const exemptions = [];
  for (const candidate of candidates) {
    const surface = exemptingSurface(context, candidate);
    if (surface === undefined) {
      standing.push(candidate);
      continue;
    }
    exemptions.push({
      surface,
      category: candidate.category,
      path: candidate.path,
      ...candidate.symbol === undefined ? {} : { symbol: candidate.symbol }
    });
  }
  standing.sort(byCandidate);
  exemptions.sort(byExemption);
  return { standing, exemptions };
}
function candidateKind(category) {
  return namespacedEvidenceId(KNIP_PROVIDER_ID, category === "unresolved" ? "unresolved-import" : `unused-${category}`);
}
function candidateRange(candidate) {
  return {
    range: {
      start: { line: candidate.line ?? 1, column: candidate.column ?? 1 },
      end: { line: candidate.line ?? 1, column: candidate.column ?? 1 }
    },
    locatedFacts: candidate.line === undefined || candidate.symbol === undefined ? {} : { line: candidate.line, column: candidate.column, symbol: candidate.symbol }
  };
}
function candidateAt(candidate) {
  if (candidate.line === undefined)
    return "";
  return ` at ${candidate.path}:${candidate.line}:${candidate.column ?? 1}`;
}
function fileCandidateFinding(candidate) {
  return {
    kind: candidateKind(candidate.category),
    path: candidate.path,
    range: FILE_RANGE,
    summary: `unreferenced file candidate '${candidate.path}' — contextual: no declared root or ` + "re-export reaches it, never confirmed dead code",
    facts: { category: candidate.category }
  };
}
function unresolvedCandidateFinding(candidate) {
  const { range, locatedFacts } = candidateRange(candidate);
  return {
    kind: candidateKind(candidate.category),
    path: candidate.path,
    range,
    summary: `unresolved import '${candidate.symbol}'${candidateAt(candidate)} — the specifier resolved ` + "to no staged file (unverified dependency context: a recorded assumption, never a defect)",
    facts: { category: candidate.category, specifier: candidate.symbol ?? "", ...locatedFacts }
  };
}
function symbolCandidateFinding(candidate) {
  const { range, locatedFacts } = candidateRange(candidate);
  return {
    kind: candidateKind(candidate.category),
    path: candidate.path,
    range,
    summary: `unused ${candidate.category} candidate '${candidate.symbol}'${candidateAt(candidate)} — ` + "contextual over the declared reachability model, never confirmed dead code",
    facts: {
      category: candidate.category,
      ...candidate.namespace === undefined ? {} : { namespace: candidate.namespace },
      ...locatedFacts
    }
  };
}
function candidateFinding(candidate) {
  if (candidate.category === "file")
    return fileCandidateFinding(candidate);
  if (candidate.category === "unresolved")
    return unresolvedCandidateFinding(candidate);
  return symbolCandidateFinding(candidate);
}
function exemptionFinding(exemption) {
  return {
    kind: namespacedEvidenceId(KNIP_PROVIDER_ID, "public-surface"),
    path: exemption.path,
    range: FILE_RANGE,
    summary: `declared public surface '${exemption.surface}' exempts the ${exemption.category} candidate` + `${exemption.symbol === undefined ? "" : ` '${exemption.symbol}'`} — a visible exception ` + "from the declared reachability model, never silently dropped",
    facts: {
      surface: exemption.surface,
      category: exemption.category,
      ...exemption.symbol === undefined ? {} : { symbol: exemption.symbol }
    }
  };
}
function countMetric3(name, value, detail) {
  return {
    id: namespacedEvidenceId(KNIP_PROVIDER_ID, name),
    state: "complete",
    value,
    unit: "count",
    ...detail === undefined ? {} : { detail }
  };
}
function normalizedMetrics2(context, standing, exemptions) {
  const byCategory = {
    file: 0,
    export: 0,
    type: 0,
    unresolved: 0
  };
  for (const candidate of standing) {
    byCategory[candidate.category] += 1;
  }
  const assumptionIds = [...new Set(context.assumptions.map((assumption) => assumption.id))].sort();
  const scope = new Set([...context.entryRoots, ...context.testRoots, ...context.projectFiles]);
  return [
    countMetric3("candidates.files", byCategory.file),
    countMetric3("candidates.exports", byCategory.export),
    countMetric3("candidates.types", byCategory.type),
    countMetric3("candidates.unresolved", byCategory.unresolved),
    countMetric3("candidates.total", standing.length),
    countMetric3("exemptions.public-surfaces", exemptions.length),
    countMetric3("context.assumptions", context.assumptions.length, { ids: assumptionIds }),
    countMetric3("scope.files", scope.size, {
      entryRoots: context.entryRoots.length,
      testRoots: context.testRoots.length,
      projectFiles: context.projectFiles.length
    })
  ].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
function normalizeKnipReport(report, context) {
  const { standing, exemptions } = applyPublicSurfaces(context, candidatesOf(report));
  const findings = [
    ...standing.map(candidateFinding),
    ...exemptions.map(exemptionFinding)
  ].sort(byFinding2);
  return {
    metrics: normalizedMetrics2(context, standing, exemptions),
    findings,
    candidates: standing,
    exemptions,
    assumptions: [...context.assumptions]
  };
}

// src/providers/knip/policy.ts
function comparePublicSurfaces(a, b) {
  if (a.path !== b.path)
    return a.path < b.path ? -1 : 1;
  const aName = a.export ?? "";
  const bName = b.export ?? "";
  return aName < bName ? -1 : aName > bName ? 1 : 0;
}
function assumption(id, paths = []) {
  return { id, paths };
}
function compileReachabilityPolicy(request) {
  const parsed = knipProviderRequestSchema.parse(request);
  const entries = [...parsed.entries ?? []].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  const publicSurfaces = [...parsed.public ?? []].sort(comparePublicSurfaces);
  const testMode = parsed.tests ?? "excluded";
  const canonical = JSON.stringify({
    version: REACHABILITY_POLICY_VERSION,
    pluginDiscovery: "disabled",
    testMode,
    entries,
    public: publicSurfaces.map((surface) => surface.export === undefined ? { path: surface.path } : { path: surface.path, export: surface.export })
  });
  const digest = sha256Hex(canonical);
  const assumptions = [assumption("plugin-discovery-disabled")];
  if (entries.length === 0)
    assumptions.push(assumption("no-entries-declared"));
  if (publicSurfaces.length === 0)
    assumptions.push(assumption("no-public-surfaces-declared"));
  return {
    version: REACHABILITY_POLICY_VERSION,
    pluginDiscovery: "disabled",
    entries,
    publicSurfaces,
    testMode,
    bounds: {
      maxEntryFiles: MAX_REACHABILITY_ENTRY_FILES,
      maxPublicSurfaces: MAX_REACHABILITY_PUBLIC_SURFACES,
      maxPathLength: MAX_REACHABILITY_PATH_LENGTH,
      maxExportNameLength: MAX_REACHABILITY_EXPORT_NAME_LENGTH
    },
    canonical,
    digest,
    identityOptions: {
      "reachability-policy-version": REACHABILITY_POLICY_VERSION,
      "reachability-entry-count": entries.length,
      "reachability-public-surface-count": publicSurfaces.length,
      "reachability-test-mode": testMode,
      "reachability-policy-digest": `sha256:${digest}`
    },
    assumptions
  };
}

// src/providers/knip/analysis.ts
function stagedBySourceSet3(view) {
  const bySourceSet = {};
  for (const file of view.files) {
    bySourceSet[file.sourceSet] = (bySourceSet[file.sourceSet] ?? 0) + 1;
  }
  return bySourceSet;
}
function stagingDiagnostics3(view) {
  return [
    ...view.readFailures.map((failure) => ({ path: failure.path, message: failure.reason })),
    ...view.rejected.map((rejection) => ({ path: rejection.path, message: rejection.reason }))
  ];
}
function normalizedEvidence3(outcome, context) {
  if (!("report" in outcome) || outcome.report === undefined) {
    throw new Error("the outcome carries no raw report to normalize");
  }
  return normalizeKnipReport(outcome.report, context);
}
function observedCoverage2(view, analyzedFiles, diagnostics) {
  return {
    analyzedFiles: [...analyzedFiles].sort((a, b) => a < b ? -1 : a > b ? 1 : 0),
    bySourceSet: stagedBySourceSet3(view),
    diagnostics,
    unsupported: []
  };
}
function scopeSelection(context, selection) {
  const scope = new Set([...context.entryRoots, ...context.testRoots, ...context.projectFiles]);
  return selection.filter((file) => scope.has(file.path));
}
async function foldOutcome2(view, context, adapter) {
  const outcome = adapter.outcome;
  if (outcome.state !== "complete" && outcome.state !== "incomplete") {
    const reason = "instructions" in outcome && outcome.instructions !== undefined ? `${outcome.reason} — ${outcome.instructions}` : outcome.reason;
    return knipNeverRan(context, outcome.state, reason);
  }
  if (outcome.state === "incomplete") {
    const base = {
      provider: outcome.provider,
      state: "incomplete",
      analysis: outcome.analysis,
      reason: outcome.reason
    };
    const diagnostics = [...stagingDiagnostics3(view), { message: outcome.reason }];
    try {
      const normalized = normalizedEvidence3(outcome, context);
      return {
        ...base,
        observedCoverage: observedCoverage2(view, [], diagnostics),
        metrics: [...normalized.metrics],
        findings: [...normalized.findings]
      };
    } catch {
      return { ...base, observedCoverage: observedCoverage2(view, [], diagnostics) };
    }
  }
  try {
    const normalized = normalizedEvidence3(outcome, context);
    return {
      provider: outcome.provider,
      state: "complete",
      analysis: outcome.analysis,
      observedCoverage: {
        analyzedFiles: view.files.map((file) => file.path),
        bySourceSet: stagedBySourceSet3(view),
        diagnostics: [],
        unsupported: []
      },
      metrics: [...normalized.metrics],
      findings: [...normalized.findings]
    };
  } catch (error) {
    return {
      provider: outcome.provider,
      state: "incomplete",
      analysis: outcome.analysis,
      reason: `validated knip evidence failed to normalize over the staged snapshot: ${messageOf(error)}`,
      observedCoverage: {
        analyzedFiles: [],
        bySourceSet: stagedBySourceSet3(view),
        diagnostics: [{ message: messageOf(error) }],
        unsupported: []
      }
    };
  }
}
function degradedForCleanup3(result, cleanup) {
  if (cleanup.status !== "failed")
    return result;
  const note = `owned scratch cleanup failed: ${cleanup.reason}`;
  const coverage = result.observedCoverage;
  if (result.state === "complete" && coverage !== undefined) {
    return {
      ...result,
      state: "incomplete",
      reason: note,
      observedCoverage: {
        ...coverage,
        diagnostics: [...coverage.diagnostics, { message: note }]
      }
    };
  }
  return {
    ...result,
    reason: result.reason === undefined ? note : `${result.reason}; ${note}`
  };
}
async function runKnipAnalysis(root, selection, request, options = {}) {
  const policy = compileReachabilityPolicy(request);
  const context = prepareReachabilityContext(policy, selection);
  if (context.projectFiles.length === 0) {
    return knipNeverRan(context, "unsupported", "the measured selection contains no production files — reachability evidence requires " + "at least one production file to scope candidates over");
  }
  const runRequest = {
    ...options.signal === undefined ? {} : { signal: options.signal },
    ...options.resolve === undefined ? {} : { resolve: options.resolve }
  };
  const lifecycleOptions = {
    ...options.signal === undefined ? {} : { signal: options.signal },
    ...options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }
  };
  let lifecycle;
  try {
    lifecycle = await withStagedWorkspaceView({ root, files: scopeSelection(context, selection) }, async (view) => await foldOutcome2(view, context, await runKnipAdapter(view, context, runRequest)), lifecycleOptions);
  } catch (error) {
    const reason = error instanceof InvalidStagingRequestError || error instanceof StagingError ? error.message : `staging failed unexpectedly: ${messageOf(error)}`;
    return knipNeverRan(context, "unavailable", reason);
  }
  switch (lifecycle.kind) {
    case "completed":
      return degradedForCleanup3(lifecycle.value, lifecycle.cleanup);
    case "adapter-failed":
      return degradedForCleanup3(knipNeverRan(context, "unavailable", `the knip adapter failed: ${messageOf(lifecycle.error)}`), lifecycle.cleanup);
    case "cancelled":
      return degradedForCleanup3(knipNeverRan(context, "unavailable", "the audit was cancelled before the reachability analysis completed; the provider " + "process group was terminated and no evidence was produced"), lifecycle.cleanup);
    case "timeout":
      return degradedForCleanup3(knipNeverRan(context, "unavailable", "the reachability analysis exceeded its wall-time limit"), lifecycle.cleanup);
  }
}

// src/audit/providers.ts
function providerExecutionPlan(config) {
  const { providers } = config;
  const entries = [];
  if (providers.jscpd !== undefined) {
    entries.push({ providerId: "jscpd", mode: providers.jscpd.mode });
  }
  if (providers["dependency-cruiser"] !== undefined) {
    entries.push({ providerId: "dependency-cruiser", request: providers["dependency-cruiser"] });
  }
  if (providers.knip !== undefined) {
    entries.push({ providerId: "knip", request: providers.knip });
  }
  if (providers.sonarjs !== undefined) {
    entries.push({ providerId: "sonarjs" });
  }
  return entries.sort((a, b) => a.providerId < b.providerId ? -1 : a.providerId > b.providerId ? 1 : 0);
}
function measuredSelection(source) {
  const measured = new Set(MEASURED_SOURCE_SETS);
  return source.files.filter((file) => measured.has(file.sourceSet)).map((file) => ({ path: file.path, sourceSet: file.sourceSet, packagePath: file.packagePath }));
}
function undeliveredProviderEvidence(providerId) {
  const status = providerCapabilityStatus(providerId);
  if (status === undefined) {
    throw new Error(`provider "${providerId}" has no capability record — the config schema and the supported-provider table have drifted`);
  }
  const note = status.decision === undefined ? "" : ` (deferred by ${status.decision.record}, issue ${status.decision.issue}; prerequisite ${status.decision.prerequisite})`;
  return {
    provider: {
      kind: "external",
      id: providerId,
      toolVersion: "0.0.0",
      adapterVersion: "0.0.0",
      mode: "capability-request",
      options: {}
    },
    state: "unsupported",
    reason: `${status.reason}${note}`
  };
}
function deliveredProviderOptions(options) {
  return {
    ...options.signal === undefined ? {} : { signal: options.signal },
    ...options.resolve === undefined ? {} : { resolve: options.resolve }
  };
}
async function runPlannedEntry(entry, root, source, options) {
  if (entry.providerId === "jscpd") {
    return await runJscpdAnalysis(root, measuredSelection(source), entry.mode, deliveredProviderOptions(options));
  }
  if (entry.providerId === "dependency-cruiser") {
    return await runDependencyCruiserAnalysis(root, measuredSelection(source), entry.request, deliveredProviderOptions(options));
  }
  if (entry.providerId === "knip") {
    return await runKnipAnalysis(root, measuredSelection(source), entry.request, deliveredProviderOptions(options));
  }
  return undeliveredProviderEvidence(entry.providerId);
}
async function runProviderAnalyses(root, source, config, options = {}) {
  const plan = providerExecutionPlan(config);
  if (plan.length === 0)
    return [];
  const results = [];
  for (const entry of plan) {
    results.push(await runPlannedEntry(entry, root, source, options));
  }
  return results;
}

// src/audit/audit.ts
function selectedMeasuredAnalyzers() {
  return NATIVE_REGISTRY.ordered().filter((analyzer) => analyzer.metrics.length > 0);
}
function measureAnalyses(source, syntax, options = {}) {
  const emit = (event) => options.onProgress?.(event);
  const execution = selectedMeasuredAnalyzers();
  const runs = [];
  let graphRun;
  for (const [index, analyzer] of execution.entries()) {
    emit({
      type: "analyzer",
      id: analyzerProgressId(analyzer.identity.id),
      index,
      total: execution.length
    });
    switch (analyzer.identity.id) {
      case "trellis.complexity":
        runs.push(runComplexityAnalysis(syntax));
        break;
      case "trellis.duplication":
        runs.push(runDuplicationAnalysis(syntax, options.duplicationBudget === undefined ? {} : { budget: options.duplicationBudget }));
        break;
      case "trellis.dependency-graph":
        graphRun = runDependencyGraphAnalysis(source, syntax);
        runs.push(graphRun);
        break;
      case "trellis.import-cycles": {
        if (graphRun === undefined) {
          throw new Error('analyzer "trellis.import-cycles" executed before its prerequisite ' + '"trellis.dependency-graph" produced a graph');
        }
        runs.push(runImportCycleAnalysis(graphRun));
        break;
      }
      default:
        throw new Error(`measured analyzer "${analyzer.identity.id}" has no wired native run`);
    }
  }
  return runs;
}
function measuredAnalysisEvidence(runs) {
  const scored = new Set(nativeScoringRequiredIds());
  return runs.map((run) => {
    const id = run.result.provider.id;
    const analyzer = NATIVE_REGISTRY.get(id);
    if (analyzer === undefined) {
      throw new Error(`measured analysis "${id}" is not registered in the native registry`);
    }
    return {
      ...run.product,
      result: toContractResult(run.result),
      scoring: scored.has(id) ? "scored" : "advisory",
      metricIds: analyzer.metrics
    };
  });
}
async function auditWorkspace(root, options = {}) {
  const emit = (event) => options.onProgress?.(event);
  const startedAt = Date.now();
  emit({ type: "phase", phase: "configure" });
  const config = options.config ?? await loadAuditConfig(root);
  emit({ type: "phase", phase: "discover" });
  const source = await discoverSourceInventory(root, { source: config.source });
  emit({
    type: "source-discovered",
    files: source.files.length,
    packages: source.packages.length,
    excluded: source.excluded.length,
    unsupported: source.unsupported.files
  });
  emit({ type: "phase", phase: "parse" });
  const syntax = await buildSyntaxInventory(source);
  emit({
    type: "syntax-built",
    files: syntax.files.length,
    functions: syntax.functionCount,
    diagnostics: syntax.diagnostics.length
  });
  emit({ type: "phase", phase: "measure" });
  const runs = measureAnalyses(source, syntax, {
    ...options.duplicationBudget === undefined ? {} : { duplicationBudget: options.duplicationBudget },
    ...options.onProgress === undefined ? {} : { onProgress: options.onProgress }
  });
  const analyses = measuredAnalysisEvidence(runs);
  const metrics = collectMetrics(analyses);
  emit({
    type: "measured",
    metrics: metrics.length,
    findings: analyses.reduce((sum, analysis) => sum + analysis.findings.length, 0)
  });
  const providers = await runProviderAnalyses(root, source, config, {
    ...options.signal === undefined ? {} : { signal: options.signal }
  });
  emit({ type: "phase", phase: "safeguards" });
  const { product: safeguards } = await runSafeguardInspection(source.root);
  emit({
    type: "safeguards-inspected",
    results: safeguards.results.length,
    findings: safeguards.findings.length
  });
  emit({ type: "phase", phase: "score" });
  const scoring = scoreSloppiness(metrics);
  emit({ type: "scored", index: scoring.index, partial: scoring.partial });
  emit({ type: "phase", phase: "assemble" });
  const measurements = {
    source,
    syntax,
    analyses,
    ...providers.length === 0 ? {} : { providers },
    safeguards
  };
  return assembleReport(measurements, scoring, {
    auditedAt: (options.now ?? new Date).toISOString(),
    durationMs: Date.now() - startedAt
  });
}
export {
  auditWorkspace,
  measureAnalyses,
  measuredAnalysisEvidence,
  selectedMeasuredAnalyzers
};
