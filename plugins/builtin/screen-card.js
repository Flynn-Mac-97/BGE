/**
 * Screen Card — the card a game screen offers you a choice on.
 *
 * A card is its own thing rather than a shape somebody assembles out of a panel
 * and four texts: a number you can press, a big glyph, a name, the rank you are
 * taking it to, and one line saying what it does — with a ring around the one
 * that is selected. Every levelling game draws exactly this, and getting the
 * layout right once is worth more than every game getting it slightly wrong.
 *
 *   { card: { number: 1, title: 'Whip', line: 'Strikes ahead of you',
 *             glyph: '⌇', rank: 'Rank 2', tag: 'Weapon' },
 *     at: [0, 0], anchor: 'center', size: [300, 240], selected: true }
 *
 * It is a separate plugin because it is a separate job, and because it is the
 * proof that Screen's vocabulary is open: this file adds an item kind through
 * `screen.painter` and Screen knows nothing about cards.
 */
import { FONT, roundedRect } from './screen.js'

/** Space inside the card's edge. One number, so nothing drifts out of line. */
const PADDING = 22

export default {
  name: 'Screen Card',
  needs: ['Screen'],
  about: 'Adds the card item to Screen — a number, a glyph, a name, a rank and one line.',

  onLoad(context) {
    context.screen.painter('card', {
      draw: drawCard,
      /**
       * What a card reads as. The selected one is marked, because "which is
       * highlighted" is the question a headless run most needs answered.
       */
      describe(item) {
        const card = item.card || {}
        const mark = item.selected ? '> ' : '  '
        const out = [`${mark}${card.number != null ? `${card.number}. ` : ''}${card.title ?? ''}`.trimEnd()]
        for (const line of [].concat(card.line ?? card.lines ?? [])) if (line) out.push(`    ${line}`)
        return out
      }
    })
  }
}

function drawCard(g, item, screen) {
  const card = item.card || {}
  const size = item.size || [300, 240]
  const [x, y] = screen.boxAt(item, size)
  const accent = card.color || screen.palette.accent

  roundedRect(g, x, y, size[0], size[1], item.radius ?? 16)
  g.fillStyle = item.fill || screen.palette.panel
  g.fill()
  // The selected card is ringed in its own colour rather than moved or scaled:
  // a row of cards that jumps as you arrow along it is hard to read a sentence
  // off, and the sentence is the whole point of the card.
  g.strokeStyle = item.selected ? accent : screen.palette.edge
  g.lineWidth = item.selected ? 3 : 2
  g.stroke()

  let cursor = y + PADDING

  if (card.number != null) {
    g.font = `700 15px ${FONT}`
    g.textAlign = 'left'
    g.textBaseline = 'top'
    g.fillStyle = item.selected ? accent : screen.palette.quiet
    g.fillText(String(card.number), x + PADDING, cursor)
  }

  if (card.tag) {
    g.font = `600 13px ${FONT}`
    g.textAlign = 'right'
    g.textBaseline = 'top'
    g.fillStyle = screen.palette.quiet
    g.fillText(String(card.tag), x + size[0] - PADDING, cursor)
  }
  cursor += 26

  g.textAlign = 'center'
  g.textBaseline = 'top'

  if (card.glyph) {
    g.font = `400 46px ${FONT}`
    g.fillStyle = accent
    g.fillText(String(card.glyph), x + size[0] / 2, cursor)
    cursor += 58
  }

  g.font = `700 21px ${FONT}`
  g.fillStyle = screen.palette.ink
  g.fillText(String(card.title ?? ''), x + size[0] / 2, cursor)
  cursor += 30

  if (card.rank) {
    g.font = `600 13px ${FONT}`
    g.fillStyle = accent
    g.fillText(String(card.rank), x + size[0] / 2, cursor)
    cursor += 22
  }

  g.font = `500 15px ${FONT}`
  g.fillStyle = screen.palette.quiet
  for (const line of wrap(g, [].concat(card.line ?? card.lines ?? []), size[0] - PADDING * 2)) {
    g.fillText(line, x + size[0] / 2, cursor)
    cursor += 21
  }
}

/** Break lines that do not fit, so a card written in prose still fits its card. */
function wrap(g, lines, width) {
  const out = []
  for (const line of lines) {
    if (!line) continue
    let current = ''
    for (const word of String(line).split(/\s+/)) {
      const next = current ? `${current} ${word}` : word
      if (current && g.measureText(next).width > width) { out.push(current); current = word }
      else current = next
    }
    if (current) out.push(current)
  }
  return out
}
