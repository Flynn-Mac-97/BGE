/**
 * UI Kit audit: accessibility findings for a theme and a component's HTML,
 * with no DOM, so an agent can check a change from a terminal.
 *
 * A finding is `{ rule, severity, message }`; `severity` is `error` (fails
 * WCAG AA) or `warning`. Colours are the theme tokens' plain CSS values:
 * `#rgb`, `#rrggbb`, `rgb()` or `rgba()`. A token with any other value is
 * skipped, since its colour cannot be known here.
 */

const makeFinding = (rule, severity, message) => ({ rule, severity, message })

/** `[red, green, blue, alpha]` from a colour value, channels 0 to 255 and alpha 0 to 1, or null. */
export function colourOf(value) {
  const text = String(value ?? '').trim()
  const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1]
  if (hex) {
    const full = hex.length === 3 ? [...hex].map(digit => digit + digit).join('') : hex
    return [0, 2, 4].map(start => parseInt(full.slice(start, start + 2), 16)).concat(1)
  }
  const channels = text.match(/^rgba?\(([^)]+)\)$/i)?.[1].split(/[\s,/]+/).filter(Boolean).map(Number)
  if (!channels || channels.length < 3 || channels.some(Number.isNaN)) return null
  return [channels[0], channels[1], channels[2], channels[3] ?? 1]
}

/** A colour with alpha, laid over an opaque one. */
const over = ([red, green, blue, alpha], [backRed, backGreen, backBlue]) =>
  [red * alpha + backRed * (1 - alpha), green * alpha + backGreen * (1 - alpha), blue * alpha + backBlue * (1 - alpha), 1]

const channelLight = channel => {
  const share = channel / 255
  return share <= 0.03928 ? share / 12.92 : ((share + 0.055) / 1.055) ** 2.4
}
const lightOf = ([red, green, blue]) => 0.2126 * channelLight(red) + 0.7152 * channelLight(green) + 0.0722 * channelLight(blue)

/** The WCAG contrast ratio of text over a background, both laid over `backdrop`. Null when a colour cannot be read. */
export function contrastOf(text, background, backdrop = '#000000') {
  const [textColour, backColour, baseColour] = [text, background, backdrop].map(colourOf)
  if (!textColour || !backColour || !baseColour) return null
  const back = over(backColour, baseColour)
  const [lighter, darker] = [lightOf(over(textColour, back)), lightOf(back)].sort((first, second) => second - first)
  return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100
}

/**
 * The token pairs that must read, and the least ratio each needs. Text needs
 * 4.5 (WCAG AA); a coloured bar or edge next to the surface needs 3.
 */
const TOKEN_PAIRS = [
  { text: 'ink', background: 'surface', least: 4.5, what: 'body text on a panel' },
  { text: 'quiet', background: 'surface', least: 4.5, what: 'secondary text on a panel' },
  { text: 'on-accent', background: 'accent', least: 4.5, what: 'text on a primary button' },
  { text: 'accent', background: 'surface', least: 3, what: 'the accent (focus ring, fills) against a panel' },
  { text: 'good', background: 'surface', least: 3, what: 'the good colour against a panel' },
  { text: 'danger', background: 'surface', least: 3, what: 'the danger colour against a panel' }
]

/** Contrast findings for a theme's tokens, laid over `backdrop` (the game behind the UI). */
export function auditTokens(tokens, backdrop = '#000000') {
  return TOKEN_PAIRS.flatMap(pair => {
    const ratio = contrastOf(tokens[pair.text], tokens[pair.background], backdrop)
    if (ratio === null || ratio >= pair.least) return []
    return [makeFinding('contrast', 'error', `--ui-${pair.text} on --ui-${pair.background} is ${ratio}:1; ${pair.what} needs ${pair.least}:1`)]
  })
}

const attributeOf = (tagText, name) => tagText.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1]
const textOf = html => html.replace(/<[^>]*aria-hidden="true"[^>]*>[^<]*<\/[^>]+>/g, '').replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/gi, 'x').trim()

/** The elements a person uses, their opening tag and inner HTML: buttons and anything marked as a control. */
const usableElements = html =>
  [...html.matchAll(/<(button|[a-z][a-z0-9-]*(?=[^>]*\sdata-ui-control=))([^>]*)>([\s\S]*?)<\/\1>/g)].map(([, name, attributes, inner]) => ({ name, attributes, inner }))

/** Findings for one piece of UI HTML: controls a screen reader cannot name or a keyboard cannot reach, and images with no alt. */
export function auditHtml(html) {
  const unnamed = usableElements(html)
    .filter(({ attributes, inner }) => !attributeOf(attributes, 'aria-label') && !textOf(inner))
    .map(({ name }) => makeFinding('name', 'error', `a <${name}> control has no text and no aria-label, so a screen reader reads nothing`))
  const unreachable = usableElements(html)
    .filter(({ name, attributes }) => !['button', 'a', 'label', 'input', 'select'].includes(name) && attributeOf(attributes, 'tabindex') === undefined && !/data-passive/.test(attributes))
    .map(({ name }) => makeFinding('keyboard', 'error', `a <${name}> control has no tabindex, so the keyboard cannot reach it; use a <button> or ui-action`))
  const blind = [...html.matchAll(/<img\b([^>]*)>/g)]
    .filter(([, attributes]) => attributeOf(attributes, 'alt') === undefined)
    .map(() => makeFinding('alt', 'error', 'an <img> has no alt; write alt="" for a picture that only decorates'))
  return [...unnamed, ...unreachable, ...blind]
}
