# What vision models can and cannot do, and what See should send them

A research brief for the See plugin. Written 2026-08-30. Every claim below is
either cited or explicitly labelled as a guess.

The plugin's shipped instruction sheet is `plugins/builtin/see.agent.md`. This
brief tests its assumptions against published benchmarks and papers.

---

## Summary — the findings that would change how See works

1. **The founding rule is right, and the evidence is stronger than the sheet
   claims.** On overlapping shapes the best models score 20–44% where a human
   scores 100%; on relative depth the best is 58.9% against a 50% coin-flip; on
   object localisation every frontier model tested sat *at or below chance*.
   "Query first, pixels last" is not a cost optimisation, it is a correctness
   requirement.

2. **Marks drawn on a frame inflate an aesthetic score by up to 109%.** This is
   the single most important finding for See. Drawn bounding boxes are a
   documented, reproducible bias in vision-model judging: they make the judge
   score the image *higher*, the bias survives pairwise comparison, and it
   survives being told about it in the prompt. See currently draws hulls on the
   same `see.capture` frame it recommends for "does it actually look right —
   art, light, readability, A/B". Those two purposes must be separated: marks
   for identification, an unmarked frame for judgement.

3. **Overlay marking genuinely works for binding a reference** — the effect is
   very large (25.7% → 86.4% on referring-expression comprehension). But the
   published winning recipe is *numbers **and** masks **and** boxes together*
   (84.4% → 89.2% when boxes were added on top of numbers and masks). See
   demoted numeric tags to a legacy option when it moved to hulls. The evidence
   says keep both.

4. **A hull that traces the real silhouette beats a projected box** — supported.
   Mask quality drives the whole effect: swapping predicted masks for
   ground-truth masks was worth +14.5 mIoU, and a separate paper found coarse
   boxes and circles are sub-optimal precisely because they enclose irrelevant
   pixels. See's ID-buffer silhouette hull is the better of its two hull modes,
   and the sidecar should say which one it used.

5. **Colour-as-the-binding-key is unevidenced.** No paper found compares "outline
   in a colour, give a colour→type legend" against "stamp a number on it". The
   adjacent evidence (a red circle steers CLIP's attention; numbers+masks+boxes
   beat numbers+masks) supports *marking*, not colour specifically. The sheet
   states the colour convention as though it were established. It should be
   stated as a house convention.

6. **Pairwise beats absolute scoring, and this is well established** — in humans
   (inter-observer agreement 0.665 → 0.785), in text judges, and in vision
   judges (correlation 0.30–0.46 but only 32–34% exact agreement on a 5-point
   scale; scores compress toward the middle). See's `capture` A/B path is the
   reliable one; any "rate this 1–10" path is not.

7. **The cheap tier falls off a cliff on exactly See's task.** On video-game
   glitch detection from a single frame, GPT-4.1 scored 81.3% and GPT-4.1-nano
   57.0% — a 24.3-point gap, and on video 76.6% vs 49.9%, i.e. chance. The sheet
   says nothing different to a small model. It should.

8. **Negation is at chance.** Vision-language models answer negated queries
   ("which of these is NOT…") at roughly random. The sheet never warns against
   phrasing a question this way, and `see.find` makes it easy to want to.

9. **The sidecar can overwrite what the model sees.** Models resolve
   text-versus-pixel conflicts in favour of the text. That makes the sidecar
   powerful when correct and dangerous when it contains a claim about the very
   thing being asked. Ground truth in the sidecar, never a verdict.

10. **A flat-colour sketch is the wrong input for "does this read as a rat".**
    Large vision-language models are well below human on recognising abstract
    shapes that lack a clear class association. Silhouette-readability questions
    need the rendered frame, not `see.sketch`.

---

## Question 1 — What vision models are measurably bad at on a rendered frame

### Counting, especially overlapping or repeated things

The clearest result is *BlindTest*. Four frontier models averaged 58.57% across
seven tasks a human solves perfectly. The counting results are the relevant
ones:

- Counting the rings of an Olympic-style interlocking logo: GPT-4o **42.50%**,
  Gemini-1.5 Pro **20.83%**, Claude 3 Sonnet **31.66%**, Claude 3.5 Sonnet
  **44.16%**.
- The same models are ≥96% accurate at five circles, and accuracy "dips
  substantially to near zero" when a sixth is added — the trained-prior number
  wins over the picture.
- Counting rows and columns of a grid: 36–40% for three of four models.
- Counting nested squares: 55.83% (GPT-4o) to 92.08% (Sonnet 3.5).

  <https://arxiv.org/abs/2407.06581> — *Vision language models are blind*,
  Rahmanzadehgervi et al., ACCV 2024. Per-task table:
  <https://vlmsareblind.github.io/>

BLINK reformats fourteen classic vision tasks as multiple choice. On its
counting split, humans scored 93.75%, GPT-4V 60.83%, Gemini Pro 65.00%, Claude 3
Opus 49.17%, against a 25% random baseline.

  <https://arxiv.org/abs/2404.12390> — *BLINK: Multimodal Large Language Models
  Can See but Not Perceive*, Fu et al., ECCV 2024. Per-task numbers from
  <https://arxiv.org/html/2404.12390v3>

The failure mode has a name in the counting literature: numerical hallucination,
a confident count unrelated to the true quantity, worsening with visual and
compositional complexity.

  <https://arxiv.org/pdf/2510.04401> — *Your Vision-Language Model Can't Even
  Count to 20: Exposing the Failures of VLMs in Compositional Counting*

A rendered game frame is the adversarial case for all of this: repeated
instances of one prefab, overlapping in screen space, at varying depth.

### Spatial relations, depth, and occlusion ordering

BLINK again, humans versus the best models:

| task | human | GPT-4V | Gemini Pro | Claude 3 Opus | random |
|---|---|---|---|---|---|
| Relative depth | 99.19% | 58.87% | 50.00% | 57.26% | 50% |
| Spatial relation | 98.25% | 72.03% | 67.13% | 57.34% | 50% |
| Object localization | 98.00% | 50.40% | 46.40% | 46.40% | 50% |
| Multi-view reasoning | 92.48% | 58.65% | 41.35% | 57.89% | 50% |
| Visual correspondence | 99.42% | 37.21% | 37.21% | 31.40% | 25% |
| Relative reflectance | 95.14% | 38.81% | 46.27% | 27.61% | 33.33% |

