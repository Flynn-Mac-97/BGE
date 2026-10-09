/** The five power families. An item belongs to the first family its tags name; an item that names none has no family. */
export const powerFamilies = {
  combat: { name: 'Combat' },
  growth: { name: 'Growth' },
  scholarship: { name: 'Scholarship' },
  hunger: { name: 'Hunger' },
  scavenging: { name: 'Scavenging' }
}

/** The family id of an item definition, or '' when it has none. */
export const familyOf = definition => definition.tags?.find(tag => powerFamilies[tag]) ?? ''

/** The family's emblem as a small white symbol, or '' for an item with no family. */
export function familyEmblem(kit, definition) {
  const family = familyOf(definition)
  if (!family) return ''
  return `<span class="family-emblem" title="${powerFamilies[family].name} family">${kit.portrait(`ui/families/${family}.png`, { alt: powerFamilies[family].name + ' family' })}</span>`
}

