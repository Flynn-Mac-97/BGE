/**
 * Advice on a Kimodo prompt before it is generated: NVIDIA's own best
 * practices (research.nvidia.com/labs/sil/projects/kimodo/docs/key_concepts/
 * limitations.html), plus one this project measured. Kimodo was trained on
 * mid-detail prompts that start "A person", one or two behaviours each, at
 * most ten seconds; a prompt far from that makes blurrier motion.
 *
 * Advice, not a refusal: a take is cheap to try, and a rule of thumb can be
 * wrong for one move. Each line says what to change.
 */

/** Body parts a prompt names when it steers limbs one by one. */
const BODY_PARTS =
  /\b(arms?|hands?|elbows?|wrists?|fingers?|shoulders?|legs?|knees?|foot|feet|toes?|hips?|chin|palms?|blade|torso|spine)\b/g

/** The longest one prompt should run, in seconds. */
const LONGEST_SECONDS = 10

/** More words than this is past the mid detail Kimodo was trained on. */
const MOST_WORDS = 25

/** Each rule: whether a prompt breaks it, and what to say. */
const RULES = [
  {
    // One word of manner may come first: "a tired person" is a training prompt's style too.
    breaks: ({ text }) => !/^an? (\w+ )?person\b/.test(text),
    advice: 'start with "A person …": it names the subject the way the training prompts did'
  },
  {
    breaks: ({ text }) => (text.match(/\b(and|then|while)\b/g) ?? []).length >= 2,
    advice: 'several actions joined in one prompt: keep one or two, and chain the rest as separate prompts'
  },
  {
    breaks: ({ text }) => (text.match(BODY_PARTS) ?? []).length >= 2,
    advice:
      'it steers body parts one by one: describe the action and its manner ("slashes hard", "tired"), and hold a hand or foot with a constraint instead'
  },
  {
    breaks: ({ text }) => /\bcarr(y|ies|ying)\b/.test(text),
    advice: 'say "wearing" for a load: "carrying" gives the hands a box to hold'
  },
  {
    breaks: ({ words }) => words > MOST_WORDS,
    advice: `over ${MOST_WORDS} words: Kimodo was trained on mid-detail prompts, so cut to the action and its manner`
  },
  {
    breaks: ({ seconds }) => seconds > LONGEST_SECONDS,
    advice: `over ${LONGEST_SECONDS} seconds: one prompt holds at most ${LONGEST_SECONDS}; split the move into prompts`
  }
]

/**
 * The advice for one prompt at a length in seconds: a list of lines, empty
 * when the prompt follows every rule.
 */
export function promptAdvice(prompt, seconds = 0) {
  const text = String(prompt).trim().toLowerCase()
  const measured = { text, words: text.split(/\s+/).filter(Boolean).length, seconds }
  return RULES.filter(rule => rule.breaks(measured)).map(rule => rule.advice)
}
