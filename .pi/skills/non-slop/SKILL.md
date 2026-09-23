---
name: non-slop
description: Write and review code for clarity using this repo's requirements-first style. Use when implementing a change, reviewing or giving feedback on a snippet, or cleaning up a Trellis-flagged hotspot.
---

# Non-slop

The rules that keep this codebase clear. `AGENTS.md` has the short form; this is the
long form with rationale, examples, and a review procedure.

## The paradigm

```
requirements  →  code  →  quick check
      ↑                        │
      └──────── signal ────────┘
```

The check never leads. A metric is a prompt to look, not a definition of done. The only
thing that defines done is a requirement plus its acceptance check.

## The loop

Run this for each unit of change — not once per session.

| Step | Produce | Fails when |
| --- | --- | --- |
| **Intent** | One testable sentence + acceptance check | You can't state what must be true |
| **Seam** | Where the change lands; what stays untouched | The answer is "the central function" |
| **Unit** | Smallest change that satisfies the intent | One function does several jobs |
| **Proof** | `npm run check` green, intent demonstrably holds | Your only evidence is a metric |
| **Record** | One line: what changed, which intent, what you skipped | Nobody can tell why the diff exists |

## The laws

**L1 — Requirements before code.** A diff with no stated intent is unreviewable. Write
the sentence first. If you can't, you have a research task, not an implementation task.

**L2 — The check follows the requirement.** Goodhart's law: once a metric is the target,
it stops measuring. Use lint/Trellis to find candidates, then judge them against a
requirement. A hotspot that maps to no requirement is recorded, not refactored.

**L3 — One reason to change per unit.** Decompose by responsibility. A 10-line function
that conflates parsing and IO is worse than a 40-line function with one job. Line counts
and complexity are *signals* of mixed responsibility, not the disease.

**L4 — Extend by addition.** When a new case arrives, the right change is a new unit or a
new table entry. If you're adding an arm to a switch, ask what the switch should become.

**L5 — No speculative abstraction.** Two similar lines are fine. Abstract on the second
*real* use, with both call sites in hand. "We might need it later" is how frameworks and
sadness are born.

**L6 — Contracts are explicit.** Write down input/output shapes. Views consume the
contract; they never invent fields or silently coerce. Change a contract deliberately and
update every consumer.

**L7 — Style is mechanical.** Prettier and ESLint run in the loop. If a style point
matters, encode it as a rule; if it can't be encoded, it probably doesn't matter.

**L8 — Comments carry intent.** A comment must say what the code cannot. The test is not
"is it true?" but "could the reader infer this from the code?" If yes, delete it. Prefer
a better name over a comment, a contract over prose, *why* over *what*. A stale comment
is worse than no comment: a reader trusts prose, so a wrong comment misleads more
reliably than silence.

## The style

**Small named units, explicit data, data-driven branching, flat flow.**

### Reuse

A block of lines that already exists elsewhere is a defect, not a shortcut: the copies
drift, and every fix has to be made in more than one place.

- **Search before you write.** Before adding a helper, fixture, or utility, look for one
  that already does it (grep the obvious names; check the sibling test files).
- **Extract on the second real use** (this is L5 pointed at duplication). When a second
  caller needs the same thing, move it to a shared home — never clone it.
- **Fix bad exemplars; don't inherit them.** "Match existing style" (L10) means match the
  *conventions*, not the mistakes. If the surrounding code already duplicates, break the
  pattern by extracting the shared unit.
- **Tests count.** Temp-workspace builders, fixtures, and shared assertions belong in one
  test helper module, not re-declared per test file.

### Naming

Comments are reserved for *why*, so names carry the *what*. A name must survive
leaving its file — a grep result, an import list, a schema, a stack trace.

- **Name for the file list, not the line.** `snapshot` → `characterSnapshot`;
  `simulate` → `simulateCharacter`; `depth` → `nestingDepth`.
- **Qualify generic nouns with their domain.** A name shouldn't need its module to
  make sense. If two modules could each define it meaning different things, it's
  too generic.
- **Prefer a specific domain word over a placeholder:** `data`, `info`, `item`,
  `value`, `state`, `config`, `result`, `handle`, `process`, `manager`, `helper`,
  `utils`. In a large codebase these collide and say nothing.
