#!/usr/bin/env node
/**
 * Generate the Counter-Strike sound set.
 *
 *   node tools/make-counter-strike-sounds.mjs
 *
 * Same bargain as make-sounds.mjs and make-sprites.mjs: the asset is described
 * rather than committed as an opaque blob, so a number you can read and change
 * beats a binary you cannot. WAV is written by hand — an uncompressed header
 * and PCM samples — so the project keeps zero build dependencies.
 *
 * The files land in project/assets/counter-strike/sounds/. A sound name with a
 * slash in it is resolved from project/, and a bare name from project/assets/,
 * so a type names one in full:
 *
 *   sounds: { fire: 'assets/counter-strike/sounds/ak47-fire.wav' }
 *
 * 22050 Hz mono 16-bit, which is what the real game shipped. Half a modern
 * sample rate costs nothing here — a gunshot has no content above 11 kHz worth
 * hearing — and it keeps the whole set under a megabyte.
 *
 * Every file is normalised to a reference peak and then set to a deliberate
 * level in decibels below it, so the mix is decided here and not forty times
 * over in game code. The manifest at the end prints that level next to the
 * peak actually measured in the file, which is how the next agent picks a
 * volume without listening to anything.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const OUTPUT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../project/assets/counter-strike/sounds'
)
const SAMPLE_RATE = 22050

/** The loudest file in the set peaks here; every other level is measured down from it. */
const REFERENCE_DECIBELS = -3

// ------------------------------------------------------------------ randomness
/**
 * Math.random would be allowed here — this is a build tool, and the engine's
 * determinism rule covers game code, not the things that write assets. It is
 * still the wrong choice. A re-run that produces different bytes turns every
 * regeneration into a forty-file diff nobody can read, and buries the one real
 * change among the noise. Seeding per *name* goes one better than a single
 * global seed: adding a sound to the bottom of the table cannot alter the ones
 * above it, so the diff stays honest as the set grows.
 */
