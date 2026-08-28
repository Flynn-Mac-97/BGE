#!/usr/bin/env node
/**
 * Generate the demo project's sounds.
 *
 * Same idea as the sprites: the sound is described, not committed as an opaque
 * blob. A few numbers you can read and change beat a binary you cannot.
 *
 *   node tools/make-sounds.mjs
 *
 * WAV is written by hand — an uncompressed header and PCM samples — so the
 * project keeps zero build dependencies for something this small.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../project/assets')
const RATE = 22050

// ------------------------------------------------------------------ the sounds
// shape: from -> to in Hz over `secs`, with a waveform and a decay curve.
const SOUNDS = {
  jump:  { wave: 'square',   from: 320, to: 720, secs: 0.16, decay: 3.5, gain: 0.25 },
  coin:  { wave: 'square',   from: 880, to: 1320, secs: 0.14, decay: 5, gain: 0.22, steps: 2 },
  hurt:  { wave: 'saw',      from: 420, to: 90,  secs: 0.30, decay: 3, gain: 0.28 },
  land:  { wave: 'noise',    from: 200, to: 80,  secs: 0.09, decay: 12, gain: 0.18 }
}

// ------------------------------------------------------------------ synthesis
function samples({ wave, from, to, secs, decay, gain, steps }) {
  const n = Math.floor(RATE * secs)
  const out = new Float32Array(n)
  let phase = 0

  for (let i = 0; i < n; i++) {
    const t = i / n

    // `steps` quantises the sweep into a little arpeggio — the difference
    // between a coin "ping" and a coin "bloop".
    const stepped = steps ? Math.floor(t * steps) / Math.max(1, steps - 1) : t
    const freq = from + (to - from) * stepped

    phase += (freq * 2 * Math.PI) / RATE
    const env = Math.exp(-decay * t) * gain

    out[i] =
      wave === 'square' ? (Math.sin(phase) >= 0 ? env : -env)
      : wave === 'saw' ? ((phase / Math.PI) % 2 - 1) * env
      : wave === 'noise' ? (hash(i) * 2 - 1) * env
      : Math.sin(phase) * env
  }
  return out
}

/** Deterministic noise — regenerating gives byte-identical files. */
function hash(i) {
  let x = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b)
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35)
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296
}

function wav(float32) {
  const n = float32.length
  const buf = Buffer.alloc(44 + n * 2)

  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + n * 2, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)          // fmt chunk size
  buf.writeUInt16LE(1, 20)           // PCM
  buf.writeUInt16LE(1, 22)           // mono
  buf.writeUInt32LE(RATE, 24)
  buf.writeUInt32LE(RATE * 2, 28)    // byte rate
  buf.writeUInt16LE(2, 32)           // block align
  buf.writeUInt16LE(16, 34)          // bits per sample
  buf.write('data', 36)
  buf.writeUInt32LE(n * 2, 40)

  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, float32[i]))
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2)
  }
  return buf
}

// ------------------------------------------------------------------ write
fs.mkdirSync(OUT, { recursive: true })
for (const [name, def] of Object.entries(SOUNDS)) {
  const buf = wav(samples(def))
  fs.writeFileSync(path.join(OUT, `${name}.wav`), buf)
  console.log(`${name}.wav`.padEnd(12), `${def.secs}s`.padEnd(7), def.wave.padEnd(7), `${buf.length}b`)
}
