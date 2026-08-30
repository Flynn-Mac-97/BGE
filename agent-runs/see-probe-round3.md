# See probe round 3 — probes phrased as a person, and the numbers

Written 2026-08-30. Rounds 1 and 2 asked engine-shaped questions with tidy
answers. A person does not ask those. They react to something on screen, name
nothing the engine knows, and are sometimes wrong about what they saw.

Every probe is a sentence a player would type. One where the player is right,
one where the player is wrong, and one with no noun in it at all.

Same fixture as round 2, headless, identical for every agent:

```sh
node bin/engine.mjs script '[["play"],["simulate",30],["run","see.describe"]]' \
  --headless --project kitten-survivors --level meadow
```

## Result

| Probe | Arm | Verdict | Calls | Tokens |
|---|---|---|---|---|
| something looks off, I can't work out what | See | wrong lead, gap named second | 1 | 29.6k |
| something looks off, I can't work out what | control | correct, with root cause | 14 | 69.2k |
| the grass looks like it's up in the air? | See | correct | 1 | 29.5k |
| the grass looks like it's up in the air? | control | wrong — argued the bug was intended | 4 | 40.5k |
| the rats are sinking in, aren't they | See | correct, contradicted the player | 1 | 29.5k |
| the rats are sinking in, aren't they | control | wrong — invented a bug to agree | 30 | 52.8k |

See: 2 right, 1 partial, 3 calls. Control: 1 right, 2 confidently wrong, 48
calls.

## Across all three rounds

Eight probes each, cheapest tier, answer keys measured first.

|  | See | control |
|---|---|---|
| Right | 5 | 2 |
| Confidently wrong | 2 | 5 |
| Said it could not tell | 0 | 1 |
| Tool calls | 11 | 126 |
| Tokens above the 20.4k floor | 92.5k | 246.8k |

See answers more than twice as many correctly, for 37% of the tokens and a
twelfth of the calls. That is the number this plugin did not have.

## The two failures that matter

Both control failures came from reading code and trusting it.

Asked about the grass, the control found the meadow tool placing the floor at
y = -0.5, quoted `ground.js` — "THE TOP OF THIS SLAB IS y = 0" — and told the
player *"this is the intended design, not a bug"*. The level on disk places the
floor at y = -6.5. The code documents a rule the level breaks, and the agent
read the rule and assumed it was kept.

Asked whether the rats were sinking, when they are not, the control reasoned
from the same code — "which the code structure suggests" — confirmed the false
claim, and specified a fix for a bug that does not exist. Thirty tool calls.

The See arm answered both in one call by measuring the world that was running.

The control was right once, on the probe with no noun in it, and it got there
by comparing the level file against a documented invariant. That is backlog
item 2: the invariant is written for a person, so finding the break costs
fourteen tool calls. `check` enforcing it would cost none.

## What changed between rounds

Round 2's See arm had `verticalSpan` and still answered wrong: handed six
ranges it picked a gem sitting 0.3 above the floor over scenery sitting 5
metres above it. Publishing the numbers is not answering.

`heightGaps` names the empty band and the type above it, and round 3's See arm
answered the same question correctly on its first call.

The vague probe shows the remaining gap. The band was in the reply and the
agent mentioned it second, behind a finding it invented. A reader weighs a
field by what it says about itself, so each band now carries a sentence saying
what it means and to check it first.