function randomFor(name) {
  let seed = 0x9e3779b9
  for (const character of name) seed = Math.imul(seed ^ character.charCodeAt(0), 0x85ebca6b) >>> 0
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

// ------------------------------------------------------------------ the toolkit
// Every helper below returns a new buffer and never edits the one it was given.
// That costs allocations nobody will notice and buys the ability to filter one
// noise source three different ways, which is exactly what a gunshot needs.

const lengthOf = duration => Math.max(1, Math.round(duration * SAMPLE_RATE))
const decibelsToGain = decibels => Math.pow(10, decibels / 20)
const gainToDecibels = gain => (gain > 0 ? 20 * Math.log10(gain) : -Infinity)

const noise = (count, random) => {
  const out = new Float32Array(count)
  for (let i = 0; i < count; i++) out[i] = random() * 2 - 1
  return out
}

/**
 * One biquad, and the workhorse of the whole file. `kind` is 'low', 'high' or
 * 'band'; `hertz` is a number, or a function of the position through the
 * buffer, which is what turns a fixed band into the falling whine of a
 * ricochet.
 *
 * A biquad rather than the one-pole the demo sounds use, because a one-pole
 * runs out of slope. A weapon's body needs a band that genuinely excludes
 * everything else, and the difference between a real filter and a gentle one
 * is heard as "a weapon" against "some noise".
 */
function filter(buffer, kind, hertz, resonance = Math.SQRT1_2) {
  const out = new Float32Array(buffer.length)
  const last = Math.max(1, buffer.length - 1)
  const fixed = typeof hertz === 'number'
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  let b0 = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0

  const coefficientsAt = frequency => {
    const clamped = Math.min(Math.max(frequency, 20), SAMPLE_RATE * 0.45)
    const angle = (2 * Math.PI * clamped) / SAMPLE_RATE
    const cosine = Math.cos(angle)
    const alpha = Math.sin(angle) / (2 * resonance)
    const a0 = 1 + alpha
    if (kind === 'low') { b0 = (1 - cosine) / 2; b1 = 1 - cosine; b2 = b0 }
    else if (kind === 'high') { b0 = (1 + cosine) / 2; b1 = -(1 + cosine); b2 = b0 }
    else { b0 = alpha; b1 = 0; b2 = -alpha }
    b0 /= a0; b1 /= a0; b2 /= a0
    a1 = (-2 * cosine) / a0
    a2 = (1 - alpha) / a0
  }

  if (fixed) coefficientsAt(hertz)
  for (let i = 0; i < buffer.length; i++) {
    if (!fixed) coefficientsAt(hertz(i / last))
    const x0 = buffer[i]
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
    x2 = x1; x1 = x0; y2 = y1; y1 = y0
    out[i] = y0
  }
  return out
}

/**
 * An exponential fall, in e-folds per second: 30 is effectively gone in a tenth
 * of a second, 400 in a hundredth. This one number is most of a sound's
 * character — an AK and a Glock differ by their decay rate more than by
 * anything else.
 *
 * The short attack is not decoration. A buffer that begins at full scale is a
 * step change, and a step change is a click.
 */
function decay(buffer, ratePerSecond, attackSeconds = 0.0008) {
  const out = new Float32Array(buffer.length)
  const attack = Math.max(1, Math.round(attackSeconds * SAMPLE_RATE))
  for (let i = 0; i < buffer.length; i++) {
    const rise = i < attack ? i / attack : 1
    out[i] = buffer[i] * rise * Math.exp((-ratePerSecond * i) / SAMPLE_RATE)
  }
  return out
}

/** A hump that arrives and leaves, for anything swung rather than struck. */
function bell(buffer, peakAt = 0.3) {
  const out = new Float32Array(buffer.length)
  const last = Math.max(1, buffer.length - 1)
  for (let i = 0; i <= last; i++) {
    const position = i / last
    const shaped = position < peakAt
      ? (position / peakAt) * 0.5
      : 0.5 + ((position - peakAt) / (1 - peakAt)) * 0.5
    out[i] = buffer[i] * Math.sin(Math.PI * shaped)
  }
  return out
}

/**
 * A grunt in this game is always interrupted — the player is dead before the
 * breath is done. Falling over a few milliseconds rather than stopping at a
 * hard edge is the difference between "cut off" and "clicked".
 */
function cutOff(buffer, atFraction, releaseSeconds = 0.008) {
  const out = Float32Array.from(buffer)
  const at = Math.round(buffer.length * atFraction)
  const release = Math.max(1, Math.round(releaseSeconds * SAMPLE_RATE))
  for (let i = at; i < buffer.length; i++) {
    const through = (i - at) / release
    out[i] = through >= 1 ? 0 : buffer[i] * (0.5 + 0.5 * Math.cos(Math.PI * through))
  }
  return out
}

/**
 * A swept sine. Pitch is heard logarithmically, so the sweep is exponential: a
 * linear glide from 3 kHz to 900 Hz spends most of its length up at the top and
 * reads as a chirp instead of as a falling whine.
 */
function tone(duration, fromHertz, toHertz = fromHertz, wobble = 0) {
  const count = lengthOf(duration)
  const out = new Float32Array(count)
  let phase = 0
  for (let i = 0; i < count; i++) {
    const through = i / count
    const wobbled = 1 + wobble * Math.sin((2 * Math.PI * 23 * i) / SAMPLE_RATE)
    const hertz = fromHertz * Math.pow(toHertz / fromHertz, through) * wobbled
    phase += (2 * Math.PI * hertz) / SAMPLE_RATE
    out[i] = Math.sin(phase)
  }
  return out
}

/** A sawtooth: every harmonic present, which is what a filter needs to work on. */
function saw(duration, fromHertz, toHertz = fromHertz) {
  const count = lengthOf(duration)
  const out = new Float32Array(count)
  let phase = 0
  for (let i = 0; i < count; i++) {
    const hertz = fromHertz * Math.pow(toHertz / fromHertz, i / count)
    phase = (phase + hertz / SAMPLE_RATE) % 1
    out[i] = phase * 2 - 1
  }
  return out
}

/**
 * Metal rings at ratios that are not whole numbers, and that inharmonicity is
 * the entire difference between a helmet ping and a musical note — so the
 * ratios passed in here should look irrational rather than like 1, 2, 3.
 */
function metal(duration, baseHertz, ratios, decayRate) {
  const count = lengthOf(duration)
  const out = new Float32Array(count)
  ratios.forEach((ratio, index) => {
    // Higher partials die first. That is what makes a struck object sound
    // struck rather than bowed.
    const partial = decay(tone(duration, baseHertz * ratio), decayRate * (1 + index * 0.55), 0.0004)
    const gain = 1 / (1 + index * 1.3)
    for (let i = 0; i < count; i++) out[i] += partial[i] * gain
  })
  return out
}

/**
 * One delayed copy of a sound fed back on itself. A real room answers a gunshot
 * with its own dimensions, and ten milliseconds of comb is enough for the ear
 * to hear "indoors" rather than "sample". Counter-Strike's weapons are recorded
 * close with almost no tail, so this stays short — a slap, not a hall.
 */
function comb(buffer, delaySeconds, feedback) {
  const delay = Math.max(1, Math.round(delaySeconds * SAMPLE_RATE))
  const out = new Float32Array(buffer.length)
  for (let i = 0; i < buffer.length; i++) {
    out[i] = buffer[i] + (i >= delay ? out[i - delay] * feedback : 0)
  }
  return out
}

/**
 * Powder burning next to a microphone overloads it, and that overload is half
 * of why a real gunshot sounds violent rather than merely loud. Soft here,
 * because tanh keeps the shape; hardClip below is for the radio, where the
 * ugliness is the point.
 */
const saturate = (buffer, drive) =>
  buffer.map(sample => Math.tanh(sample * drive) / Math.tanh(drive))

/**
 * Scale to a peak of one. Saturation is the reason this exists: `drive` only
 * means anything against a known input level, so a sum of five oscillators has
 * to be brought to a unit peak first or the drive number in the table is
 * describing something other than what happens.
 */
function unit(buffer) {
  let loudest = 0
  for (const sample of buffer) loudest = Math.max(loudest, Math.abs(sample))
  return loudest === 0 ? buffer : buffer.map(sample => sample / loudest)
}

const hardClip = (buffer, threshold) =>
  buffer.map(sample => Math.max(-threshold, Math.min(threshold, sample)))

/** Amplitude modulation at an audible rate is what makes a motor sound like a motor. */
function modulate(buffer, hertz, depth = 1) {
  const out = new Float32Array(buffer.length)
  for (let i = 0; i < buffer.length; i++) {
    const wave = Math.sin((2 * Math.PI * hertz * i) / SAMPLE_RATE)
    out[i] = buffer[i] * (1 - depth + depth * (0.5 + 0.5 * wave))
  }
  return out
}

/**
 * Debris: single-sample impulses scattered thinner as the sound goes on. Stone
 * does not simply crack, it throws grit, and the scatter is what says "wall"
 * rather than "drum".
 */
function grit(random, duration, density) {
  const count = lengthOf(duration)
  const out = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const through = i / count
    if (random() < density * (1 - through)) out[i] = random() * 2 - 1
  }
  return out
}

/**
 * Lay buffers over one another at their own start times. Everything here is
 * built as layers rather than as one formula because that is how it is heard:
 * the ear separates the crack from the boom from the room, then hands you back
 * a single event.
 */
function mix(duration, layers) {
  const out = new Float32Array(lengthOf(duration))
  for (const { buffer, at = 0, gain = 1 } of layers) {
    const start = Math.round(at * SAMPLE_RATE)
    for (let i = 0; i < buffer.length; i++) {
      const index = start + i
      if (index >= 0 && index < out.length) out[index] += buffer[i] * gain
    }
  }
  return out
}

// ------------------------------------------------------------------ the sounds
/**
 * The shape every weapon in this set is cut from.
 *
 * A gunshot is three events the ear hears as one. The *transient* is a couple
 * of milliseconds of unfiltered noise, and it is the part that says a shot
 * happened at all; take it away and you have a whoosh. The *body* is the same
 * noise through a resonant band, and its centre frequency is the weapon's
 * voice; take it away and every gun in the game sounds identical. The *tail* is
 * a quieter, slower decay through a comb — the room answering.
 *
 * The two numbers that let a player name a weapon by ear are `bodyHertz` and
 * `bodyDecay`: low and slow against high and instant. That is a real
 * Counter-Strike skill, so those two deserve more care than anything else here.
 */
