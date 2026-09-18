/**
 * Kernel: a colour a look plugin accepts, or the fallback — said out loud either
 * way.
 *
 * Skybox and World Look both read colours from a level, and both used to carry
 * this reader and the two hundred CSS colour names behind it. A mistyped colour
 * is precisely the failure this engine refuses to allow: the sky goes wrong, the
 * log stays empty, and the author reads their own file three times looking for
 * the missing hash.
 *
 * Three's Color accepts a hex value or one of the CSS names, and nothing else.
 * The test here used to be "a word of letters", which let `purpleish` straight
 * through to a renderer that then rejected it. That is the precise failure this
 * exists to prevent, so the list is written out.
 */
const COLOUR_NAMES = new Set(('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond ' +
  'blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan ' +
  'darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange ' +
  'darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet ' +
  'deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite ' +
  'gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush ' +
  'lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey ' +
  'lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime ' +
  'limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen ' +
  'mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin ' +
  'navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise ' +
  'palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue ' +
  'saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow ' +
  'springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen').split(' '))

/**
 * A colour the renderer can take, or the fallback. `label` names the plugin in
 * the warning, so a level author is told which file to look in.
 */
export function lookColour(value, fallback, what, say, label) {
  if (value == null) return fallback
  if (typeof value === 'number') return value
  const text = String(value).trim()
  if (/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(text)) return text
  if (COLOUR_NAMES.has(text.toLowerCase())) return text
  say(`[${label}] "${text}" is not a colour the ${what} can use — it is neither a #hex value nor one of the CSS colour names — falling back to ${fallback}`)
  return fallback
}
