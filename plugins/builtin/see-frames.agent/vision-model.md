# Reading a frame with a vision model

Never phrase a question to a vision model as a negative — "which of these
is NOT a rat", "is anything missing". Models answer negation at chance and
say yes to almost any "is there an X" question. Ask the positive form and
compare it against the sidecar; absence is a query, not a look.

- Send the PNG and its `.json` sidecar together. The sidecar is ground truth
  for the fields it lists and silent on everything else. Where the sidecar
  and the picture disagree about something the sidecar measures, the sidecar
  wins; where they disagree about anything else, say so rather than resolving
  it. The sidecar carries measurements and never a verdict — a model will
  adopt a judgement it is handed instead of forming one.
- Refer to entities by hull colour and mark number together — `palette` maps
  colour to type, `marks` maps mark numbers to ids, and each marked entry's
  `at` names where it sits. This is a house convention that works, not a law
  of vision models: cross-check the colour against the number and the number
  against `at`. Never bind by floating text; the game draws its own numbers.
- One question per read, multiple-choice where possible. "Does the white
  outlined thing read as a rat or a box, A or B" beats "describe the scene".
  Ask for the choice and one short sentence of reason — and treat the reason
  as a hint, never a fact. A model's verdict is far better than its account
  of where the problem is, and any "where" claim has to be checked against
  `see.describe` before it is acted on.
- Comparing two frames is a forced choice, never a score out of ten. Ask
  which is better, then ask again with the two swapped; a flip means no
  difference. If a scale is needed at all, use words — excellent, good, fair,
  poor, bad.
- A subject under ~5% of the frame: capture it with `subject`. Below that
  size, answers fall away sharply, and cropping to the subject wins back most
  of what was lost.

### When a small or cheap model is doing the looking

It will not degrade gently. On this exact task — judging one rendered game
frame — the small tier of a model family scores near chance where the large
tier is reliable, and its failure is a stuck answer rather than a wrong one.
A question whose answer is stuck returns no information at all.

- Spend the image on ONE subject, framed alone. A crowded frame is where the
  cheap tier collapses.
- Give it a forced binary choice. Never open description, never "find
  anything wrong" — it will say everything is fine, every time.
- Do not rely on it reading marks. Put the identifying fact in the question
  and in the crop, not in the overlay.
- Ask twice with the options swapped, and treat disagreement as no answer.
- Never route counting, depth or distance to it. For a small model the query
  path is not the cheaper path, it is the only correct one.