function gunshot(random, spec) {
  const {
    duration,
    crackGain = 1, crackDecay = 420,
    bodyHertz, bodyResonance = 2.4, bodyDecay, bodyGain = 1,
    lowHertz = 110, lowResonance = 1, lowDecay = 22, lowGain = 0.7,
    tailGain = 0.18, tailDecay = 11, roomDelay = 0.012, roomFeedback = 0.4,
    drive = 1, muffleHertz = 0
  } = spec

  const count = lengthOf(duration)
  const source = noise(count, random)

  const crack = decay(filter(source, 'high', 1400), crackDecay, 0.0002)
  const body = decay(filter(source, 'band', bodyHertz, bodyResonance), bodyDecay)
  // A band and not a low-pass. A low-pass is a shelf: it hands back every
  // frequency beneath it at full strength, which is far more energy than a
  // narrow body band carries, and the weapon's voice ends up buried under a
  // rumble that is identical on all nine guns. The thump you feel in the chest
  // is a resonance anyway, so a band is also the truer answer.
  const low = decay(filter(source, 'band', lowHertz, lowResonance), lowDecay)
  const room = filter(noise(count, random), 'band', bodyHertz * 0.8, 1.1)
  const tail = decay(comb(room, roomDelay, roomFeedback), tailDecay, 0.004)

  let out = mix(duration, [
    { buffer: crack, gain: crackGain },
    { buffer: body, gain: bodyGain },
    { buffer: low, gain: lowGain },
    { buffer: tail, gain: tailGain }
  ])

  if (drive > 1) out = saturate(out, drive)
  // A suppressor does not really quieten a shot, it removes the top of it. The
  // low-pass is why the silenced USP reads as the same gun rather than a
  // different one played softly.
  if (muffleHertz) out = filter(out, 'low', muffleHertz)
  return out
}

/**
 * A footstep is two impulses, not one: the heel lands and the toe follows a few
 * milliseconds behind. The gap is short enough that nobody hears two sounds and
 * long enough that removing it leaves a bare click. Counter-Strike is played by
 * ear, so these matter more than their loudness suggests.
 */
function footstep(random, spec) {
  const {
    gap, hertz, decayRate, weight = 0.35, weightHertz = 190,
    scuff = 0, duration = 0.13, muffleHertz = 0
  } = spec

  const tap = (seed, level) => {
    const source = noise(lengthOf(0.05), seed)
    return decay(filter(source, 'high', hertz, 1.4), decayRate * level, 0.0003)
  }

  const body = decay(filter(noise(lengthOf(0.09), random), 'band', weightHertz, 0.9), 42)
  const drag = scuff
    ? decay(bell(filter(noise(lengthOf(duration), random), 'band', 2200, 0.9)), 14)
    : new Float32Array(1)

  let out = mix(duration, [
    { buffer: tap(random, 1), gain: 1 },
    { buffer: tap(random, 1.25), at: gap, gain: 0.65 },
    { buffer: body, gain: weight },
    { buffer: drag, gain: scuff }
  ])
  if (muffleHertz) out = filter(out, 'low', muffleHertz)
  return out
}

/** A bullet arriving: a transient, a resonant body, and whatever the surface does next. */
function impact(random, spec) {
  const {
    duration, bodyHertz, bodyResonance = 2, bodyDecay,
    crackGain = 0.5, crackHertz = 3000,
    wetDelay = 0, wetFeedback = 0.5,
    gritGain = 0, gritHertz = 3400,
    lowGain = 0, lowHertz = 130, lowDecay = 40,
    muffleHertz = 0
  } = spec

  const count = lengthOf(duration)
  const source = noise(count, random)
  let body = decay(filter(source, 'band', bodyHertz, bodyResonance), bodyDecay)
  // A few milliseconds of comb on a soft body is what "wet" is: a small hollow
  // resonance where a stone impact would just stop.
  if (wetDelay) body = comb(body, wetDelay, wetFeedback)

  const layers = [
    { buffer: decay(filter(source, 'high', crackHertz), 600, 0.0002), gain: crackGain },
    { buffer: body, gain: 1 }
  ]
  if (lowGain) layers.push({ buffer: decay(filter(source, 'band', lowHertz, 1), lowDecay), gain: lowGain })
  if (gritGain) {
    const debris = decay(filter(grit(random, duration, 0.05), 'band', gritHertz, 1.2), 22, 0.002)
    layers.push({ buffer: debris, at: 0.004, gain: gritGain })
  }

  const out = mix(duration, layers)
  return muffleHertz ? filter(out, 'low', muffleHertz) : out
}

/**
 * A voice is a buzz from the larynx shaped by the resonances of the throat and
 * mouth, so a grunt is a falling sawtooth through two band-passes. That is
 * enough for the ear to file it as a person rather than as a synthesiser, and
 * far enough from speech that it never sounds like a word gone wrong.
 */
function voiced(random, spec) {
  const { duration, fromHertz, toHertz, formants, breath = 0.14 } = spec
  const source = saw(duration, fromHertz, toHertz)
  const count = source.length
  const out = new Float32Array(count)
  for (const [hertz, gain] of formants) {
    const band = filter(source, 'band', hertz, 4.5)
    for (let i = 0; i < count; i++) out[i] += band[i] * gain
  }
  // Breath is the cheapest thing that stops a formant filter sounding like an
  // organ pipe.
  const air = filter(noise(count, random), 'band', 1900, 1.1)
  for (let i = 0; i < count; i++) out[i] += air[i] * breath
  return out
}

/** A click: a couple of milliseconds of noise, filtered and stopped almost at once. */
const click = (random, { duration = 0.007, hertz = 3200, kind = 'high', rate = 520 } = {}) =>
  decay(filter(noise(lengthOf(duration), random), kind, hertz, 1.2), rate, 0.0002)

