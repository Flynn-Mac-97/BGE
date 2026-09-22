/**
 * Turning Jev's typed answers into a ranked suggestion.
 *
 * Pure: no network, no files. One request carries one choice question per
 * candidate, keyed by the candidate id; this module builds those questions and
 * reads the answers back. Confidence is a threshold the caller sets from local
 * labels, never a universal cutoff, and an answer below it is dropped rather
 * than guessed.
 */

/** The guide answers. `possible` is kept apart so a weak match is not read as a need. */
export const GUIDE_LABELS = ['required', 'possible', 'irrelevant']
/** The guide answer that means the guide is not wanted. */
export const GUIDE_NEGATIVE = ['irrelevant']

/** The record answers. This judges relatedness, never whether work is finished. */
export const RECORD_LABELS = ['same', 'related', 'unrelated']
/** The record answer that means the two are not about the same problem. */
export const RECORD_NEGATIVE = ['unrelated']

/** One choice question. Instructions must be self-contained; the key is bookkeeping and is not sent. */
export const choiceQuestion = (instructions, criteria) => ({ type: 'choice', instructions, criteria })

/** One question per guide, from the guide's own description and the task in the state. */
export function guideQuestions(candidates) {
  const questions = {}
  for (const candidate of candidates) {
    questions[candidate.id] = choiceQuestion(
      `The state holds a coding task in \`task\`. Is this guide relevant to that task?\n` +
      `Guide "${candidate.title}": ${candidate.description}`,
      {
        required: 'The task must follow this guide to be done right.',
        possible: 'The guide may help when the task turns out to touch its subject.',
        irrelevant: 'The guide has nothing to do with the task.'
      })
  }
  return questions
}

/** One question per existing record, from its own text and the new finding in the state. */
export function recordQuestions(candidates) {
  const questions = {}
  for (const candidate of candidates) {
    questions[candidate.id] = choiceQuestion(
      `The state holds a new engine finding in \`finding\`. Does this existing record describe the same problem?\n` +
      `Existing record: ${candidate.text}`,
      {
        same: 'The two records describe the same problem.',
        related: 'The two are related but describe different problems.',
        unrelated: 'The two have nothing to do with each other.'
      })
  }
  return questions
}

/**
 * The positive answers worth showing, strongest first.
 *
 * Rank by `relevance`, the probability mass against the negative label, not by
 * the scalar confidence. Confidence measures how concentrated the whole
 * distribution is, so a clear `required` split against a `possible` scores low
 * while a near-tie between two positives scores high — the opposite of what a
 * suggestion wants. A negative choice is never a hit, and one under the floor is
 * dropped with its reason, so the reply shows what was withheld and why.
 *
 * An answer whose probabilities are missing or not finite is dropped, never
 * shown as a good one: a malformed reply is a fault to report, not a hit.
 */
export function rankAnswers(answers, candidates, { labels, negative, minimum = 0.5, limit = 5 } = {}) {
  const ranked = []
  const dropped = []
  for (const candidate of candidates) {
    const answer = answers?.[candidate.id]
    if (!answer || !labels.includes(answer.choice)) { dropped.push({ id: candidate.id, why: 'no usable answer' }); continue }
    if (negative.includes(answer.choice)) continue
    const relevance = relevanceOf(answer, negative)
    if (relevance === null) { dropped.push({ id: candidate.id, why: 'unusable probabilities' }); continue }
    if (relevance < minimum) { dropped.push({ id: candidate.id, why: `relevance ${relevance.toFixed(2)} under ${minimum}` }); continue }
    ranked.push({
      id: candidate.id,
      title: candidate.title || candidate.id,
      ...(candidate.file ? { file: candidate.file } : {}),
      choice: answer.choice,
      confidence: Number.isFinite(answer.confidence) ? answer.confidence : null,
      relevance,
      probabilities: answer.probabilities || null
    })
  }
  ranked.sort((a, b) => b.relevance - a.relevance)
  return { ranked: ranked.slice(0, limit), dropped }
}

/**
 * The probability mass against the negative label, or null when the answer
 * cannot supply a finite number.
 *
 * A choice answer may carry `probabilities` or only `confidence`. The chosen
 * label must carry a finite probability, and every negative label must be
 * finite, or the answer is unusable. A confidence fallback must itself be
 * finite.
 */
function relevanceOf(answer, negative) {
  const probabilities = answer.probabilities
  if (probabilities && typeof probabilities === 'object') {
    if (!Number.isFinite(Number(probabilities[answer.choice]))) return null
    let against = 0
    for (const label of negative) {
      const value = Number(probabilities[label] ?? 0)
      if (!Number.isFinite(value)) return null
      against += value
    }
    return Math.max(0, Math.min(1, 1 - against))
  }
  if (Number.isFinite(answer.confidence)) return Math.max(0, Math.min(1, answer.confidence))
  return null
}

/** The strongest suggestions as one short line each, or null when there are none. */
export function suggestionLines(ranked, { limit = 3 } = {}) {
  if (!ranked.length) return null
  return ranked.slice(0, limit)
    .map(hit => `- ${hit.title} (${hit.choice}, ${hit.relevance.toFixed(2)})${hit.file ? ` — ${hit.file}` : ''}`)
    .join('\n')
}
