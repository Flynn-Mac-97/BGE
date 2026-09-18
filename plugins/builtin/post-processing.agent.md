---
description: Screen-wide image effects and the chain that runs them — bloom, contact shadow, grading, vignette, antialiasing. Use for image polish over the whole frame, to name a look for a level, and to see what each pass costs.
category: presentation
---

# Post Processing

Declared in the level beside the sky and the fog, because how a place is graded
is a fact about the place.

```json
"world": {
  "post": [ { "smaa": true },
            { "bloom": { "strength": 0.35, "threshold": 0.9 } },
            { "ssao": { "radius": 0.4 } },
            { "grade": { "contrast": 1.05, "tint": "#ffe8c0" } },
            { "vignette": 0.25 } ]
}
```

- A **bare value** is the one number that effect is usually about, so
  `{ "vignette": 0.25 }` and `{ "bloom": 0.4 }` both work. `true` means on with
  the defaults.
- A whole chain can be named instead: `"post": "clean"`.

| effect | what it does | bare number |
|---|---|---|
| `smaa` | subpixel antialiasing, cleans edges without softening the frame | none |
| `bloom` | light bleeding out of the brightest parts | `strength` |
| `ssao` | contact shadow in the creases, from depth. Also `strength` 0.7, `scale` 0.5 (resolution), `denoise` true | `radius`, in metres |
| `ssgi` | light bounced off nearby surfaces, from the picture. Also `quality` low/medium/high, `radius` 12, `denoise` true. Switched on by Render's `globalIllumination`, not by the chain | `intensity` |
| `traa` | temporal antialiasing: jitters the camera and blends frames. Replaces `smaa`. Switched on by Render's `antialiasing: temporal` | none |
| `grade` | contrast, saturation, brightness and a colour cast | `contrast` |
| `vignette` | darkening towards the corners | `amount` |

| preset | is |
|---|---|
| `clean` | smaa, a whisper of bloom, a two percent warm cast. Right more often than it looks |
| `cinematic` | ssao, real bloom, grade and vignette |
| `retro` | no antialiasing on purpose, punchy contrast, hard vignette |
| `none` | nothing, and nothing built |

## Cost

**An empty chain costs nothing**, and that is enforced rather than assumed. The
plugin contributes no system, so there is no per-frame work to skip. Every
effect module sits behind a dynamic `import()`, so a game with no chain never
downloads them. The renderer is only handed effects when there are some, so it
makes no chain and allocates no render target.

**`ssao` costs a second full render of the scene**, because occlusion is worked
out from a normal and depth pre-pass. Every other effect is one more read of the
frame.

Do not add a post-processing dependency. Every effect here already ships inside
the installed `three` package, under `three/addons/tsl/display/`.

## From a terminal

```sh
node bin/engine.mjs run post.chain
node bin/engine.mjs run post.chain cinematic
node bin/engine.mjs run post.chain '[{"bloom":{"strength":0.5}},{"vignette":0.4}]'
node bin/engine.mjs run post.chain null
```

Reading takes no argument. A preset name or a chain sets it for this session
only and is never written to disk. `null` hands the chain back to the level, so
a session of tuning is undone without reloading.

Loading a level re-reads its world block and drops whatever `post.chain` chose.
The file has the last word.

## Detail

Read only the file your task needs.

- `plugins/builtin/post-processing.agent/where-the-passes-run.md` — which half is the renderer's and which is this plugin's