/**
 * Radio. Not speech — an attempt at words would land between wrong and uncanny,
 * and a wrong word is far more distracting than no word. What identifies a
 * radio is the channel, not the sentence: a band with nothing below 300 Hz or
 * above 3 kHz, hard clipping, and a syllable rhythm. Give the ear those three
 * and it supplies "someone said something" by itself.
 *
 * The formant pairs below trace the vowels of the callout, so the rhythm and
 * the shape are right even though there is nothing to mishear.
 */
function radioVoice(random, syllables) {
  const total = 0.66
  const layers = syllables.map(({ at, length, first, second }) => {
    const source = noise(lengthOf(length), random)
    const shaped = new Float32Array(source.length)
    const low = filter(source, 'band', first, 7)
    const high = filter(source, 'band', second, 6)
    for (let i = 0; i < source.length; i++) shaped[i] = low[i] + high[i] * 0.7
    // 135 Hz is a man's voice. Modulating the noise at that rate is what turns
    // a hiss into something with a throat behind it.
    return { buffer: bell(modulate(shaped, 135, 0.85), 0.35), at, gain: 1 }
  })

  // The press and release of the transmit key bracket every real radio call.
  layers.push({ buffer: click(random, { hertz: 1600, rate: 700 }), at: 0, gain: 0.5 })
  layers.push({ buffer: decay(filter(noise(lengthOf(0.05), random), 'band', 2200, 1), 60), at: 0.6, gain: 0.35 })

  const spoken = mix(total, layers)
  const banded = filter(filter(spoken, 'high', 300, 0.9), 'low', 3000, 0.9)
  return hardClip(banded, 0.3)
}

// ------------------------------------------------------------------ the table
// `level` is decibels below the loudest thing in the set, and it is the mix.
// The AWP and the bomb are the top of the scale; footsteps sit fifteen decibels
// under them because a footstep you can hear over a firefight is a footstep
// nobody will ever sneak past; the menu blip is quieter still, because a UI
// noise as loud as a weapon is the fastest way to make a game feel cheap.
const SOUNDS = {}

const add = (name, level, make, fadeSeconds) => { SOUNDS[name] = { level, make, fadeSeconds } }

// --- weapons ---------------------------------------------------------------
add('ak47-fire', -1.5, random => gunshot(random, {
  duration: 0.18, bodyHertz: 370, bodyResonance: 2.6, bodyDecay: 26, bodyGain: 1.25,
  lowHertz: 105, lowDecay: 17, lowGain: 1,
  // Dirty on purpose. The AK's recording is the least polite in the game and
  // the saturation is most of what people mean when they call it "crunchy".
  // The roll-off above it matters as much: saturation invents harmonics all the
  // way up, and left alone they fizz, which drags the weapon's centre of
  // gravity up to meet the M4's and undoes the point of the whole exercise.
  drive: 2.1, muffleHertz: 6500, crackGain: 0.85, tailGain: 0.22, roomDelay: 0.011
}))

add('m4a1-fire', -3, random => gunshot(random, {
  // Tighter and higher than the AK, and it has to be audibly so — telling those
  // two apart in the first quarter second is the single most useful thing a
  // player's ears do in this game.
  duration: 0.16, bodyHertz: 1050, bodyResonance: 2.2, bodyDecay: 38, bodyGain: 1.3,
  lowHertz: 160, lowDecay: 24, lowGain: 0.35,
  drive: 1.15, crackGain: 1, tailGain: 0.14, roomDelay: 0.009
}))

add('m4a1-silenced', -10, random => gunshot(random, {
  duration: 0.13, bodyHertz: 300, bodyResonance: 1.3, bodyDecay: 40,
  lowHertz: 150, lowDecay: 26, lowGain: 1.1,
  crackGain: 0.06, tailGain: 0.05, muffleHertz: 1500
}))

add('awp-fire', 0, random => mix(0.55, [
  { buffer: gunshot(random, {
    duration: 0.55, bodyHertz: 260, bodyResonance: 2.8, bodyDecay: 13,
    lowHertz: 75, lowDecay: 7, lowGain: 1.2,
    // The loudest thing in the game, and the only weapon here given a tail long
    // enough to read as a report rolling away rather than as a room.
    crackGain: 1.2, tailGain: 0.34, tailDecay: 4.5, roomDelay: 0.027, roomFeedback: 0.55,
    drive: 1.6
  }) },
  { buffer: decay(filter(noise(lengthOf(0.4), random), 'low', 220), 5.5, 0.02), at: 0.05, gain: 0.3 }
]))

add('deagle-fire', -2, random => gunshot(random, {
  duration: 0.22, bodyHertz: 700, bodyResonance: 3, bodyDecay: 22,
  lowHertz: 100, lowDecay: 15, lowGain: 0.8,
  // The bark is the crack, not the body: a Deagle is heard as a slap in the
  // face where the AK is heard as a punch in the chest.
  drive: 1.9, crackGain: 1.3, tailGain: 0.2, roomDelay: 0.014
}))

add('glock-fire', -5, random => gunshot(random, {
  duration: 0.10, bodyHertz: 1900, bodyResonance: 2, bodyDecay: 62,
  lowHertz: 230, lowDecay: 40, lowGain: 0.4,
  drive: 1.2, crackGain: 0.9, tailGain: 0.07, tailDecay: 26, roomDelay: 0.006
}))

add('usp-fire', -5.5, random => gunshot(random, {
  duration: 0.11, bodyHertz: 1450, bodyResonance: 2.1, bodyDecay: 52,
  lowHertz: 200, lowDecay: 34, lowGain: 0.5,
  drive: 1.2, crackGain: 0.85, tailGain: 0.08, tailDecay: 22, roomDelay: 0.007
}))

add('usp-silenced', -13, random => mix(0.10, [
  // The famous "pfft" is nearly all air and slide. There is no crack left to
  // hear, which is why it carries so much less far than everything else here.
  { buffer: gunshot(random, {
    duration: 0.09, bodyHertz: 700, bodyResonance: 1.1, bodyDecay: 70,
    lowHertz: 180, lowDecay: 45, lowGain: 0.5,
    crackGain: 0.04, tailGain: 0.03, muffleHertz: 1900
  }) },
  { buffer: click(random, { hertz: 2400, rate: 320 }), at: 0.018, gain: 0.22 }
]))