- **Name the outcome, not the mechanism.** `runCharacterSimulation`, not
  `simulate`; `applyGravityToVelocity`, not `integrate`.
- **Match name length to scope.** A loop index may be `i`; an exported function,
  field, or cross-module concept may not. Short is fine only when the scope is
  small and the meaning is local.
- **One term per concept, everywhere** (L6). Synonyms are a hidden coupling.

Test: read the name with no surrounding code. If you can't tell what it is or which
domain it belongs to, it's too generic.

### Functions

- **Name the outcome.** `extractImports(node)`, `resolveImport(from, source)`,
  `qualified(symbol)`. The reader should know what comes back without reading the body.
- **One level of abstraction.** A function orchestrates *or* computes. If it parses,
  validates, and formats, it's three functions.
- **Flatten with guards.** Handle the edge, return, move on. Deep nesting hides the happy
  path.

```js
// slop: the happy path is buried
function label(symbol) {
  if (symbol) {
    if (symbol.parent) {
      return `${symbol.parent}.${symbol.name}`;
    } else {
      return symbol.name;
    }
  }
  return '';
}

// clear: guards, then straight through
function label(symbol) {
  if (!symbol) return '';
  return symbol.parent ? `${symbol.parent}.${symbol.name}` : symbol.name;
}
```

- **No boolean flags.** A flag means two behaviors wearing one name.

```js
render(codemap, true);                    // what is true?
renderTree(codemap); renderMarkdown(codemap); // named, obvious
```

- **Return one shape.** Don't return `null` in one path and `[]` in another. Pick one
  empty value and document it.

### Data

- **One constructor per record shape.** Never repeat an object literal; when the shape
  changes, you'd have to find every copy.

```js
// slop: same shape, five copies, drifting
addSymbol({ name, kind: 'function', parent, params }, node, depth);

// clear: a factory; callers supply only what varies
symbol('function', node, { name, parent, depth, params });
```

- **Compute fields before you build.** Build a record complete; don't push it and patch it
  later.

```js
// slop: action at a distance
const first = exports.length;
// ...push several...
for (let i = first; i < exports.length; i++) exports[i].from = from;

// clear: pass `from` into the builder
```

- **Name domain terms once.** One word per concept, used everywhere (`symbol`, `kind`,
  `depth`). Synonyms are a hidden coupling.
- **Prefer a discriminated `kind`** over parallel booleans that can contradict each other.

### Branching

- **Replace ladders with tables.** A switch that grows with every new case is a registry
  waiting to happen.

```js
// slop: grows by editing this function forever
if (node.type === 'identifier') push(node.text);
else if (node.type === 'namespace_import') push(asNamespace(node));
else if (node.type === 'named_imports') { /* ... */ }

// clear: data-driven; a new case is a new entry
const NAMES_BY_TYPE = {
  identifier: (n) => [n.text],
  namespace_import: (n) => [`* as ${n.namedChildren.at(-1)?.text ?? ''}`],
  named_imports: (n) => n.namedChildren.filter(isSpecifier).map(specifierName),
};
```

### Architecture

Goal: a system you can hold in your head — pure transformations and one-way flow.

- **Data first.** Domain concepts are plain records; behavior is functions over them.
  Prefer `data → data` over objects that mutate themselves.
- **Effects at the edges.** `parse → extract → format` are pure; I/O, clock, and
  randomness live in the shell.
- **Classes only for state with an invariant**, and compose — never inherit. A
  stateless `Manager`/`Service`/`Helper` class is a function wearing a costume.
- **No object webs.** Depend one way, pass records not references. No observers, no
  bidirectional links, no inheritance chains. If two things must connect, connect
  their data and let a pure function join them.
- **The data shape is the interface** (L6); with no classes, the record is the contract.
- **Delete.** Unused params, dead options, and "just in case" branches are slop.

Test: describe the component as `input → transformations → output` and draw its
connections from the imports alone. If you can't, the structure is too implicit.

```js
// web: behavior and links hidden across objects you must trace
class Parser { parse() {} }
class Graph { addDependency() {} }
class Reporter { render(graph) {} }

// clear: the flow is the function signatures
const fileMap = extractFile(source); // data
const graph = buildGraph(fileMaps); // data -> data
const report = renderReport(graph); // data -> string
```

