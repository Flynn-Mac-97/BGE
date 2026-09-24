// src/config/load.ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import yaml from "js-yaml";

// src/contract/analysis.ts
import { z as z4 } from "zod";

// src/contract/coverage.ts
import { z } from "zod";
var SOURCE_SETS = [
  "production",
  "test",
  "generated",
  "vendored",
  "declaration-only"
];
var COVERAGE_SCOPES = [...SOURCE_SETS, "excluded", "unsupported"];
var sourceCoverageEntrySchema = z.strictObject({
  files: z.number().int().nonnegative(),
  sloc: z.number().int().nonnegative().optional(),
  note: z.string().min(1).optional()
});
var sourceCoverageSchema = z.strictObject({
  production: sourceCoverageEntrySchema,
  test: sourceCoverageEntrySchema,
  generated: sourceCoverageEntrySchema.optional(),
  vendored: sourceCoverageEntrySchema.optional(),
  "declaration-only": sourceCoverageEntrySchema.optional(),
  excluded: sourceCoverageEntrySchema.optional(),
  unsupported: sourceCoverageEntrySchema.optional()
});

// src/contract/primitives.ts
import { z as z2 } from "zod";
var dottedIdSchema = z2.string().regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/, "must be a dotted identifier (lowercase segments joined by '.')");
function isRepoRelativePath(path) {
  if (path.length === 0 || path.startsWith("/") || path.includes("\\"))
    return false;
  if (/^[A-Za-z]:/.test(path))
    return false;
  return path.split("/").every((segment) => segment.length > 0 && segment !== "..");
}
var relativePathSchema = z2.string().min(1).refine(isRepoRelativePath, "must be a repo-relative POSIX path");
var versionStringSchema = z2.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/, "must be a semantic version (X.Y.Z with optional prerelease suffix)");
var finiteNumberSchema = z2.number().finite();

// src/contract/provider.ts
import { z as z3 } from "zod";
var PROVIDER_STATES = [
  "unrequested",
  "unavailable",
  "unsupported",
  "incomplete",
  "complete"
];
var providerStateSchema = z3.enum(PROVIDER_STATES);
var PRODUCER_KINDS = ["native", "external"];
var producerKindSchema = z3.enum(PRODUCER_KINDS);
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
var optionKeySchema = z3.string().regex(/^[a-z][a-z0-9-]*$/, "must be a kebab-case identifier").refine((key) => !RESERVED_EXECUTION_OPTION_KEYS.has(key), {
  message: "machine paths, timestamps and durations are execution metadata, never analysis identity"
});
var optionValueSchema = z3.union([z3.string().min(1), finiteNumberSchema, z3.boolean()]);
var providerOptionsSchema = z3.record(optionKeySchema, optionValueSchema);
var providerIdentitySchema = z3.strictObject({
  kind: producerKindSchema,
  id: providerIdSchema,
  toolVersion: versionStringSchema,
  adapterVersion: versionStringSchema,
  mode: z3.string().min(1),
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
var providerCapabilitySchema = z3.strictObject({
  providerId: providerIdSchema,
  capabilityId: dottedIdSchema
});
var capabilityDeclarationsSchema = z3.array(providerCapabilitySchema).superRefine((declarations, ctx) => {
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
var contentFingerprintSchema = z4.string().regex(/^[0-9a-f]{64}$/, "must be a lowercase sha-256 hex digest");
var snapshotFileSchema = z4.strictObject({
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
var sourceSelectionSchema = z4.strictObject({
  sourceSets: z4.array(z4.enum(SOURCE_SETS)).min(1),
  files: z4.array(snapshotFileSchema)
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
var parserIdentitySchema = z4.strictObject({
  engine: dottedIdSchema,
  version: versionStringSchema
});
var analysisIdentitySchema = z4.strictObject({
  selection: sourceSelectionSchema,
  parser: parserIdentitySchema,
  options: providerOptionsSchema
});
var executionMetadataSchema = z4.strictObject({
  startedAt: z4.iso.datetime().optional(),
  durationMs: finiteNumberSchema.nonnegative().optional(),
  machinePath: z4.string().min(1).optional(),
  exitCode: z4.number().int().optional()
});
var analysisDiagnosticSchema = z4.strictObject({
  path: relativePathSchema.optional(),
  message: z4.string().min(1)
});
var unsupportedContextSchema = z4.strictObject({
  path: relativePathSchema,
  reason: z4.string().min(1)
});
var observedCoverageSchema = z4.strictObject({
  analyzedFiles: z4.array(relativePathSchema),
  analyzedLines: finiteNumberSchema.int().nonnegative().optional(),
  bySourceSet: z4.partialRecord(z4.enum(SOURCE_SETS), finiteNumberSchema.int().nonnegative()).optional(),
  diagnostics: z4.array(analysisDiagnosticSchema),
  unsupported: z4.array(unsupportedContextSchema)
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

// src/contract/clone-evidence.ts
import { z as z6 } from "zod";

// src/contract/finding.ts
import { z as z5 } from "zod";
var positionSchema = z5.strictObject({
  line: z5.number().int().min(1),
  column: z5.number().int().min(1).optional()
});
var rangeSchema = z5.strictObject({
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
var findingSchema = z5.strictObject({
  kind: dottedIdSchema,
  path: relativePathSchema,
  range: rangeSchema,
  summary: z5.string().min(1),
  facts: z5.record(z5.string(), z5.unknown()).optional()
});

// src/contract/clone-evidence.ts
var CLONE_MATCH_MODES = ["exact", "normalized", "near"];
var cloneMatchModeSchema = z6.enum(CLONE_MATCH_MODES);
var cloneLocationSchema = z6.strictObject({
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
var clonePairSchema = z6.strictObject({
  kind: z6.literal("pair"),
  matchMode: cloneMatchModeSchema,
  members: z6.tuple([cloneLocationSchema, cloneLocationSchema])
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
var cloneGroupEvidenceSchema = z6.strictObject({
  kind: z6.literal("group"),
  matchMode: groupMatchModeSchema,
  members: z6.array(cloneLocationSchema).min(2)
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
var cloneEvidenceSchema = z6.discriminatedUnion("kind", [
  clonePairSchema,
  cloneGroupEvidenceSchema
]);

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

// src/contract/version.ts
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
// src/config/load.ts
var CONFIG_FILENAMES = ["trellis.yaml", "trellis.yml"];
function parseConfig(text, name) {
  const data = yaml.load(text) ?? {};
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
      text = await readFile(join(root, name), "utf8");
    } catch {
      continue;
    }
    return parseConfig(text, name);
  }
  return auditConfigSchema.parse({});
}
async function loadAuditConfigFile(path) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (cause) {
    throw new Error(`cannot read config file ${path} (${cause instanceof Error ? cause.message : String(cause)})`);
  }
  return parseConfig(text, path);
}
export {
  CONFIG_FILENAMES,
  loadAuditConfig,
  loadAuditConfigFile
};
