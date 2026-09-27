# Writing a prompt

NVIDIA's best practices for Kimodo, and what this project measured.
`make-rig-clip` prints `[prompt]` lines before it generates when a prompt
breaks one (`tools/lib/prompt-advice.mjs`); reword and run again before the
minutes of generation are spent.

- **Start with "A person …".** One word of manner may come first: "a tired
  person". It names the subject the way the training prompts did.
- **One or two actions.** "A person draws a sword" is one take. "Draws, raises
  it and stands ready" is three: make the rest separate takes, or chain them
  as separate prompts.
- **Mid detail.** The action and its manner: "slashes hard", "walks tired",
  "stealthy", "drunk", "old", "angry". Not limb by limb ("arms bent and
  pumping", "blade pointing up"): hold a hand or foot with a constraint
  instead (`making-a-clip.md`).
- **Say "wearing" for a load.** "Carrying" gives the hands a box to hold.
- **At most 10 seconds a prompt** (300 frames at 30 fps).
- **What it knows:** locomotion, gestures, everyday actions, common object
  use, videogame combat, dancing, and moods and styles. Sport-specific moves
  come out poorly.

## Constraints with a prompt

- Never let a constraint fight the words: a hand held low while the prompt
  says "raises the sword" makes artefacts, or the constraint is ignored.
- Fewer than 20 constrained frames of each kind; a ground path may be dense.
- Keys are exact only at their frames.

## What upstream Kimodo does that this checkout does not use yet

- Full-body key poses from any pose, not only a stored take's frame.
- A hand's or foot's turn as well as its place (wrist on a grip).
- Several prompts in a row, each carrying on from where the last ended
  (kimodo.cpp has these multi-prompt transitions). Give each prompt enough
  frames for its join.
- A weight between the text and the constraints when they pull apart.

Sources: research.nvidia.com/labs/sil/projects/kimodo/docs/key_concepts/limitations.html
and …/constraints.html.
