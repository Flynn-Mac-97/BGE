/** The five power families. An item belongs to the first family its tags name; an item that names none has no family. */
export const powerFamilies = {
  combat: { name: 'Combat', color: '#6fa8dc' },
  growth: { name: 'Growth', color: '#9bbf4a' },
  scholarship: { name: 'Scholarship', color: '#e3b23c' },
  hunger: { name: 'Hunger', color: '#e0503f' },
  scavenging: { name: 'Scavenging', color: '#d58a4a' }
}

/** The family id of an item definition, or '' when it has none. */
export const familyOf = definition => definition.tags?.find(tag => powerFamilies[tag]) ?? ''

/** The family's emblem in a small disc, or '' for an item with no family. */
export function familyEmblem(kit, definition) {
  const family = familyOf(definition)
  if (!family) return ''
  return `<span class="family-emblem" style="--family:${powerFamilies[family].color}" title="${powerFamilies[family].name} family">${kit.portrait(`ui/families/${family}.png`, { alt: powerFamilies[family].name + ' family' })}</span>`
}

/** A line naming the family, with its emblem and colour, or '' for an item with no family. */
export function familyLabel(kit, definition) {
  const family = familyOf(definition)
  if (!family) return ''
  return `<small class="family-label" style="--family:${powerFamilies[family].color}">${familyEmblem(kit, definition)}${powerFamilies[family].name.toUpperCase()} FAMILY</small>`
}

/** The style attribute fragment that tints an item's frame with its family colour. */
export function familyTint(definition) {
  const family = familyOf(definition)
  return family ? `--family:${powerFamilies[family].color};` : ''
}
