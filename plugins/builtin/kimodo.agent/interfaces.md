# Its two interfaces

The binary, from `src/generate.cpp`:

```
kmd-generate MOTION.gguf TEXT_BUNDLE PROMPT.txt FRAMES STEPS SEED OUTPUT_DIR
```

With the constraints patch, `--observed OBSERVED.f32 MASK.f32 FIRST_HEADING`
after `OUTPUT_DIR` conditions the generation: raw float32 features
`[FRAMES, 9 + 12 * joints]` to keep, 1 in the mask where each is kept, and the
frame-0 heading in radians. The C++ call is `model::generate_text_conditioned`.

It writes `root_positions.f32` `[frames, 3]` and `local_rotations_xyzw.f32`
`[frames, joints, 4]` — raw little-endian float32, local rotations as x,y,z,w.

The demo server, `go run ./demo -addr 127.0.0.1:8094`:

| route | is |
|---|---|
| `POST /api/generate` | `{prompt, frames, steps, seed, model, segments, transition_frames}` → an animation with an `id` and a `status` |
| `GET /api/animations` | every animation, to poll one's `status` |
| `GET /api/animations/<id>/rotations.f32` | the same buffer as the binary writes |
| `GET /api/animations/<id>/root.f32` | the same buffer as the binary writes |
| `GET /api/animations/<id>/animation.glb` | skeleton-only glTF, no mesh |