### Simplicity and surgical changes

Over-engineering is the default failure mode; fight it deliberately. See
`.pi/skills/karpathy-guidelines` for the full set.

- **Minimum code.** No feature that wasn't asked for, no abstraction with a single
  caller, no configurability nobody requested, no handling of impossible cases.
- **Size test.** If 200 lines could be 50, rewrite it. Would a senior engineer call
  this overcomplicated?
- **Surgical diffs.** Every changed line traces to the request. Don't tidy adjacent
  code or formatting; match the existing style; remove only the orphans your change
  created.

### Comments

Names carry the *what*; comments carry the *why*. The target is not fewer comments — it
is *only* load-bearing ones, and at least one wherever a non-obvious decision was made.

**Absence is a defect.** A module with zero comments usually means its quirks, edge
cases, and tradeoffs went unrecorded. Ask: what would a reader have to reverse-engineer?

- **Load-bearing:** *why* (constraints, non-goals, deliberate tradeoffs), contracts and
  invariants (shapes, units, ranges), gotchas/provenance ("must match grammar X", "do not
  reorder"), and honest status ("partial: JSX unsupported").
- **Noise:** restating the code, section banners over obvious lines, a doc line that just
  renames the function.
- **Harmful:** stale comments — a wrong claim misleads more reliably than silence.

**Forms — one per role, used consistently:**
- `/** ... */` JSDoc on the module and on every exported declaration: the contract.
- `//` for internal helpers and inline rationale inside a body: the why.

Never `//` where a declaration contract belongs, or JSDoc on a line of logic. Every
declaration gets a form; "no comment" is only for the self-evident.

## Smell → fix

| Smell | Fix |
| --- | --- |
| Growing `switch`/`if` ladder | lookup table / handler map |
| Boolean flag argument | two named functions |
| `if/else` pyramid | guards + extracted helpers |
| Repeated object literal | factory/constructor |
| Back-patching after push | pass fields into the builder |
| Two renderers re-looping the same data | one shared iterator |
| "Does IO and dispatch" | shell + command table |
| Function names say `handle`, `process`, `do` | name the result |
| Unused param/option | delete |
| Comment restating the line | delete or rename |

## How to review a snippet

Use this when giving or receiving feedback (including the live-example sessions).

1. **Intent** — can you say what it's for and how you'd know it works? If not, stop and
   ask; style is secondary to a missing intent.
2. **Names** — do they survive leaving the file? outcome-oriented? one term per concept? booleans read as predicates? any generic placeholders (`data`, `info`, `state`)?
3. **Units** — one job each? one abstraction level? treat nesting/length as signals.
4. **Data** — repeated literals? back-patching? mixed empty shapes? `kind` vs booleans?
5. **Branching** — ladders/switches that want to be tables? guards or pyramids?
6. **Effects** — pure logic mixed with IO/clock/randomness?
7. **Comments** — why, not what?
8. **Simplicity** — anything speculative, single-use, or handling an impossible case?
9. **Surgical** — does every changed line trace to the request, and was any unrelated
   code touched?
10. **Architecture** — is behavior hidden on objects, or are connections implicit?
    Could it be records + pure functions with one-way flow?

Report findings as **smell → why it hurts → smallest fix**, and separate **must-fix**
(violates a law or a requirement) from **taste**. Always tie a must-fix to a law or
requirement ID — otherwise it's taste, and say so.

## Checklist before proposing a diff

- [ ] I can name the intent and its acceptance check.
- [ ] I chose the seam before editing.
- [ ] New behavior is a new unit or table entry, not a new branch in a hub.
- [ ] No repeated record literals; no back-patching.
- [ ] Pure logic separated from effects.
- [ ] `npm run check` is green.
- [ ] The record line says what I changed and what I didn't.

## Worked example

Intent: *add namespace imports to the import extractor, and know it via a test.*

- **Seam:** the import specifier logic — not `visit()`. Add one table entry plus one test.
- **Unit:** add one `namespace_import` entry to the specifier table.
- **Proof:** a test asserting `import * as ns from './x'` yields `['* as ns']`; `npm run check`.
- **Record:** "Namespace imports via a new specifier-table entry; no dispatcher changes."

Notice the diff adds a unit and a table entry — it does not grow `visit`. That is L4 in
practice.
