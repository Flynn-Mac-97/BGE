/** The Forge screen: pick WHEN, DO, TO and POWER, see the item it makes and its price, and buy it with Bells. */
import { art } from '../art.js'
import { escape } from '../inspection.js'
import { forgeParts, forgeTargets, forgeCost, forgeName, forgeDescription, forgeLimit, isForgeValid } from './forge.js'

/** A forge draft starts here: a cheap, valid item. */
export const forgeDraft = () => ({ when: 'hit', do: 'poison', to: 'attacker', power: 'spark', art: forgeParts.do.poison.art })

/** The draft after choosing one part, with TO reset when the new parts no longer allow it. */
export function pickForgePart(draft, part, id) {
  if (!forgeParts[part]?.[id]) return draft
  const next = { ...draft, [part]: id }
  if (part === 'do') next.art = forgeParts.do[id].art
  if (!forgeTargets(next.when, next.do).includes(next.to)) next.to = forgeTargets(next.when, next.do)[0]
  return next
}

function partButtons(kit, draft, part, ids) {
  return ids.map(id => kit.button(forgeParts[part][id].label, { action: 'forgePart', value: `${part}:${id}`, class: draft[part] === id ? 'picked' : '' })).join('')
}

/** The whole Forge screen. */
export function forgeView(kit, state) {
  const profile = state.profile, draft = state.forgeDraft
  const cost = forgeCost(draft)
  const isFull = profile.forged.length >= forgeLimit
  const reason = profile.journey ? 'Finish or abandon your run to forge.' : isFull ? `The forge holds ${forgeLimit} items.` : profile.bells < cost ? `You need ${cost - profile.bells} more Bells.` : ''
  const parts = `<h3>WHEN</h3>${partButtons(kit, draft, 'when', Object.keys(forgeParts.when))}<h3>DO</h3>${partButtons(kit, draft, 'do', Object.keys(forgeParts.do))}<h3>TO</h3>${partButtons(kit, draft, 'to', forgeTargets(draft.when, draft.do))}<h3>POWER</h3>${partButtons(kit, draft, 'power', Object.keys(forgeParts.power))}`
  const preview = isForgeValid(draft) ? `<section class="forge-card">${kit.target(art(kit, draft.art, forgeName(draft)), { action: 'forgeArt', attributes: { class: 'forge-art', 'aria-label': 'Change the look' } })}<strong>${escape(forgeName(draft))}</strong><small>1×1 · FORGED</small><p>${escape(forgeDescription(draft))}</p><p class="forge-price">${cost} BELLS</p>${kit.button(reason || `Forge · ${cost} Bells`, { action: 'forgeBuy', isDisabled: Boolean(reason), kind: 'primary' })}<small>Tap the picture to change its look.</small></section>` : ''
  const owned = profile.forged.map(record => `<li class="hub-kit">${art(kit, record.art, forgeName(record))}<span><strong>${escape(forgeName(record))}</strong><br><small>${escape(forgeDescription(record))}</small></span></li>`).join('') || '<li><small>Nothing forged yet.</small></li>'
  return `<main class="tavern-game descent-hub forge-screen"><header><strong>THE FORGE</strong><span>${profile.bells} BELLS · ${profile.forged.length}/${forgeLimit} FORGED</span><div>${kit.button('Back to the Lantern', { action: 'hub' })}</div></header><section class="tavern-story" role="status"><p>${escape(state.forgeNotice || 'Pick a trigger, an effect and a target. Stronger items cost more Bells. Forged items can drop in the Descent and stand on the Duel Pit shelf.')}</p></section><section class="descent-hub-body forge-body"><aside class="forge-parts">${parts}</aside><article>${preview}</article><aside><h2>YOUR FORGED ITEMS</h2><ul class="hub-kit-list forge-list">${owned}</ul></aside></section></main>`
}
