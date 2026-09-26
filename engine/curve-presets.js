/**
 * Kernel: named curves for the moves animation keeps making, so UI, rigs,
 * objects, colour and effects borrow one shape rather than each drawing its
 * own. `context.curve('pop', { duration: 0.25 })` makes one.
 *
 * Each preset runs over 1 second with its value from 0 (start) to 1 (end);
 * `duration` stretches the time, and `from` and `to` map 0 and 1 onto the
 * values wanted: a size, a point, a colour `[r, g, b]`. A value past 1 or
 * below 0 is an overshoot or a wind-up, and maps past `to` or before `from`.
 * A preset marked `loop` repeats; `squash-stretch` and `follow-through`
 * rest at 1, so they suit a scale.
 *
 * The shapes follow the principles of animation: anticipation (a small move
 * the other way first), overshoot and settle, squash and stretch, follow-through,
 * and slow in and out.
 */

/**
 * Every preset by name: `{ use, keys, loop? }`. `use` says what it is for.
 * `keys` is one line of keys, each `at value ease`, joined by commas; a key
 * with no ease is linear. engine/curves.js reads it into key records.
 */
export const CURVE_PRESETS = {
  // Interface: things appearing, leaving and being pressed.
  'fade-in': { use: 'ui', keys: '0 0 sine-in-out, 1 1' },
  'fade-out': { use: 'ui', keys: '0 1 sine-in-out, 1 0' },
  'slide-in': { use: 'ui', keys: '0 0 expo-out, 1 1' },
  pop: { use: 'ui', keys: '0 0 back-out, 1 1' },
  'pop-out': { use: 'ui', keys: '0 1 back-in, 1 0' },
  press: { use: 'ui', keys: '0 1 quad-out, 0.3 0.9 back-out, 1 1' },

  // Motion: bodies, limbs and weapons.
  anticipate: { use: 'motion', keys: '0 0 sine-in-out, 0.3 -0.15 cubic-out, 1 1' },
  overshoot: { use: 'motion', keys: '0 0 cubic-out, 0.6 1.12 sine-in-out, 1 1' },
  'anticipate-overshoot': { use: 'motion', keys: '0 0 sine-in-out, 0.25 -0.12 cubic-out, 0.7 1.1 sine-in-out, 1 1' },
  'wind-up-strike': { use: 'motion', keys: '0 0 sine-in-out, 0.45 -0.3 expo-out, 0.6 1.05 smooth, 1 1' },
  settle: { use: 'motion', keys: '0 0 elastic-out, 1 1' },
  'bounce-drop': { use: 'motion', keys: '0 0 bounce-out, 1 1' },
  'follow-through': {
    use: 'motion',
    keys: '0 0 quad-out, 0.35 1.15 sine-in-out, 0.6 0.95 sine-in-out, 0.8 1.02 sine-in-out, 1 1'
  },
  'squash-stretch': {
    use: 'motion',
    keys: '0 1 quad-out, 0.15 0.75 quad-out, 0.4 1.2 sine-in-out, 0.7 0.95 sine-in-out, 1 1'
  },

  // Objects: idle life that repeats.
  bob: { use: 'object', loop: true, keys: '0 0 sine-in-out, 0.5 1 sine-in-out, 1 0' },
  // From -1 to 1 and back: with `to` an angle, it swings that far either side of rest.
  swing: { use: 'object', loop: true, keys: '0 -1 sine-in-out, 0.5 1 sine-in-out, 1 -1' },
  spin: { use: 'object', loop: true, keys: '0 0, 1 1' },
  pulse: { use: 'object', loop: true, keys: '0 0 quad-out, 0.15 1 quad-in, 1 0' },
  heartbeat: {
    use: 'object',
    loop: true,
    keys: '0 0 quad-out, 0.08 1 quad-in, 0.18 0.25 quad-out, 0.28 0.85 quad-in, 0.5 0 hold, 1 0'
  },

  // Colour and effects: flashes, lights and impacts.
  flash: { use: 'effect', keys: '0 0, 0.06 1 expo-out, 1 0' },
  impact: { use: 'effect', keys: '0 0, 0.04 1 hold, 0.12 1 expo-out, 1 0' },
  decay: { use: 'effect', keys: '0 1 expo-out, 1 0' },
  'attack-release': { use: 'effect', keys: '0 0 quad-out, 0.1 1 quad-out, 0.25 0.7 hold, 0.75 0.7 quad-in, 1 0' },
  shake: {
    use: 'effect',
    keys: '0 0 sine-in-out, 0.05 1 sine-in-out, 0.15 -0.8 sine-in-out, 0.25 0.6 sine-in-out, 0.35 -0.4 sine-in-out, 0.5 0.25 sine-in-out, 0.65 -0.1 sine-in-out, 0.8 0, 1 0'
  },
  flicker: {
    use: 'effect',
    loop: true,
    keys: '0 1 hold, 0.1 0.6 hold, 0.2 0.95 hold, 0.3 0.3 hold, 0.45 0.9 hold, 0.55 0.7 hold, 0.7 1 hold, 0.85 0.5 hold, 1 1'
  },
  strobe: { use: 'effect', loop: true, keys: '0 1 hold, 0.5 0 hold, 1 1' },
  steps: { use: 'effect', keys: '0 0 hold, 0.25 0.25 hold, 0.5 0.5 hold, 0.75 0.75 hold, 1 1' }
}
