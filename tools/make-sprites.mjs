#!/usr/bin/env node
/**
 * Generate the demo project's sprites.
 *
 * The art is text, not binary: a palette and sixteen rows per sprite. That keeps
 * it diffable, editable without a paint program, and legible to an agent that
 * wants to change a colour without opening an image editor. Re-run any time:
 *
 *   node tools/make-sprites.mjs
 *
 * The PNG is written by `tools/lib/texture.mjs`, which every generator shares.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { encodePng } from './lib/texture.mjs'

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../project/assets')

// ------------------------------------------------------------------ the art
// A sprite is either `rows` (one frame) or `frames` (a sheet, laid out left to
// right). Cells are all the same size, which is what lets a type say
// `sprite: { sheet: 'player.png', size: [16, 16] }` and index frames by number.
const SPRITES = {
  player: {
    palette: { '.': null, k: '#23202b', s: '#e9b98d', e: '#23202b', b: '#4a6fa5', d: '#37527c', w: '#f2f2f4' },
    frames: [
      // 0 — idle
      [
        '................',
        '.....kkkkkk.....',
        '....kssssssk....',
        '....kseesseek...',
        '....kssssssk....',
        '....kswwwwsk....',
        '.....kssssk.....',
        '...kkbbbbbbkk...',
        '..kbbbbbbbbbbk..',
        '..kbbbdddddbbk..',
        '..kbbbdddddbbk..',
        '...kbbbbbbbbk...',
        '....bbbb.bbbb...',
        '....kddk.kddk...',
        '....kkkk.kkkk...',
        '................'
      ],
      // 1 — walk, left leg forward
      [
        '................',
        '.....kkkkkk.....',
        '....kssssssk....',
        '....kseesseek...',
        '....kssssssk....',
        '....kswwwwsk....',
        '.....kssssk.....',
        '...kkbbbbbbkk...',
        '..kbbbbbbbbbbk..',
        '..kbbbdddddbbk..',
        '...kbbdddddbbk..',
        '...kbbbbbbbbk...',
        '...bbbb..bbb....',
        '..kddk...kddk...',
        '..kkkk...kkkk...',
        '................'
      ],
      // 2 — walk, right leg forward
      [
        '................',
        '.....kkkkkk.....',
        '....kssssssk....',
        '....kseesseek...',
        '....kssssssk....',
        '....kswwwwsk....',
        '.....kssssk.....',
        '...kkbbbbbbkk...',
        '..kbbbbbbbbbbk..',
        '..kbbbdddddbbk..',
        '..kbbdddddbbk...',
        '...kbbbbbbbbk...',
        '....bbb..bbbb...',
        '...kddk...kddk..',
        '...kkkk...kkkk..',
        '................'
      ],
      // 3 — airborne, legs tucked
      [
        '................',
        '.....kkkkkk.....',
        '....kssssssk....',
        '....kseesseek...',
        '....kssssssk....',
        '....kswwwwsk....',
        '.....kssssk.....',
        '.kkkkbbbbbbkkkk.',
        '.kbbbbbbbbbbbbk.',
        '..kbbbdddddbbk..',
        '..kbbbdddddbbk..',
        '...kbbbbbbbbk...',
        '...kbbbb.bbbbk..',
        '...kddk...kddk..',
        '................',
        '................'
      ]
    ]
  },

  coin: {
    palette: { '.': null, o: '#8a6a1f', g: '#e8c04a', h: '#f7e6a0', w: '#fffdf0' },
    rows: [
      '................',
      '.....oooooo.....',
      '...oohhhhhhoo...',
      '..ohhgggggghho..',
      '.ohhgggggggghho.',
      '.ohgggwwgggggho.',
      'oohggwwgggggghoo',
      'oohggwggggggghoo',
      'oohgggggggggghoo',
      'oohgggggggggghoo',
      '.ohgggggggggggo.',
      '.ohhgggggggggho.',
      '..ohhgggggggho..',
      '...oohhhhhhoo...',
      '.....oooooo.....',
      '................'
    ]
  },

  spike: {
    palette: { '.': null, k: '#2b2f36', m: '#6f7784', h: '#c3cad4' },
    rows: [
      '................',
      '................',
      '................',
      '................',
      '................',
      '.......hh.......',
      '..h...hmmh...h..',
      '.hmh..hmmh..hmh.',
      '.hmh.hmmmmh.hmh.',
      'hmmmhhmmmmhhmmmh',
      'hmmmmmmmmmmmmmmh',
      'kmmmmmmmmmmmmmmk',
      'kkmmmmmmmmmmmmkk',
      'kkkkkkkkkkkkkkkk',
      '................',
      '................'
    ]
  },

  bat: {
    palette: { '.': null, k: '#1e1b26', p: '#6b4f8a', d: '#4a3663', e: '#e0554e' },
    rows: [
      '................',
      '................',
      '..d..........d..',
      '.ddd........ddd.',
      'dddddd.kk.dddddd',
      'ddpppdkkkkdpppdd',
      '.dpppkkeekkpppd.',
      '..dpkkkeekkkpd..',
      '...dkkkkkkkkd...',
      '....kkkkkkkk....',
      '.....kkkkkk.....',
      '......kkkk......',
      '................',
      '................',
      '................',
      '................'
    ]
  },

  // Tileable: the left edge continues the right one and the top the bottom, so
  // `tile` repeats it across a wide platform without a visible seam.
  brick: {
    palette: { '.': null, d: '#332f2a', m: '#6b5f52', l: '#8a7c6b' },
    rows: [
      'dddddddddddddddd',
      'lllllllldlllllll',
      'mmmmmmmmdmmmmmmm',
      'mmmmmmmmdmmmmmmm',
      'mmmmmmmmdmmmmmmm',
      'mmmmmmmmdmmmmmmm',
      'mmmmmmmmdmmmmmmm',
      'mmmmmmmmdmmmmmmm',
      'dddddddddddddddd',
      'dlllllllllllllll',
      'dmmmmmmmmmmmmmmm',
      'dmmmmmmmmmmmmmmm',
      'dmmmmmmmmmmmmmmm',
      'dmmmmmmmmmmmmmmm',
      'dmmmmmmmmmmmmmmm',
      'dmmmmmmmmmmmmmmm'
    ]
  }
}

const rgba = hex => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
  255
]

function render(name, { palette, rows, frames }) {
  const cells = frames || [rows]
  const ch = cells[0].length
  const cw = cells[0][0].length

  cells.forEach((cell, f) => {
    if (cell.length !== ch) throw new Error(`${name}: frame ${f} is ${cell.length} rows, expected ${ch}`)
    cell.forEach((r, i) => {
      if (r.length !== cw) throw new Error(`${name}: frame ${f} row ${i} is ${r.length} wide, expected ${cw}`)
    })
  })

  // Frames lie side by side, so a sheet is one wide image and a single-frame
  // sprite is the same code path with one cell.
  const w = cw * cells.length
  const px = Buffer.alloc(w * ch * 4)

  cells.forEach((cell, f) => {
    cell.forEach((row, y) => {
      [...row].forEach((c, x) => {
        if (!(c in palette)) throw new Error(`${name}: frame ${f} uses "${c}", which is not in the palette`)
        const hex = palette[c]
        if (!hex) return                          // transparent, already zeroed
        px.set(rgba(hex), (y * w + f * cw + x) * 4)
      })
    })
  })

  return { buf: encodePng(w, ch, px), w, h: ch, cells: cells.length, cw }
}

// ------------------------------------------------------------------ write
export function main() {
  fs.mkdirSync(OUT, { recursive: true })
  for (const [name, def] of Object.entries(SPRITES)) {
    const { buf, w, h, cells, cw } = render(name, def)
    fs.writeFileSync(path.join(OUT, `${name}.png`), buf)
    console.log(
      `${name}.png`.padEnd(14),
      `${w}x${h}`.padEnd(9),
      cells > 1 ? `${cells} frames of ${cw}x${h}` : '1 frame',
      `${buf.length}b`
    )
  }
}

// Run when invoked as a script; an import stays side-effect free, so the
// tooling shelf can call main() on demand.
if (typeof process !== 'undefined' && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