add('mp5-fire', -4.5, random => mix(0.13, [
  { buffer: gunshot(random, {
    duration: 0.12, bodyHertz: 1100, bodyResonance: 2.3, bodyDecay: 46,
    lowHertz: 170, lowDecay: 30, lowGain: 0.55,
    drive: 1.5, crackGain: 0.9, tailGain: 0.1, tailDecay: 20, roomDelay: 0.008
  }) },
  // The rattle is the bolt, and it is why an MP5 at four hundred rounds a
  // minute sounds mechanical where a rifle sounds explosive.
  { buffer: decay(filter(noise(lengthOf(0.04), random), 'band', 2600, 2), 90), at: 0.012, gain: 0.3 }
]))

add('knife-slash', -12, random => {
  const swipe = filter(
    noise(lengthOf(0.13), random),
    'band',
    // Air over a blade rises as the swing accelerates and falls as it passes.
    position => 600 * Math.pow(4.6, Math.sin(Math.PI * position)),
    1.6
  )
  return bell(swipe, 0.42)
})

add('knife-hit', -7, random => mix(0.16, [
  { buffer: impact(random, {
    duration: 0.16, bodyHertz: 330, bodyResonance: 1.6, bodyDecay: 48,
    crackGain: 0.35, crackHertz: 2600, wetDelay: 0.0035, wetFeedback: 0.55,
    lowGain: 0.8, lowHertz: 95, lowDecay: 30, muffleHertz: 4000
  }) },
  { buffer: bell(filter(noise(lengthOf(0.05), random), 'band', 3200, 1.4), 0.25), gain: 0.2 }
]))

// --- handling --------------------------------------------------------------
add('reload-clipout', -11, random => mix(0.26, [
  { buffer: click(random, { hertz: 2800, rate: 480 }), at: 0.00, gain: 1 },
  { buffer: click(random, { hertz: 1900, rate: 380 }), at: 0.03, gain: 0.6 },
  // The magazine sliding clear: a band walking down as it leaves the well.
  { buffer: decay(filter(noise(lengthOf(0.16), random), 'band', p => 2400 - 1500 * p, 1.3), 13, 0.006), at: 0.06, gain: 0.5 }
]))

add('reload-clipin', -11, random => mix(0.20, [
  { buffer: decay(filter(noise(lengthOf(0.14), random), 'band', p => 1400 - 700 * p, 1.2), 20, 0.004), gain: 0.35 },
  { buffer: click(random, { hertz: 2200, rate: 400 }), at: 0.075, gain: 0.55 },
  // Seating a magazine is a thunk, not a click: the low body is the whole point.
  { buffer: decay(filter(noise(lengthOf(0.10), random), 'band', 190, 1.5), 44), at: 0.075, gain: 1 },
  { buffer: metal(0.06, 620, [1, 2.71, 4.13], 60), at: 0.078, gain: 0.25 }
]))

add('reload-slide', -11, random => mix(0.24, [
  { buffer: click(random, { hertz: 3000, rate: 500 }), at: 0.00, gain: 0.8 },
  { buffer: metal(0.09, 900, [1, 2.43, 3.77, 5.9], 45), at: 0.005, gain: 0.5 },
  { buffer: decay(filter(noise(lengthOf(0.09), random), 'band', 1700, 1.1), 26, 0.004), at: 0.01, gain: 0.4 },
  // The bolt going home is louder than the bolt coming back.
  { buffer: click(random, { hertz: 2600, rate: 420 }), at: 0.105, gain: 1 },
  { buffer: metal(0.10, 740, [1, 2.61, 4.02, 6.3], 38), at: 0.107, gain: 0.6 },
  { buffer: decay(filter(noise(lengthOf(0.08), random), 'band', 260, 1.4), 50), at: 0.107, gain: 0.5 }
]))

add('weapon-deploy', -14, random => mix(0.20, [
  // Cloth first, metal second — the gun comes off the sling before it settles.
  { buffer: bell(filter(noise(lengthOf(0.13), random), 'band', 2100, 0.8), 0.4), gain: 0.7 },
  { buffer: click(random, { hertz: 2400, rate: 460 }), at: 0.075, gain: 0.5 },
  { buffer: metal(0.07, 1100, [1, 2.37, 3.91], 55), at: 0.077, gain: 0.35 }
]))

// --- movement --------------------------------------------------------------
// Four concrete steps that differ in the table rather than only in their seed,
// because a listener notices a repeated rhythm long before a repeated timbre.
const CONCRETE = [
  { gap: 0.010, hertz: 1500, decayRate: 95, weight: 0.35 },
  { gap: 0.014, hertz: 1750, decayRate: 110, weight: 0.28 },
  { gap: 0.008, hertz: 1350, decayRate: 85, weight: 0.42 },
  { gap: 0.017, hertz: 1900, decayRate: 120, weight: 0.24 }
]
CONCRETE.forEach((spec, index) =>
  add(`step-concrete-${index + 1}`, -15, random => footstep(random, spec)))

const DIRT = [
  { gap: 0.013, hertz: 900, decayRate: 55, weight: 0.4, scuff: 0.3, muffleHertz: 1400 },
  { gap: 0.009, hertz: 780, decayRate: 48, weight: 0.45, scuff: 0.38, muffleHertz: 1250 }
]
DIRT.forEach((spec, index) =>
  add(`step-dirt-${index + 1}`, -17, random => footstep(random, spec)))

add('land', -10, random => mix(0.22, [
  { buffer: decay(filter(noise(lengthOf(0.18), random), 'low', 110), 22, 0.002), gain: 1 },
  { buffer: footstep(random, { gap: 0.012, hertz: 1300, decayRate: 70, weight: 0.5, weightHertz: 150 }), gain: 0.55 },
  { buffer: bell(filter(noise(lengthOf(0.12), random), 'band', 1600, 0.8), 0.3), at: 0.02, gain: 0.18 }
]))

add('jump', -18, random =>
  bell(filter(noise(lengthOf(0.09), random), 'band', 2000, 0.7), 0.3))

