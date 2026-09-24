/**
 * The style rules no built-in ESLint rule checks, from `agents/code-style.md`.
 *
 * Kept in this repository so the gate needs no extra dependency.
 */

/** Words that say where a thing is by metaphor. Code style: "Literal verbs". */
const FIGURATIVE_WORDS = /\b(lives|living|sits|sitting)\b/i

/** Whether the comment directly above a node is a JSDoc block. */
function hasContractAbove(sourceCode, node) {
  const comment = sourceCode.getCommentsBefore(node).at(-1)
  if (!comment || comment.type !== 'Block' || !comment.value.startsWith('*')) return false
  return comment.loc.end.line >= node.loc.start.line - 1
}

/** Every export carries a JSDoc contract directly above it. */
const exportContract = {
  meta: { type: 'suggestion', messages: { missing: 'An export needs a /** */ contract directly above it.' } },
  create(context) {
    const report = node => {
      if (!node.declaration) return
      if (!hasContractAbove(context.sourceCode, node)) context.report({ node, messageId: 'missing' })
    }
    return { ExportNamedDeclaration: report, ExportDefaultDeclaration: report }
  }
}

/** Comments use literal verbs: a file is in a directory. */
const literalComment = {
  meta: { type: 'suggestion', messages: { figurative: 'Use a literal verb, not "{{word}}".' } },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          const match = comment.value.match(FIGURATIVE_WORDS)
          if (!match) continue
          // eslint-disable-next-line id-denylist -- ESLint's report API names this field data
          context.report({ loc: comment.loc, messageId: 'figurative', data: { word: match[1] } })
        }
      }
    }
  }
}

/** The rules as an ESLint plugin, named `style` in `eslint.config.mjs`. */
export default {
  rules: { 'export-contract': exportContract, 'literal-comment': literalComment }
}
