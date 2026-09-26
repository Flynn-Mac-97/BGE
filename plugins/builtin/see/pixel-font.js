/**
 * See: a 3 by 5 pixel font, for words on a frame painted in node, where there
 * is no font to draw with. Each glyph is 15 bits, row by row, top first. A
 * letter is drawn in capitals; a character with no glyph is drawn as a space.
 */
import { DIGITS } from './frame-facts.js'

const LETTERS = {
  a: '010101111101101',
  b: '110101110101110',
  c: '011100100100011',
  d: '110101101101110',
  e: '111100110100111',
  f: '111100110100100',
  g: '011100101101011',
  h: '101101111101101',
  i: '111010010010111',
  j: '001001001101010',
  k: '101101110101101',
  l: '100100100100111',
  m: '101111111101101',
  n: '110101101101101',
  o: '010101101101010',
  p: '110101110100100',
  q: '010101101110011',
  r: '110101110101101',
  s: '011100010001110',
  t: '111010010010010',
  u: '101101101101111',
  v: '101101101101010',
  w: '101101111111101',
  x: '101101010101101',
  y: '101101010010010',
  z: '111001010100111',
  '-': '000000111000000',
  '.': '000000000000010',
  ':': '000010000010000',
  ' ': '000000000000000'
}

const GLYPHS = { ...LETTERS, ...Object.fromEntries(DIGITS.map((glyph, digit) => [String(digit), glyph])) }

/**
 * Paint `text` with `paint(x, y)` for every lit pixel, its top-left corner at
 * `left`, `top`, each font pixel `size` pixels square. Answers the width drawn.
 */
export function paintText(text, left, top, size, paint) {
  const characters = String(text).toLowerCase()
  for (let index = 0; index < characters.length; index++) {
    const glyph = GLYPHS[characters[index]] ?? GLYPHS[' ']
    for (let bit = 0; bit < 15; bit++) {
      if (glyph[bit] !== '1') continue
      const x = left + index * 4 * size + (bit % 3) * size
      const y = top + Math.floor(bit / 3) * size
      for (let down = 0; down < size; down++) for (let across = 0; across < size; across++) paint(x + across, y + down)
    }
  }
  return characters.length * 4 * size
}
