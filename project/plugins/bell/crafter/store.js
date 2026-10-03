/** Local concept library has a separate key from progression; unreadable data is never overwritten. */
import { validateDraft } from './model.js'
export const draftKey = 'black-bell-concepts-v1'
export function draftStore(storage) {
  let blocked = false, warning = ''
  return {
    load() {
      try {
        const text = storage?.getItem(draftKey)
        if (!text) return { version: 1, next: 1, drafts: [] }
        const library = JSON.parse(text)
        if (library.version !== 1 || !Number.isInteger(library.next) || library.next < 1 || !Array.isArray(library.drafts) || library.drafts.length > 50) throw new Error('Invalid library')
        library.drafts = library.drafts.map(validateDraft)
        if (new Set(library.drafts.map(draft => draft.id)).size !== library.drafts.length) throw new Error('Duplicate concept IDs')
        library.next = Math.max(library.next, 1 + Math.max(0, ...library.drafts.map(draft => Number(draft.id.slice(8)))))
        return library
      } catch { blocked = true; warning = 'Saved concepts could not be read. The original data is preserved. Export your work before closing.'; return { version: 1, next: 1, drafts: [] } }
    },
    save(library) {
      if (blocked) return false
      try { if (!storage) throw new Error('No storage'); storage.setItem(draftKey, JSON.stringify(library)); warning = ''; return true }
      catch { warning = 'Device storage is unavailable. Export your concept before closing.'; return false }
    },
    warning: () => warning
  }
}