Relative depth at 58.9% against a 50% baseline is the number to remember: asking
"is the crate in front of the rat" is barely better than tossing a coin. Object
localisation is *at* chance. The BLINK authors note that on several tasks some
multimodal models "underperform compared to random guessing".

Left/right and above/below are no better in the wider literature. On the Visual
Spatial Reasoning dataset humans exceed 95% while top models reach 70–74%; other
surveys report models "performing near random" on basic relations, and several
70-billion-parameter models at or below chance on orientation and depth.

  <https://arxiv.org/pdf/2509.21922> — *Spatial Reasoning in Foundation Models:
  Benchmarking Object-Centric Spatial Understanding*
  <https://www.emergentmind.com/topics/visual-spatial-reasoning-vsr-dataset> —
  summary of the VSR dataset results

### Small objects and low frame coverage

The most directly usable number for See comes from a study that binned VQA
questions by the fraction of the image the answer occupies. On TextVQA with
BLIP-2 FlanT5XL:

- detail ≥ 5% of the image: **36.81%**
- detail 0.5%–5%: **29.07%**
- detail < 0.5%: **19.91%**

Cropping to a human-annotated box around the answer region lifted full-image
accuracy from 25.91% to **37.68%** (+11.77 points, a 45% relative gain), and
shrank the small-versus-large gap.

  <https://arxiv.org/pdf/2310.16033> — *Towards Perceiving Small Visual Details
  in Zero-shot Visual Question Answering with Multimodal LLMs*

This is old-generation model scale, so treat the absolute numbers as indicative
rather than current. The *shape* of the curve — accuracy falling monotonically
with subject size, recovered by cropping — is reproduced by the whole
visual-search line of work: V\*Bench is 191 images averaging 2246×1582 built
specifically because frontier models fail on small details in crowded scenes,
and cropping policies keep being the fix.

  <https://vstar-seal.github.io/> — *V\*: Guided Visual Search as a Core
  Mechanism in Multimodal LLMs*
  <https://arxiv.org/pdf/2511.19820> — *CropVLM: Learning to Zoom for
  Fine-Grained Vision-Language Perception*

Note where See's existing "under ~5% of the frame, use `subject`" rule lands: it
is exactly the boundary of the "large" bin in the study above. That threshold is
better supported than the sheet lets on.

### Estimating distance and size

Q-Spatial Bench (271 questions on quantitative distance) found "reasoning about
distances between objects is particularly challenging", with gaps exceeding 40
points between top performers, and prompting the model to reason via a reference
object of known size improved Gemini 1.5 Pro by over 40 points, GPT-4V by over
30, and Gemini 1.5 Flash by over 20. A technique that buys forty points is
measuring a capability that was not there.

  <https://arxiv.org/abs/2409.09788> — *Reasoning Paths with Reference Objects
  Elicit Quantitative Spatial Reasoning in Large Vision-Language Models*

### Reading text rendered in a scene

OCRBench evaluated fourteen multimodal models on text recognition, scene-text
VQA, document VQA and key information extraction. Most scored below 50 out of
100, and even Gemini and GPT-4V "still encounter challenges in recognizing blurry
text images, handwritten text, multilingual text". OCRBench v2 names fine-grained
perception and layout perception as persistent limits.

  <https://arxiv.org/html/2305.07895v7> — *OCRBench: On the Hidden Mystery of OCR
  in Large Multimodal Models*
  <https://arxiv.org/pdf/2501.00321> — *OCRBench v2*

Game text is small, stylised, often outlined or drop-shadowed, often animated —
the blurry/decorative case, not the document case. See is already right to route
HUD and screen text to `hud.read` and `screen.read`.

### Negation

Vision-language models "struggle significantly with negation, often performing at
chance level" across NegBench's 18 task variations and 79k examples. Fine-tuning
on millions of negated captions bought a 28-point improvement on negated
multiple-choice — the size of that repair is the size of the hole.

  <https://arxiv.org/abs/2501.09425> — *Vision-Language Models Do Not Understand
  Negation*, Alhamoud et al., CVPR 2025

Related: models have a strong yes-bias on existence questions. On POPE,
mPLUG-Owl answered "yes" to 96.23% of object-existence questions, LLaVA 95.37%,
MultiModal-GPT 99.97%. A question shaped so that "yes" is the wrong answer is a
question you should expect to get wrong.

  <https://arxiv.org/abs/2305.10355> — *Evaluating Object Hallucination in Large
  Vision-Language Models* (POPE), Li et al., EMNLP 2023

### The cheap tier versus the flagship

The best evidence is from the closest domain there is — video-game QA from
frames.

VideoGameQA-Bench evaluated sixteen models across visual unit testing, glitch
detection, visual regression, needle-in-a-haystack and bug reporting. On
image-based glitch detection: **GPT-4.1 81.3%, GPT-4o-mini 76.9%, GPT-4.1-nano
57.0%** — a 24.3-point gap from flagship to nano. On video: **76.6% vs 49.9%**,
which for a binary task is chance. The paper also reports that open-weight models
showed "severe biases": Gemma-3 labelled nearly everything glitched (100% recall,
under 2% specificity) while Llama variants did the opposite (over 95%
specificity, ≤14% recall).

  <https://arxiv.org/abs/2505.15952> — *VideoGameQA-Bench: Evaluating
  Vision-Language Models for Video Game Quality Assurance*, results table from
  <https://arxiv.org/html/2505.15952v1>

Even the flagship numbers there are sobering: best-in-class visual unit testing
53%, visual regression testing 45.2%, needle-in-a-haystack 35–36%. Named failure
modes include fine-grained perception of character posture and object placement,
intricate clipping between meshes, and body-configuration glitches from ragdoll
physics — all of which are things a game engine's vision plugin will be asked
about.