// --- hits ------------------------------------------------------------------
const FLESH = [
  { bodyHertz: 300, bodyDecay: 62, wetDelay: 0.0040 },
  { bodyHertz: 365, bodyDecay: 74, wetDelay: 0.0034 },
  { bodyHertz: 255, bodyDecay: 56, wetDelay: 0.0046 }
]
FLESH.forEach((spec, index) =>
  add(`hit-flesh-${index + 1}`, -7, random => impact(random, {
    duration: 0.14, bodyResonance: 1.5, crackGain: 0.3, crackHertz: 2400,
    wetFeedback: 0.55, lowGain: 0.7, lowHertz: 110, lowDecay: 38, muffleHertz: 3200,
    ...spec
  })))

add('hit-helmet', -7, random => mix(0.28, [
  { buffer: click(random, { hertz: 4000, rate: 700 }), gain: 0.7 },
  // Kevlar and steel over a head: bright, inharmonic, and gone quickly.
  { buffer: metal(0.26, 2400, [1, 2.31, 3.63, 5.17, 7.4], 20), gain: 1 },
  { buffer: decay(filter(noise(lengthOf(0.06), random), 'band', 900, 1.2), 60), gain: 0.35 }
]))

const WALL = [
  { bodyHertz: 2600, gritHertz: 3400 },
  { bodyHertz: 3100, gritHertz: 4200 },
  { bodyHertz: 2300, gritHertz: 3000 }
]
WALL.forEach((spec, index) =>
  add(`hit-wall-${index + 1}`, -8, random => impact(random, {
    duration: 0.13, bodyResonance: 1.8, bodyDecay: 90,
    crackGain: 1, crackHertz: 3600,
    gritGain: 0.45, lowGain: 0.3, lowHertz: 260, lowDecay: 70,
    ...spec
  })))

const RICOCHETS = [
  { duration: 0.32, fromHertz: 3400, toHertz: 800, wobble: 0.05 },
  { duration: 0.26, fromHertz: 2600, toHertz: 1050, wobble: 0.08 }
]
RICOCHETS.forEach(({ duration, fromHertz, toHertz, wobble }, index) =>
  add(`ricochet-${index + 1}`, -8, random => mix(duration, [
    { buffer: click(random, { hertz: 3800, rate: 800 }), gain: 0.5 },
    // The zing is a sine falling fast. The noise tracking the same glide is
    // what keeps it from sounding like a theremin.
    { buffer: decay(tone(duration, fromHertz, toHertz, wobble), 9, 0.002), gain: 1 },
    { buffer: decay(filter(
      noise(lengthOf(duration), random), 'band',
      position => fromHertz * Math.pow(toHertz / fromHertz, position), 5
    ), 11, 0.002), gain: 0.5 }
  ])))

add('armor-hit', -9, random => impact(random, {
  duration: 0.12, bodyHertz: 480, bodyResonance: 1.2, bodyDecay: 55,
  // No bright transient at all. Kevlar's job is to turn a crack into a thud,
  // and the sound has to tell the player the vest did that.
  crackGain: 0.08, crackHertz: 1800,
  lowGain: 1, lowHertz: 150, lowDecay: 42, muffleHertz: 1800
}))

// --- voices ----------------------------------------------------------------
// "uh" — the formants of an open central vowel, which is what a grunt is.
const GRUNT_FORMANTS = [[640, 1], [1190, 0.55], [2390, 0.2]]

const DEATHS = [
  { duration: 0.42, fromHertz: 150, toHertz: 92, at: 0.72 },
  { duration: 0.36, fromHertz: 128, toHertz: 78, at: 0.68 }
]
DEATHS.forEach(({ duration, fromHertz, toHertz, at }, index) =>
  add(`death-${index + 1}`, -6, random =>
    cutOff(
      decay(bell(voiced(random, { duration, fromHertz, toHertz, formants: GRUNT_FORMANTS, breath: 0.2 }), 0.16), 3),
      at
    )))

const HURTS = [
  { duration: 0.19, fromHertz: 165, toHertz: 130 },
  { duration: 0.16, fromHertz: 150, toHertz: 118 },
  { duration: 0.14, fromHertz: 178, toHertz: 140 }
]
HURTS.forEach(({ duration, fromHertz, toHertz }, index) =>
  add(`hurt-${index + 1}`, -8, random =>
    decay(bell(voiced(random, { duration, fromHertz, toHertz, formants: GRUNT_FORMANTS }), 0.2), 5)))

add('radio-fireinthehole', -6, random => radioVoice(random, [
  { at: 0.02, length: 0.11, first: 720, second: 1250 },  // fi-
  { at: 0.14, length: 0.08, first: 520, second: 1520 },  // -re
  { at: 0.24, length: 0.07, first: 400, second: 2000 },  // in
  { at: 0.33, length: 0.06, first: 500, second: 1400 },  // the
  { at: 0.41, length: 0.17, first: 450, second: 900 }    // hole
]))

// --- the bomb --------------------------------------------------------------
add('bomb-plant', -9, random => mix(0.46, [
  { buffer: click(random, { hertz: 2600, rate: 460 }), at: 0.00, gain: 0.7 },
  { buffer: click(random, { hertz: 3100, rate: 520 }), at: 0.04, gain: 0.5 },
  // A servo is noise chopped at an audible rate. Fifty-five hertz is slow
  // enough to hear as mechanism rather than as pitch.
  { buffer: decay(modulate(filter(noise(lengthOf(0.22), random), 'band', 430, 2), 55, 0.8), 4, 0.01), at: 0.08, gain: 0.55 },
  { buffer: click(random, { hertz: 2200, rate: 400 }), at: 0.33, gain: 0.9 },
  { buffer: metal(0.09, 700, [1, 2.53, 4.11], 42), at: 0.332, gain: 0.5 },
  { buffer: decay(filter(noise(lengthOf(0.08), random), 'band', 200, 1.4), 45), at: 0.332, gain: 0.6 }
]))

add('bomb-beep', -8, () => {
  // A piezo sounder, so a strong fundamental and one octave above it. Nothing
  // else: the beep has to cut through a firefight and stay recognisable at any
  // distance, and any more content than this makes it mushy.
  const first = tone(0.09, 2000)
  const second = tone(0.09, 4000)
  const out = new Float32Array(first.length)
  for (let i = 0; i < first.length; i++) out[i] = first[i] + second[i] * 0.22
  return out
})

