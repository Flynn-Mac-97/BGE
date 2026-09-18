# A world with no GL at all

`startWorldInNode({ renderer: 'null' })` gives a headless world the renderer
SURFACE with nothing behind it. The drawing commands then run their whole
mutate-and-restore path — camera borrow, hidden entities, nulled background and
fog, dimmed lights, emptied post chain — instead of refusing on the first line.
Every frame comes back blank and every reply says so: `blank: true` and a `why`
naming the null renderer. This is for testing that path (`test/see-headless.test.mjs`),
not for looking at a game. To look at a game headless, use `see.sketch`.

## Capture checks

`test/see-capture.test.mjs` supplies pixels without a GPU. It checks PNG sizes,
sidecar bindings, studio marks, alpha cropping, colour conversion, and cleanup
after a failed readback. It does not prove real-browser rendering.

The command stays in `see.js`. `see/capture.js` owns capture order;
`capture-state.js` owns scene changes; `capture-images.js` and `capture-pixels.js`
own image creation; `capture-marks.js` and `capture-reply.js` own annotations
and output. Every scene change must remain inside capture's `try/finally`.
