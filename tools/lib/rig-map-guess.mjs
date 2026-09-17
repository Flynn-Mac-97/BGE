/**
 * Guess a SOMA-30 bone map from a model's own node names.
 *
 * For a rig no map in `tools/lib/rig-maps` fits. Names are matched by the words
 * rigs use for each body part and a left or right mark, and chains (spine, neck)
 * are ordered by depth. The guess is written as a map file for a person or an
 * agent to check, so it is never silently trusted.
 */

/** SOMA joints a retarget cannot do without. A guess missing one is refused. */
export const REQUIRED = ['Hips', 'Head', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftLeg', 'LeftShin', 'LeftFoot', 'RightLeg', 'RightShin', 'RightFoot']

/** Words for each limb part, tested against a name with its side mark removed. `not` rules out a longer part. */
const PARTS = {
  Shoulder: { words: ['shoulder', 'clavicle', 'collar'] },
  Arm: { words: ['upperarm', 'arm', 'uparm'], not: ['fore', 'lower', 'lo'] },
  ForeArm: { words: ['forearm', 'lowerarm', 'loarm', 'elbow'] },
  Hand: { words: ['hand', 'wrist'], not: ['finger', 'thumb', 'index', 'middle', 'ring', 'pinky', 'palm'] },
  Leg: { words: ['thigh', 'upleg', 'upperleg'] },
  Shin: { words: ['shin', 'calf', 'lowerleg', 'knee', 'leg'], not: ['up', 'upper', 'thigh'] },
  Foot: { words: ['foot', 'ankle'] },
  ToeBase: { words: ['toe', 'ball'], not: ['end', 'tip'] }
}

/** A name in lower case letters only, with common rig prefixes removed. */
const plain = name => name.toLowerCase()
  .replace(/^(mixamorig\d*:|def[-_]|bip\d*[ _]|b[-_]|jnt[-_]|bone[-_]|cc_base_)/, '')
  .replace(/[^a-z0-9.]/g, '')

/** 'Left', 'Right' or null, from marks such as `.L`, `_r`, `Left`, `l_`. */
function sideOf(name) {
  const lower = name.toLowerCase()
  const marked = letter => (letter === 'l' ? /(^|[._\s:-])l($|[._\s\d-])/ : /(^|[._\s:-])r($|[._\s\d-])/).test(lower)
  if (lower.includes('left') || marked('l')) return 'Left'
  if (lower.includes('right') || marked('r')) return 'Right'
  return null
}

/** A name with side marks and digits removed, for matching part words. */
const partText = name => plain(name).replace(/left|right/g, '').replace(/(^|\.)[lr](\.|$)/g, '').replace(/\.?\d+$/, '').replace(/\./g, '')

const isHelper = name => /twist|roll|bend|end$|tip$|_end/i.test(name)
const numbered = name => /[._]\d+$/.test(name)
const withoutNumber = name => name.replace(/[._]\d+$/, '')

/**
 * `{ map, missing }`. `map` is ready to write; `missing` names SOMA joints no
 * node matched. Throws when a required joint is missing.
 */
export function guessMap(model) {
  const depthOf = index => { let depth = 0; for (let at = model[index].parent; at >= 0; at = model[at].parent) depth++; return depth }
  const deformPrefixed = model.some(node => /^def[-_]/i.test(node.name))
  const candidates = model
    .map((node, index) => ({ name: node.name, index, depth: depthOf(index) }))
    .filter(node => !deformPrefixed || /^def[-_]/i.test(node.name))
    .filter(node => !isHelper(node.name))
  // A numbered node is a segment of a limb (upper_arm.001) when its unnumbered
  // name is there too; a spine numbered from the start is a chain, and stays.
  const names = new Set(candidates.map(node => node.name))
  const limbs = candidates.filter(node => !(numbered(node.name) && names.has(withoutNumber(node.name)) && !/spine|neck/i.test(node.name)))

  const chosen = {}
  const pick = (joint, test) => {
    const found = limbs.filter(test).sort((a, b) => a.depth - b.depth)[0]
    if (found) chosen[joint] = found
  }

  pick('Hips', node => !sideOf(node.name) && /^(hips|pelvis|hip)$/.test(partText(node.name)))
  pick('Head', node => !sideOf(node.name) && /^head$/.test(partText(node.name)))
  const byDepth = (a, b) => a.depth - b.depth
  const spine = limbs.filter(node => !sideOf(node.name) && /spine|chest|torso/.test(partText(node.name))).sort(byDepth)
  const necks = limbs.filter(node => !sideOf(node.name) && /neck/.test(partText(node.name))).sort(byDepth)
  if (!chosen.Hips && spine.length) chosen.Hips = spine.shift()
  // One chain from hips to head, as Rigify names it: the last is the head, the two before it the neck.
  if (!chosen.Head && !necks.length && spine.length >= 5) {
    chosen.Head = spine.pop()
    necks.push(...spine.splice(-2))
  }
  if (spine.length) chosen.Spine1 = spine[0]
  if (spine.length > 2) chosen.Spine2 = spine[Math.floor((spine.length - 1) / 2)]
  if (spine.length > 1) chosen.Chest = spine[spine.length - 1]
  if (necks.length) chosen.Neck1 = necks[0]
  if (necks.length > 1) chosen.Neck2 = necks[necks.length - 1]

  for (const side of ['Left', 'Right']) {
    for (const [part, rule] of Object.entries(PARTS)) {
      pick(`${side}${part}`, node => {
        if (sideOf(node.name) !== side) return false
        const text = partText(node.name)
        return rule.words.some(word => text.includes(word)) && !(rule.not || []).some(word => text.includes(word))
      })
    }
  }

  const missing = REQUIRED.filter(joint => !chosen[joint])
  if (missing.length) {
    throw new Error(`could not guess a bone map: no node for ${missing.join(', ')}. Nodes start: ${model.slice(0, 16).map(node => node.name).join(', ')}`)
  }

  const order = ['Hips', 'Spine1', 'Spine2', 'Chest', 'Neck1', 'Neck2', 'Head',
    'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
    'LeftLeg', 'LeftShin', 'LeftFoot', 'LeftToeBase', 'RightLeg', 'RightShin', 'RightFoot', 'RightToeBase']
  const map = { _what: 'Guessed from node names by tools/lib/rig-map-guess.mjs. Check it, then keep or edit it.' }
  for (const joint of order) {
    if (!chosen[joint]) continue
    map[joint] = joint === 'Chest' && chosen.Neck1 ? { node: chosen[joint].name, aim: 'Neck1' } : { node: chosen[joint].name }
  }
  return { map, missing: order.filter(joint => !chosen[joint]) }
}