add('bomb-defuse', -11, random => {
  // Loopable, so the length holds a whole number of cycles of the 110 Hz motor
  // and the phase at the end lines up with the phase at the start. The fade at
  // the edges is a single millisecond rather than the usual two, which is short
  // enough to be inaudible across the seam but still leaves the file starting
  // and ending on a zero.
  const duration = 1
  const count = lengthOf(duration)
  const motor = filter(saw(duration, 110), 'low', 900, 1.2)
  const cutting = modulate(filter(noise(count, random), 'band', 3000, 1.3), 8, 0.6)
  const scrape = modulate(filter(noise(count, random), 'band', 1400, 2), 23, 0.5)
  const out = new Float32Array(count)
  for (let i = 0; i < count; i++) out[i] = motor[i] * 0.8 + cutting[i] * 0.5 + scrape[i] * 0.3
  return out
}, 0.001)

add('bomb-explode', 0, random => {
  const duration = 2.2
  const count = lengthOf(duration)
  const source = noise(count, random)
  return mix(duration, [
    // The blast wave itself: everything at once for three milliseconds.
    { buffer: decay(source, 300, 0.0002), gain: 1 },
    // The body is a falling low band. A real explosion's pitch drops as the
    // fireball expands, and that drop is what makes it read as enormous
    // rather than as a drum hit.
    { buffer: decay(filter(source, 'band', position => 90 * Math.pow(0.45, position), 1.4), 2.6, 0.004), gain: 1.4 },
    { buffer: decay(filter(source, 'low', 240), 6, 0.002), gain: 0.9 },
    // Then the town answers, twice, from further away each time.
    { buffer: decay(comb(filter(noise(count, random), 'low', 700), 0.045, 0.62), 2.1, 0.03), at: 0.06, gain: 0.4 },
    { buffer: decay(filter(grit(random, 1.2, 0.02), 'band', 2600, 1.5), 3.4, 0.01), at: 0.12, gain: 0.3 }
  ])
})

add('c4-plantstart', -10, random => {
  const layers = []
  // Five presses, unevenly spaced, because a person entering a code does not
  // do it in time.
  const gaps = [0.00, 0.115, 0.245, 0.355, 0.49]
  gaps.forEach((at, index) => {
    layers.push({ buffer: click(random, { hertz: 3400, rate: 620, duration: 0.005 }), at, gain: 0.55 })
    layers.push({ buffer: decay(tone(0.035, 1500 + index * 30), 40, 0.0015), at: at + 0.004, gain: 0.8 })
  })
  return mix(0.62, layers)
})

// --- the round -------------------------------------------------------------
add('round-start', -3, random => {
  const duration = 0.9
  const count = lengthOf(duration)
  // Two notes a fifth apart, each doubled slightly out of tune. The beating
  // between the detuned pairs is what gives a horn its weight; one clean
  // oscillator sounds like a test tone no matter how it is filtered.
  const voices = [[220, 1], [221.4, 0.9], [330, 0.7], [331.8, 0.6], [440, 0.35]]
  const stack = new Float32Array(count)
  for (const [hertz, gain] of voices) {
    const partial = saw(duration, hertz)
    for (let i = 0; i < count; i++) stack[i] += partial[i] * gain
  }
  const horn = filter(stack, 'band', 760, 1.1)
  const air = filter(noise(count, random), 'band', 1800, 0.9)

  const out = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const through = i / count
    // Swell in over forty milliseconds, hold, then stop deliberately. A signal
    // that fades out sounds like an accident; this one has to sound like a cue.
    const swell = Math.min(1, through / 0.045)
    const hold = through < 0.72 ? 1 : Math.max(0, 1 - (through - 0.72) / 0.28)
    out[i] = (horn[i] + air[i] * 0.06) * swell * hold
  }
  // Saturate for the brassy edge, then roll off what the saturation invented.
  // Brass does have strong upper harmonics, but a signal whose loudest region
  // is three kilohertz is a buzzer, and a buzzer does not start a round.
  return filter(saturate(unit(out), 1.5), 'low', 1800)
})

// --- pickups and interface --------------------------------------------------
add('pickup-weapon', -11, random => mix(0.18, [
  { buffer: click(random, { hertz: 3000, rate: 560 }), gain: 0.5 },
  { buffer: metal(0.16, 1750, [1, 2.29, 3.71, 5.44], 26), gain: 1 },
  { buffer: decay(filter(noise(lengthOf(0.07), random), 'band', 240, 1.4), 48), gain: 0.4 }
]))

add('pickup-ammo', -13, random => mix(0.11, [
  { buffer: click(random, { hertz: 4200, rate: 760 }), gain: 0.4 },
  // Lighter than the weapon: higher base, faster decay, and no low thunk under
  // it, so the two are told apart without either needing to be looked at.
  { buffer: metal(0.10, 3000, [1, 2.41, 3.89], 42), gain: 1 }
]))

add('menu-click', -20, () => {
  const first = tone(0.032, 1250)
  const second = tone(0.032, 2500)
  const out = new Float32Array(first.length)
  for (let i = 0; i < first.length; i++) out[i] = first[i] + second[i] * 0.15
  return decay(out, 26, 0.002)
})

// ------------------------------------------------------------------ finishing
/**
 * Block the offset, fade the ends, then set the peak — in that order, because
 * either of the first two done afterwards would undo the third.
 *
 * The offset needs blocking because tanh is an odd function but the waveforms
 * fed to it are not symmetrical, and an odd function applied to a lopsided
 * signal returns one with a standing offset. Nobody hears an offset directly;
 * it simply eats the headroom on one side, so a saturated AK normalises to a
 * quieter shot than an unsaturated one for no reason a reader could see.
 *
 * The fade is the whole reason these do not sound cheap. A file that begins on
 * a sample well away from zero is a step change into the speaker, and a step
 * change is a click on every single play. It is the most common flaw in
 * generated audio and it costs two milliseconds to remove.
 */