GlitchBench, on 923 screenshots from 205 games, put GPT-4V at 43.4% average and
the best open model at 35.5%. Its hardest category was animation and pose.

  <https://arxiv.org/pdf/2312.05291> — *GlitchBench: Can large multimodal models
  detect video game glitches?* (numbers via
  <https://arxiv.org/html/2312.05291v2>)

One more tier signal, on general multimodal reasoning: Claude 3 Opus scored 59.4%
on MMMU validation and Claude 3 Sonnet 53.1%; on MathVista, 50.5% and 47.9%. I
could not verify the Haiku row from a primary source and so do not quote it.

  <https://www-cdn.anthropic.com/fed9cc193a14b84131812372d8d5857f8f304c52/Model_Card_Claude_3_Addendum.pdf>
  — Anthropic model card addendum (the PDF did not render for direct extraction;
  numbers taken from secondary quotation of its table and should be treated as
  second-hand)

### One extra failure See should know about

Longer answers hallucinate more. "As the length of the generated response
increases, the LVLM tends to hallucinate more nonexistent objects." This is the
mechanical argument against `see.describe`-style open prompts to a vision model.

  <https://arxiv.org/pdf/2407.21771> — *Paying More Attention to Image: A
  Training-Free Method for Alleviating Hallucination in LVLMs*
  <https://arxiv.org/pdf/2406.12663> — *Do More Details Always Introduce More
  Hallucinations in LVLM-based Image Captioning?* (also notes the CHAIR metric
  itself inflates for longer captions, so read the trend, not the absolute)

---

## Question 2 — What they are good at, and what they can judge about art

This is the thinner half of the literature, and it needs saying up front: there
is a large, mature literature on vision models judging *image quality* and
*aesthetics in photographs*, a growing one on judging *generated images*, and
almost nothing on judging *game art specifically*. Several of See's aesthetic
claims are extrapolations from the photograph literature.

### Pairwise A/B versus absolute scoring — the strongest result in this section

Three independent lines agree.

**In humans**, on subjective image quality: switching from a Likert scale to
pairwise comparison raised inter-observer agreement (ICC) from 0.665 to 0.785 on
high-variation data and from 0.276 to 0.562 on low-variation data. Reader
accuracy was highest for pairwise (concordance 1.0) and lowest for non-ranked
Likert (0.83). The stated reason is that perception is relative and pairwise
requires no global consistency.

  <https://link.springer.com/article/10.1007/s00330-023-10493-7> — *How
  subjective CT image quality assessment becomes surprisingly reliable: pairwise
  comparisons instead of Likert scale*, European Radiology 2024
  <https://ajronline.org/doi/full/10.2214/AJR.14.13022> — *Pairwise Comparison
  Versus Likert Scale for Biomedical Image Assessment*

**In multimodal judges**, MLLM-as-a-Judge (ICML 2024 oral) found models "demonstrate
remarkable human-like discernment in Pair Comparison" while showing "significant
divergence from human preferences in Scoring Evaluation and Batch Ranking".

  <https://arxiv.org/abs/2402.04788> — *MLLM-as-a-Judge: Assessing Multimodal
  LLM-as-a-Judge with Vision-Language Benchmark*, Chen et al., ICML 2024

**And quantitatively**, a 2026 study titled, plainly, *VLM Judges Can Rank but
Cannot Score* reports Pearson correlation with human ratings of 0.30–0.46 but
exact agreement of only 32–34% on a 5-point scale (70–76% within ±1), with a
systematic compression of scores toward the middle: bad outputs over-scored,
good outputs under-scored. Its recommendation is explicit — "for applications
requiring reliable absolute scores, wide intervals indicate that point
predictions are unreliable, and pairwise comparison is preferable".

  <https://arxiv.org/abs/2604.25235> — *VLM Judges Can Rank but Cannot Score:
  Task-Dependent Uncertainty in Multimodal Evaluation*

One honest complication. Q-Bench+ found that *most* models are worse at pairwise
low-level perception questions than at single-image ones — GPT-4V was the
exception (78.07% on pairs vs 74.51% on single images; senior human raters 85.48%
and 81.74%). The distinction that resolves this: **pairwise preference** ("which
looks better") is more reliable than absolute scoring; **pairwise fine-grained
perception** ("which of these two has more noise in the upper left") is harder
than the single-image version for weak models. See's A/B use is the former.

  <https://arxiv.org/html/2402.07116> — *Q-Bench+: A Benchmark for Multi-modal
  Foundation Models on Low-level Vision from Single Images to Pairs*

And the caveat on all of it: pairwise reduces but does not remove unreliability.
An evaluator study across 4000+ perturbed instances found VLM judges fail to
detect quality-degrading perturbations "in some cases exceeding 50%", struggling
most with fine-grained compositional and spatial errors; pairwise "proves more
reliable, though failure rates persist".

  <https://arxiv.org/abs/2604.21523> — *Seeing Isn't Believing: Uncovering Blind
  Spots in Evaluator Vision-Language Models*

Position bias is well documented for text judges — a reliable judge should give
the same answer with the candidates swapped, and the standard mitigation is to
run both orders and discard inconsistent pairs. I found no vision-specific
quantification of it, but no reason it would not apply.

  <https://arxiv.org/abs/2406.07791> — *Judging the Judges: A Systematic Study of
  Position Bias in LLM-as-a-Judge*

### One question at a time, versus asking for a description

POPE's central methodological contribution is exactly this substitution:
replacing free-form caption analysis with polled yes/no probes. The measured
benefit is stability — standard deviation across different prompt phrasings of
**±0.78 F1 for POPE against ±3.22 for the caption-based CHAIR metric**. Combined
with the result that hallucination grows with response length, "ask one narrow
question" is supported both for accuracy and for reproducibility.

  <https://arxiv.org/abs/2305.10355> — POPE, as above

Multiple choice raises measured accuracy over open-ended: on Qwen2.5VL-72B,
82.78% multiple-choice versus 64.24% open-ended on the same content. Some of that
is real (a constrained answer space is easier to score) and some is artefact —
"easy-options bias", where the correct option is simply more visually plausible,
and selection bias driven by token identity and option position, which intensifies
as options get fine-grained.

  <https://arxiv.org/pdf/2509.16805> — *Benchmarking and Mitigating MCQA
  Selection Bias of Large Vision-Language Models*
  <https://arxiv.org/html/2508.13428> — *Mitigating Easy Option Bias in
  Multiple-Choice Question Answering*

The related warning: multiple-choice benchmarks leak. Gemini Pro scored 42.9% on
MMMU *with no image at all*, and Sphinx-X-MoE 43.6%. For See this means a
multiple-choice question whose options are guessable from the question text is
not measuring the picture.

  <https://arxiv.org/abs/2403.20330> — *Are We on the Right Way for Evaluating
  Large Vision-Language Models?* (MMStar), NeurIPS 2024

Question decomposition — splitting a compound question into sub-questions — is
reported to help, including lifting BLIP-2 above chance on a benchmark it
otherwise failed, but the useful papers are mostly about training a model to
decompose rather than about a caller doing it. Directionally supportive, not
decisive.

  <https://arxiv.org/pdf/2310.17050> — *Exploring Question Decomposition for
  Zero-Shot VQA*
  <https://arxiv.org/pdf/2409.19339> — *Visual Question Decomposition on
  Multimodal Large Language Models*

### Aesthetics: what they can actually judge

AesBench, an expert benchmark built on 2,800 images annotated by 32 professional
aesthetics experts across perception, empathy, assessment and interpretation:

- best model on aesthetic perception: 72.61%
- best on aesthetic empathy: 72.68%
- best on aesthetic assessment (a three-grade classification): **52.86%**
- the paper's conclusion: "current MLLMs only possess rudimentary aesthetic
  perception ability, and there is still a significant gap between MLLMs and
  humans"; and models suffer "strong hallucination in the context of aesthetic
  interpretation" — precision much worse than relevance or completeness

  <https://arxiv.org/html/2401.08276v1> — *AesBench: An Expert Benchmark for
  Multimodal Large Language Models on Image Aesthetics Perception*

So: perception and empathy in the low seventies, absolute grading barely above
coin-flip, and *reasons given for aesthetic verdicts are the least trustworthy
part of the output*. That last point matters for See: take the choice, be
sceptical of the rationale.

A 2026 graphic-design benchmark gives the most granular breakdown of *which*
aesthetic dimensions survive. Best overall accuracy 0.7252 (GPT-5). Stronger on
layout-related indicators — balance, alignment — and on colour harmony and font
hierarchy. Weaker on graphics-related indicators and on subjective ones
(psychology, appeal). And below 0.20 IoU on precise localisation of the region
responsible. Notably, reasoning-augmented models "offer no clear advantage over
their non-reasoning counterparts" here.

  <https://arxiv.org/html/2603.01083v1> — *Can Vision–Language Models Assess
  Graphic Design Aesthetics? A Benchmark, Evaluation, and Dataset Perspective*

That maps onto See's list as follows. **Colour harmony: evidenced, reasonably
good. Composition and balance (See's "focal clarity", "clutter"): evidenced,
reasonably good. Locating *where* the problem is: evidenced as bad.** So See
should let a model say "this reads as cluttered" and never trust "the clutter is
in the top-left".

Low-level quality perception is decent and improving: on Q-Bench+ single images,
GPT-4V 74.51% against senior human raters at 81.74%. Q-Align showed that training
a model to emit discrete text levels ("excellent/good/fair/poor/bad") rather than
numeric scores reaches state-of-the-art on image quality *and* image aesthetic
assessment — a direct argument for asking a model for a word, not a number.

  <https://arxiv.org/abs/2312.17090> — *Q-Align: Teaching LMMs for Visual Scoring
  via Discrete Text-Defined Levels*, ICML 2024

### Style consistency, material and lighting plausibility, "does it read as the thing"

**Style consistency across assets** is the best-supported of See's art claims,
because it is the standard automated metric in visual-narrative generation. VLM
judges are prompted to decide whether a set of images share media type, colour
palette, lighting, saturation, contrast, perspective and overall feel; and
whether a character keeps the same facial features, proportions and clothing
across scenes. VinaBench cross-checks with two different VLMs and reports their
verdicts align.

  <https://arxiv.org/pdf/2503.20871> — *VinaBench: Benchmark for Faithful and
  Consistent Visual Narratives*
  <https://arxiv.org/pdf/2506.23275> — *Why Settle for One? Text-to-ImageSet
  Generation and Evaluation*

**Artifact and defect spotting** — the closest proxy for "does this look
finished" — is genuinely good at the coarse level and unreliable at the fine
level. SalArt-VQA found the strongest of 20 models reaching 99.37% recall on
flagging that an artifact exists, but "a model may correctly flag an artifact
while relying on the wrong visual cue, selecting the wrong region, or describing
a defect that the image does not support", with a sensitivity–calibration
trade-off: sensitive models invent defects, conservative ones miss real ones.

  <https://arxiv.org/abs/2606.12671> — *SalArt-VQA: Diagnosing Whether VLMs
  Understand Salient Artifacts in Generated Images*

**Lighting and material plausibility**: partially supported, with a sharp limit.
Benchmarks in this space use VLMs to judge lighting controllability and physical
realism (unrealistic lighting, implausible deformation), and the reported summary
is that VLMs "capture macroscopic plausibility and human-like perception well"
but "are not yet capable of precise, pixel-level physical evaluations of light
transport". BLINK's relative-reflectance task — deciding which surface is more
reflective — is one of the worst tasks in the whole benchmark (GPT-4V 38.81%,
Claude 3 Opus 27.61%, random 33.33%). So: "the lighting feels wrong" is a
question worth asking; "which of these two materials is more specular" is not.

  <https://arxiv.org/html/2606.26738v1> — *Do Image Editing Models Understand
  Lighting?*
  <https://arxiv.org/html/2510.17681v1> — *PICABench: How Far Are We from
  Physically Realistic Image Editing?*

**Silhouette readability** — "does this shape read as a rat" — is the weakest.
The relevant finding is that shape recognition in large vision-language models
"remains significantly below human performance", because these models "rely
predominantly on high-level and semantic features and struggle with abstract
shapes lacking clear class associations". CLIP-style encoders do carry a shape
bias, and masking away conflicting texture raises shape-versus-texture scores
substantially, so a clean silhouette is *better* than a cluttered one — but the
absolute capability is not there.

  <https://arxiv.org/html/2503.23062v2> — *Shape and Texture Recognition in Large
  Vision-Language Models*
  <https://arxiv.org/abs/2508.09814> — *On the dynamic evolution of CLIP
  texture-shape bias*

**"Programmer art versus finished art"**: no evidence found. Nobody has
benchmarked this. It is a plausible extension of the artifact-detection and
aesthetic-perception results, and See may keep asking it, but it should be
labelled a house heuristic.

---

## Question 3 — What prompt and payload shape works

### Resolution and downscaling

The size-bin numbers in Question 1 are the core of it: accuracy on a detail falls
from ~37% to ~20% as it shrinks from >5% to <0.5% of the frame, and cropping
recovers most of that. On the mechanics, image encoders tile: a high-detail image
is scaled into a 2048px box, then to a 768px short side, then charged in 512px
tiles; a low-detail image is one fixed small budget regardless of what is in it.
Sending a 1920×1080 frame at low detail is sending a thumbnail.

  <https://openai-hd4n6.mintlify.app/docs/guides/images> — vendor documentation
  of the tiling and detail parameter (vendor doc, not a paper)
  <https://arxiv.org/html/2512.11167v1> — *Image Tiling for High-Resolution
  Reasoning: Balancing Local Detail with Global Context* — 2×2 tiling improved
  hallucination evaluation, but "extreme fragmentation without contextual
  guidance can be detrimental"

The countervailing evidence is thinner than the headline suggests: one study
found small VLMs' accuracy "largely insensitive to compression, blur, glare, tilt
and resampling" but collapsing under severe underexposure. So moderate downscale
is survivable; a dark frame is not, which is a good argument for See computing
brightness rather than asking.

  <https://arxiv.org/abs/2607.22034> — *Small Vision-Language Models Know When
  They Are Wrong But Cannot Say So*

### Crop to the subject, or send the whole frame

Crop, when the question is about one thing. +11.77 points from a human-annotated
crop on TextVQA; an entire research line (V\*, CropVLM, VLM-R³, Chain-of-Spot)
exists because learned crop-and-zoom is the reliable fix for fine detail. But
context is load-bearing for anything relational: a crop cannot answer "is this
too close to the wall". The tiling paper's warning about fragmentation without
global context applies.

  <https://arxiv.org/pdf/2310.16033>, <https://vstar-seal.github.io/>,
  <https://arxiv.org/pdf/2511.19820> — as above

The practical shape both literatures converge on is **global view plus one
high-resolution crop**, which is what CropVLM does and what See's `subject`
option approximates.

### Annotation overlays — the crux for See's hulls

**They work, and the effect is enormous.** Set-of-Mark segments the image and
overlays marks; GPT-4V on RefCOCOg referring-expression comprehension goes from
**25.7% (asked to predict coordinates directly) to 86.4% (asked to name a mark)**
— beating fully fine-tuned specialists at 85.8–86.1%. On segmentation, 75.6 mIoU
against PolyFormer's 67.2.

  <https://arxiv.org/abs/2310.11441> — *Set-of-Mark Prompting Unleashes
  Extraordinary Visual Grounding in GPT-4V*, Yang et al. Numbers from
  <https://arxiv.org/html/2310.11441v2>

**Which style is best — the evidence, in order of directness:**

- *Combine, don't choose.* SoM's own ablation on Flickr30K phrase grounding:
  numbers and masks gave 84.4% Recall@1; **numbers, masks and boxes gave 89.2%**.
  "Adding extra boxes can improve the performance significantly."
- *Mask precision matters more than mark style.* Replacing predicted masks with
  ground-truth masks was worth **+14.5 mIoU** (75.6 → 90.1). A mark that traces
  the true silhouette is worth much more than a mark that approximately encloses
  it.
- *Coarse enclosures are the weakest of the fine-grained family.* Fine-Grained
  Visual Prompting found "colorful boxes or circles often result in sub-optimal
  performance due to the inclusion of irrelevant and noisy pixels", and that
  blurring outside a precise mask beat them by 3.0–4.6 points on average, up to
  12.5 points on RefCOCO+ testA.
- *A drawn ring genuinely steers attention.* Drawing a red circle around an
  object directs CLIP's attention to that region while preserving global context
  — an emergent property of web-scale training on marked-up images.
- *Coordinate scaffolding works too.* Overlaying a labelled dot matrix and
  referring to (x, y) beat textual chain-of-thought on GPT-4V for spatial,
  compositional and fine-grained tasks.
- *Models can be taught to read arbitrary marks.* ViP-LLaVA trains on arrows,
  boxes, circles and scribbles drawn directly on the image and reaches
  state-of-the-art region understanding — so arbitrary overlay styles are
  learnable, not just numeric tags.

  <https://arxiv.org/pdf/2306.04356> — *Fine-Grained Visual Prompting*, NeurIPS
  2023
  <https://arxiv.org/abs/2304.06712> — *What does CLIP know about a red circle?
  Visual prompt engineering for VLMs*, ICCV 2023
  <https://arxiv.org/pdf/2402.12058> — *Scaffolding Coordinates to Promote
  Vision-Language Coordination in Large Multi-Modal Models*
  <https://arxiv.org/abs/2312.00784> — *ViP-LLaVA: Making Large Multimodal Models
  Understand Arbitrary Visual Prompts*, CVPR 2024

**What is not evidenced:** any comparison of *colour-coded outlines with a legend*
against *numeric tags*. I searched for it directly and found nothing. Systems in
the wild use both conventions and no paper adjudicates.

**Two warnings that cut against overlays:**

1. *They do not transfer to every model.* "Despite the extraordinary performance
   from GPT-4V, other MLLMs struggle to understand these visual tags" — the
   motivation for the "list items one by one" training paradigm. A small or
   open-weight model may not read See's hulls at all.

   <https://openreview.net/forum?id=UfWwBaLuXV> — *List Items One by One: A New
   Data Source and Learning Paradigm for Multimodal LLMs*

2. *They bias judgement.* This is the finding See most needs. In a study of
   visual biases in vision-model judges, drawn bounding boxes were one of eight
   manipulations tested — "drawing visible boxes around key objects in the image
   to emphasize their presence or location" — and they inflated scores by
   **+109.6%** for LLaVA-1.5-13B on one domain and **+80.2%** for GPT-4o in
   combination with instruction overlay. Across models and domains, roughly
   65–70% of bias attacks succeeded. Crucially: "biases persisted in pairwise
   comparisons", and chain-of-thought and bias-aware prompting "fail to eliminate
   the overall bias", with some prompts *amplifying* the bounding-box effect
   specifically.

   <https://arxiv.org/abs/2505.15249> — *Fooling the LVLM Judges: Visual Biases
   in LVLM-Based Evaluation*

Read together: **overlays are the right tool for "which one is the rat" and the
wrong tool for "does the rat look good".**

### Structured ground truth alongside the image

Weakly evidenced, and it carries a specific risk.

For: grounded-captioning work feeds object class, ID and box coordinates
alongside the image to produce verifiable descriptions; one comparison of a plain
description prompt against a grounding prompt with explicit coordinates found
58.5% → 59.0%. That is half a point. I did not find a study isolating "hand the
model a JSON scene description and ask a visual question".

  <https://arxiv.org/html/2502.13898v2> — *GroundCap: A Visually Grounded Image
  Captioning Dataset*

Against: models resolve conflicts between text and pixels in favour of text.
"VLMs are vulnerable to misleading textual prompts, often overriding clear visual
evidence in favor of the conflicting text", and "weaker models are more prone to
relying on simpler heuristics like blindly following textual instructions". The
mechanism has been traced: the visual percept is correctly encoded and then
overridden downstream — "arbitration failure, not perceptual blindness".

  <https://arxiv.org/html/2601.19202> — *Do Images Speak Louder than Words?
  Investigating the Effect of Textual Misinformation in VLMs*
  <https://arxiv.org/html/2604.09364> — *Arbitration Failure, Not Perceptual
  Blindness: How Vision-Language Models Resolve Visual-Linguistic Conflicts*
  <https://arxiv.org/abs/2606.28273> — *Vision-Default, Prior-Override: Causal
  Mechanisms of Perception-Knowledge Conflict in Vision-Language Models*

And separately: text overlaid *on the image* is a known score-inflation attack —
embedding the word "Cat", or the generating instruction, or the phrase "Reference
Image", all raise judged scores without adding evidence. See draws no such text
today, and should not start.

### Multiple choice versus open-ended, and one question per call

Covered in Question 2. Summary: multiple choice is more extractable and more
stable, at the cost of guessability and option-position bias; open-ended answers
grow longer and hallucinate more. Ask narrow, closed questions; randomise option
order; do not use options a language model could pick without the picture.

On many questions per call: multi-image comprehension is separately weak — GPT-4o
averages 55.7% on the MMIU multi-image benchmark. And in the text world, models
degrade sharply across turns — an average 39% drop across six generation tasks
between single-turn and multi-turn, driven mostly by a 112% increase in
unreliability rather than lost aptitude, appearing "even in conversations as short
as two turns".

  <https://arxiv.org/pdf/2408.02718> — *MMIU: Multimodal Multi-image
  Understanding for Evaluating Large Vision-Language Models*
  <https://arxiv.org/abs/2505.06120> — *LLMs Get Lost In Multi-Turn Conversation*,
  Laban et al.

### Telling the model what it is bad at

Poorly evidenced, and what evidence exists is discouraging.

Vision-language models "rarely abstain under standard prompting", showing
near-zero abstention on unanswerable items; prompting strategies "can improve
self-assessment but do not eliminate miscalibration"; chain-of-thought "improves
abstention alignment with human judgment but amplifies overconfidence rather than
mitigating it"; and abstention can be a prompt artefact — an extra "I don't know"
option makes models decline problems they could actually solve.

  <https://arxiv.org/pdf/2505.20236> — *Seeing is Believing, but How Much? A
  Comprehensive Analysis of Verbalized Calibration in Vision-Language Models*
  <https://arxiv.org/html/2507.16199> — *LLM Abstention Can Be a Prompt Artifact,
  in Addition to Genuine Uncertainty*

The strongest adjacent positive result is not a warning but a *procedure*: the
reference-object prompting that bought 20–40 points on distance estimation worked
by telling the model *how* to reason, not by telling it that it was bad at
distances.

  <https://arxiv.org/abs/2409.09788> — as above

And a related caution for reasoning-capable models: on tasks that rely on direct
perception, accuracy can *fall* as the thinking budget rises — one report has
92.0% at zero budget dropping to 87.5% at maximum, while a fine-grained matching
task rose 87.5% → 92.1%. The graphic-design benchmark similarly found reasoning
models gave "no clear advantage" on aesthetic judgement.

  <https://arxiv.org/abs/2511.19418> — *Chain-of-Visual-Thought: Teaching VLMs to
  See and Think Better with Continuous Visual Tokens*

---

## What this means for See

Each recommendation names the evidence and the part of the plugin it changes.

### 1. Stop drawing marks on the frame used for aesthetic judgement

**Finding:** drawn bounding boxes inflate a vision judge's score by up to
+109.6%; the bias survives pairwise comparison and survives being warned about
(*Fooling the LVLM Judges*, arXiv 2505.15249).

**Changes:** `see.capture`'s default behaviour, and the sheet's routing table.
Today one row — "does it actually look right — art, light, readability, A/B" —
points at `see.capture`, which draws hulls by default. Split it:

- `see.capture` for *identification and grounding* — marks on, as now.
- A judgement path (a flag such as `"judge": true`, or simply defaulting
  `marks: false` whenever `between`/`subject` is absent) that emits a **clean,
  unmarked frame**, plus the sidecar. The sidecar already carries every position
  and hull as data; the reader can locate things from JSON without the pixels
  being altered.

If both are wanted, emit two files — marked and clean — from one call, and say in
the sheet that the clean one is the one to score.

### 2. Say plainly in the sheet that marks bias judgement

**Finding:** same as above; and mitigation prompting does not remove the bias.

**Changes:** the "Reading a frame with a vision model" section of
`see.agent.md`. Add a line of the form: *"Marks help you find a thing. They also
make a frame score better than it is. Never judge art on a marked frame — ask for
the clean one."* This is a wording change with a real consequence: any evaluator
loop that A/B-tests two marked captures is measuring the marks.

### 3. Bring numeric tags back alongside hulls, rather than instead of them

**Finding:** Set-of-Mark's own ablation — numbers + masks = 84.4% R@1; numbers +
masks + boxes = 89.2% (arXiv 2310.11441). The winning configuration is
*redundant* marking, not minimal marking.

**Changes:** how marks are drawn, and the `marks` option's documented default.
Today `marks: "tags"` is described as "the old numbered stamps". Make the default
hull **plus** a small number stamp, with `marks: "hull"` and `marks: "tags"` as
the reduced forms. The sidecar already carries both `palette` and the mark→id
map, so nothing new is needed in the payload.

Corollary for the sheet: the current instruction "Never bind by floating text"
should become "Bind by hull colour *and* mark number, cross-checked against the
sidecar's `at` — never by text the game itself drew."

### 4. Keep the silhouette hull, and let the sidecar say which kind it is

**Finding:** ground-truth masks beat predicted masks by +14.5 mIoU; coarse boxes
and circles are sub-optimal because they enclose irrelevant pixels (arXiv
2310.11441, arXiv 2306.04356).

**Changes:** what the sidecar carries. The sheet already notes that a capture's
hull traces the ID-buffer silhouette while a sketch's is the projected box. That
distinction is not decoration — it is the difference between the strong and the
weak version of the technique. Put it in the data: a `hullKind` field per marked
entry (`"silhouette"` | `"box"`), so a reader knows how much to trust the
outline, and so a future evaluator can tell the two apart.

### 5. Downgrade "colour is the binding key" from law to convention

**Finding:** no study compares colour-coded outlines with a legend against
numeric tags. Marking works (large evidence); *colour specifically* is
unevidenced.

**Changes:** the sheet's wording. "Ground an answer in colour + the sidecar's
positions, never in floating text" reads as an established fact. Rewrite as a
house convention — "See marks each type in one colour and gives you the legend;
use it together with the mark number and the sidecar" — so nobody inherits a
false confidence, and so the design can be tested later rather than defended.

### 6. Refuse to route these questions to an image at all

**Finding:** relative depth 58.9% against a 50% baseline; object localisation at
or below chance; overlapping-shape counting 20.8–44.2%; distance estimation
improved 20–40 points by a prompting trick, meaning the base capability is
absent (BLINK arXiv 2404.12390; *VLMs are blind* arXiv 2407.06581; Q-Spatial
arXiv 2409.09788).

**Changes:** the routing table, and an explicit refusal list in the sheet. See
already computes all of these. Add a short block naming the questions the plugin
will not answer from pixels, and the verb that answers each:

- how many of X → `see.describe` / `see.find`
- which is in front / behind, what is blocking → `see.occlusion`
- how far apart, how big → `see.isolate`, `see.capture` with `between`
- where on screen, which region → `see.describe`
- is it too dark → the sidecar's `light` block

The sheet says "Never ask a vision model what a query answers". Make that a list,
not a principle — a principle gets skimmed.

### 7. Refuse negated and compound questions

**Finding:** vision-language models handle negation "at chance level" (NegBench,
arXiv 2501.09425); and yes-bias is extreme on existence questions — up to 99.97%
"yes" (POPE, arXiv 2305.10355).

**Changes:** the "Reading a frame with a vision model" section. Add: *"Never ask
'which of these is NOT…' or 'is anything missing'. Ask the positive form and
compare against the sidecar. If you need the absence of a thing, ask
`see.find` — absence is a query, not a look."*

### 8. Make the A/B path a real A/B, with order swapped

**Finding:** pairwise beats absolute scoring in humans (ICC 0.665 → 0.785) and in
vision judges (correlation 0.30–0.46 but 32–34% exact agreement, scores
compressed toward the middle); position bias is standard in judges and the
standard fix is to run both orders (European Radiology 2024; arXiv 2604.25235;
arXiv 2406.07791).

**Changes:** `see.capture`'s A/B affordance and the sheet's wording. Concretely:

- Provide a first-class way to put two frames side by side for a forced choice
  ("A or B, and one sentence why"), rather than leaving the caller to assemble
  it.
- Have the plugin emit the pair in *both* orders, or tell the reader in the sheet
  to ask twice with the order swapped and treat a flip as "no difference".
- Never ask for a 1–10 score. If a scalar is wanted, use discrete words —
  excellent / good / fair / poor / bad — which is the format that reached
  state-of-the-art on aesthetic scoring (Q-Align, arXiv 2312.17090).

### 9. Tell the model to give the verdict, not the reason

**Finding:** on AesBench, aesthetic *interpretation* showed the worst precision of
all four dimensions — "strong hallucination in the context of aesthetic
interpretation"; and on graphic design, localisation of the offending region
scored below 0.20 IoU while the judgement itself reached 0.72 (arXiv 2401.08276;
arXiv 2603.01083).

**Changes:** the sheet's guidance on question shape. Ask for the choice and a
*short* rationale, and say explicitly that the rationale is a hint, not a fact —
and that "where" claims in the rationale must be checked against
`see.describe` before being acted on. This also aligns with the
hallucination-grows-with-length result: cap the answer.

### 10. Do not ask a sketch whether something reads as the right thing

**Finding:** shape recognition in large vision-language models is "significantly
below human performance" for abstract shapes lacking clear class associations
(arXiv 2503.23062).

**Changes:** the routing table's `see.sketch` row, which currently reads "layout
and composition, roughly". Add the negative: *sketch answers where things are and
how the frame is arranged; it cannot answer whether a shape reads as a rat. That
needs `see.capture` with `subject` and `alone`.*

### 11. Keep the ~5% rule, and say where it comes from

**Finding:** VQA accuracy by detail size — ≥5% of frame 36.81%, 0.5–5% 29.07%,
<0.5% 19.91%; cropping to the region recovered +11.77 points (arXiv 2310.16033).

**Changes:** the sheet's wording only. The existing line "A subject under ~5% of
the frame: capture it with `subject`" is correct and lands on the published bin
boundary. Give it its reason in one clause so readers apply it rather than skip
it — and consider having `see.capture` *warn in its reply* when the requested
subject occupies under 5% of the frame and `subject` framing was not used. The
plugin already computes coverage, so this is free.

### 12. Say something different to a small or low-effort model

**Finding:** on single-frame game glitch detection, GPT-4.1 scored 81.3% and
GPT-4.1-nano 57.0%; on video, 76.6% versus 49.9% — chance. Small models degrade
into degenerate biases (one open model called 100% of frames glitched). Marks may
not be legible to them at all: "other MLLMs struggle to understand these visual
tags" (arXiv 2505.15952; OpenReview *List Items One by One*).

**Changes:** a short section in the sheet, and the plugin's defaults when a small
model is the caller. Recommended content:

- For a small or low-effort model, spend the image on **one subject at a time**
  (`subject` + `alone`), not on a busy frame. A crowded frame is where the
  cheap tier collapses.
- Give it a **forced binary choice** — never open description, never "find
  anything wrong". Its failure mode is a stuck answer, so a question whose
  answer is stuck ("is anything glitched?") returns no information.
- Do not rely on it reading marks. Put the identifying information in the
  question and the crop ("this frame contains only the rat"), not in the
  overlay.
- Ask it twice with the choice order swapped and treat disagreement as "no
  answer".
- Never route counting, depth or distance to it under any circumstances — for a
  small model the query path is not merely cheaper, it is the only correct path.

### 13. Keep the sidecar to facts, and never to verdicts

**Finding:** models override visual evidence in favour of conflicting text, and
weaker models do so more readily; the failure is downstream arbitration, not
perception (arXiv 2601.19202; arXiv 2604.09364; arXiv 2606.28273). Meanwhile the
measured benefit of adding grounding metadata to a prompt was about half a point
(arXiv 2502.13898).

**Changes:** what the sidecar carries, and the sheet's description of it. Two
specific rules:

- The sidecar may state **measurements** (positions, sizes, counts, brightness,
  hulls, occlusion fractions). It must never state a **judgement** ("the model
  looks correct", "lighting is fine"), because the model will adopt it.
- The sheet's line "the sidecar is ground truth, pixels answer only what it
  cannot say" is right in spirit and should gain a boundary: *ground truth for
  the fields it lists; silent on everything else. If the sidecar and the picture
  disagree about something the sidecar measures, the sidecar wins. If they
  disagree about anything else, say so rather than resolving it.*

### 14. Do not put text on the frame

**Finding:** overlaid text — a keyword, an instruction, the words "Reference
Image" — inflates judged scores substantially and provides no evidence (arXiv
2505.15249).

**Changes:** how marks are drawn, and the `see.moment` sheet layout, whose cells
are "every cell labelled". Cell labels are probably benign because they sit
outside the rendered content, but the rule should be explicit: **no text inside
the rendered region, ever.** Labels go in the margin or the sidecar.

### 15. Treat `see.moment` as a layout aid, not a question surface

**Finding:** multi-image comprehension is weak (GPT-4o 55.7% average on MMIU);
and single narrow questions are more stable than compound ones (arXiv 2408.02718;
POPE's ±0.78 vs ±3.22).

**Changes:** the sheet's `see.moment` row. It is excellent for the human-legible
diagnosis it advertises — "in the pixels but not the scene is a rendering
artifact" — and a poor payload for a fine-grained model question. Say so: use it
to *decide which single moment to capture*, then ask the question of that single
capture.

### 16. Do not tell the model it is bad at things; tell it how to look

**Finding:** limitation warnings and abstention options do not reliably improve
calibration and can cause models to decline solvable problems; chain-of-thought
can amplify overconfidence; on direct-perception tasks a bigger thinking budget
can lower accuracy (arXiv 2505.20236; arXiv 2507.16199; arXiv 2511.19418). But
telling a model *a method* — reason via a reference object of known size — was
worth 20–40 points (arXiv 2409.09788).

**Changes:** the sheet's framing throughout. The current sentence "Vision models
miscount overlapping things and misjudge positions and distances" is addressed to
the *caller*, which is exactly right, and should stay. What should not happen is
that text being forwarded into the vision prompt as a caveat. In the prompt sent
to the vision model, prefer procedure over apology: "Look only at the white
outlined shape. Ignore everything else. Answer A or B."

---

## Where the evidence is thin

Listed so that nothing above is mistaken for settled.

**Colour-coded outlines versus numeric tags.** No comparison exists that I could
find. Recommendation 3 (bring numbers back alongside hulls) rests on SoM's
numbers+masks+boxes ablation, which is about *adding a second mark channel* and
not about colour. Recommendation 5 (call the colour scheme a convention) is the
honest response to the gap. **The claim that colour binds better than a number is
a guess.**

**Whether a hull outline behaves like a bounding box for the score-inflation
bias.** The measured manipulation was a drawn box. A tight silhouette hull is
plausibly *more* biasing (it emphasises the object more precisely) or *less* (it
adds fewer foreign pixels). Nobody has measured it. Recommendation 1 assumes the
bias transfers; **that transfer is a guess**, though a conservative one — the cost
of emitting a clean frame is near zero and the downside of being wrong about it
is a corrupted evaluation loop.

**Whether marks help modern frontier models as much as they helped GPT-4V.** The
SoM result is from late 2023. Frontier models have improved at direct coordinate
grounding since, which was the 25.7% baseline SoM beat. The gain may be much
smaller now. Nobody has published the re-run. **The size of the current benefit is
unknown.**

**Silhouette readability.** The shape-recognition evidence says models are weak on
abstract shapes; it does not say how they do on "does this low-poly mesh read as
a rat", which sits between abstract shape and recognisable object. Recommendation
10 (do not ask a sketch) follows from the evidence; the stronger claim that a
rendered capture *can* answer it is **unevidenced**.

**"Does this look finished or does it look programmer-art".** No benchmark. The
nearest evidence — artifact detection at 99.37% recall but poor grounding of
*which* artifact — suggests a model can flag that something is off and cannot be
trusted about what. Asking the question is reasonable; believing the explanation
is not. **The whole capability is an extrapolation.**

**Material and lighting plausibility in a game render.** The lighting benchmarks
are about photographic and edited images, not stylised real-time rendering with
baked lighting and post-processing. BLINK's relative-reflectance result (below
random for two of three frontier models) is the only hard number and it is bad.
**Treat "the lighting looks wrong" as a weak signal, not a finding.**

**Structured ground truth alongside an image.** Half a percentage point in the one
comparison I found, in a different task. The *risk* side (text overriding pixels)
is well evidenced; the *benefit* side is not. Recommendation 13 is therefore
framed as a safety constraint rather than as a performance claim.

**Model-tier numbers.** The strongest tier evidence (VideoGameQA-Bench) covers the
GPT-4.1 family and open-weight models; it does not cover current Claude or Gemini
tiers, and the game-QA numbers may not generalise to See's specific question
types. The Claude 3 MMMU/MathVista figures quoted are second-hand — the model card
PDF would not render for direct extraction — and I could not verify the Haiku row
at all. **Do not cite exact per-tier numbers for Claude from this brief.**

**Position bias in vision judges specifically.** Well established for text judges;
I found no vision-specific measurement. Recommendation 8's order-swapping advice
is **an extrapolation from the text literature** — cheap insurance, not a proven
necessity.

**Question decomposition by the caller.** The papers train models to decompose;
they do not establish that a caller splitting a question into two calls beats one
compound call. The one-question-per-call advice is better supported by POPE's
stability result and by the hallucination-length result than by the decomposition
literature.

**Very recent citations.** Several sources above are 2026 preprints
(arXiv 2603.01083, 2604.25235, 2604.21523, 2606.12671, 2606.28273). They are
consistent with the older, peer-reviewed results they extend, but they have not
been through review, and their numbers should be read as directional.