function finish(buffer, levelDecibels, fadeSeconds = 0.002) {
  // 25 Hz, which is under everything deliberate here — the lowest thing in the
  // set is the bomb, whose body falls to about 40 Hz.
  const faded = Float32Array.from(filter(buffer, 'high', 25))
  const fade = Math.min(Math.round(fadeSeconds * SAMPLE_RATE), Math.floor(buffer.length / 2))
  for (let i = 0; i < fade; i++) {
    const shape = 0.5 - 0.5 * Math.cos((Math.PI * i) / fade)
    faded[i] *= shape
    faded[faded.length - 1 - i] *= shape
  }

  let loudest = 0
  for (const sample of faded) loudest = Math.max(loudest, Math.abs(sample))
  if (loudest === 0) return faded
  const target = decibelsToGain(REFERENCE_DECIBELS + levelDecibels)
  return faded.map(sample => (sample * target) / loudest)
}

function wav(samples) {
  const count = samples.length
  const buffer = Buffer.alloc(44 + count * 2)

  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + count * 2, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)                 // fmt chunk size
  buffer.writeUInt16LE(1, 20)                  // PCM
  buffer.writeUInt16LE(1, 22)                  // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24)
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28)    // byte rate
  buffer.writeUInt16LE(2, 32)                  // block align
  buffer.writeUInt16LE(16, 34)                 // bits per sample
  buffer.write('data', 36)
  buffer.writeUInt32LE(count * 2, 40)

  for (let i = 0; i < count; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2)
  }
  return buffer
}

/**
 * Read back what was just written and check it. A malformed WAV does not fail
 * loudly — it plays as silence, and silence in a game is indistinguishable from
 * a sound that was never triggered. That failure would be found by a person
 * wondering why the AK is quiet, which is exactly the kind of hunt this engine
 * refuses to hand anybody.
 */
function inspect(file) {
  const buffer = fs.readFileSync(file)
  const problems = []
  const say = (condition, message) => { if (!condition) problems.push(message) }

  say(buffer.length >= 44, 'shorter than a WAV header')
  if (buffer.length < 44) return { problems, first: 0, last: 0 }

  const riffSize = buffer.readUInt32LE(4)
  const dataSize = buffer.readUInt32LE(40)
  say(buffer.toString('ascii', 0, 4) === 'RIFF', 'no RIFF tag')
  say(buffer.toString('ascii', 8, 12) === 'WAVE', 'no WAVE tag')
  say(buffer.toString('ascii', 12, 16) === 'fmt ', 'no fmt chunk')
  say(buffer.toString('ascii', 36, 40) === 'data', 'no data chunk')
  say(buffer.readUInt32LE(16) === 16, 'fmt chunk is not 16 bytes')
  say(buffer.readUInt16LE(20) === 1, 'not uncompressed PCM')
  say(buffer.readUInt16LE(22) === 1, 'not mono')
  say(buffer.readUInt32LE(24) === SAMPLE_RATE, `sample rate is not ${SAMPLE_RATE}`)
  say(buffer.readUInt16LE(34) === 16, 'not 16-bit')
  say(riffSize === buffer.length - 8, `RIFF size ${riffSize} does not match ${buffer.length - 8} bytes of file`)
  say(dataSize === buffer.length - 44, `data size ${dataSize} does not match ${buffer.length - 44} bytes of samples`)
  say(buffer.readUInt32LE(28) === SAMPLE_RATE * 2, 'byte rate disagrees with the format')
  say(buffer.readUInt16LE(32) === 2, 'block align disagrees with the format')
  say(dataSize % 2 === 0, 'data length is not a whole number of samples')

  const count = Math.floor((buffer.length - 44) / 2)
  const first = count ? Math.abs(buffer.readInt16LE(44)) / 32767 : 0
  const last = count ? Math.abs(buffer.readInt16LE(44 + (count - 1) * 2)) / 32767 : 0
  let loudest = 0
  for (let i = 0; i < count; i++) loudest = Math.max(loudest, Math.abs(buffer.readInt16LE(44 + i * 2)) / 32767)

  return { problems, first, last, loudest, count }
}

// ------------------------------------------------------------------ write
fs.mkdirSync(OUTPUT, { recursive: true })

const CLICK_LIMIT = 0.01   // a sample this close to zero cannot be heard as an edge
let worstEdge = { name: '(none)', value: 0 }
let failures = 0

console.log(`${Object.keys(SOUNDS).length} sounds -> ${path.relative(process.cwd(), OUTPUT)}\n`)
console.log(
  'file'.padEnd(26), 'length'.padStart(8), '  rate',
  '  peak'.padEnd(14), 'level'.padEnd(11), 'bytes'
)

for (const [name, { level, make, fadeSeconds }] of Object.entries(SOUNDS)) {
  const file = `${name}.wav`
  const samples = finish(make(randomFor(name)), level, fadeSeconds)
  fs.writeFileSync(path.join(OUTPUT, file), wav(samples))

  const { problems, first, last, loudest, count } = inspect(path.join(OUTPUT, file))
  const edge = Math.max(first, last)
  if (edge > worstEdge.value) worstEdge = { name: file, value: edge }
  if (edge > CLICK_LIMIT) problems.push(`starts or ends at ${edge.toFixed(4)} of full scale`)

  console.log(
    file.padEnd(26),
    `${Math.round((count / SAMPLE_RATE) * 1000)} ms`.padStart(8),
    `${SAMPLE_RATE} Hz`,
    `${gainToDecibels(loudest).toFixed(1)} dBFS`.padStart(12),
    `${level > 0 ? '+' : ''}${level.toFixed(1)} dB`.padStart(10),
    String(44 + count * 2).padStart(7),
    problems.length ? `  BROKEN: ${problems.join('; ')}` : ''
  )
  failures += problems.length
}

console.log(
  `\nloudest edge sample: ${worstEdge.name} at ${worstEdge.value.toFixed(5)} of full scale` +
  ` (anything under ${CLICK_LIMIT} is inaudible as a click)`
)
console.log(`reference peak ${REFERENCE_DECIBELS} dBFS; every level above is measured down from it`)

if (failures) {
  console.error(`\n${failures} problem(s) — the files above marked BROKEN would play as silence or click`)
  process.exit(1)
}
