// Ledger text is evidence to review, never a command to execute.
export function evolutionBrief(painpoints, insights, query = '') {
  const records = [
    ...painpoints.map(record => ({ ...record, source: 'pain' })),
    ...insights.map(record => ({ ...record, source: 'insight' }))
  ]
  const search = query.trim().toLowerCase()
  const explicit = /^[pi]\d+$/.test(search)
  const open = records.filter(record => !record.resolved && !record.adopted)
  if (explicit) {
    const found = records.find(record => record.id === search)
    if (!found) throw new Error(`No ledger item ${search}`)
    if (found.resolved || found.adopted) throw new Error(`${search} is already closed; verify its recorded outcome before proposing more work`)
  }
  const matches = open.filter(record => {
    if (explicit) return record.id === search
    const text = [record.what, record.problem, record.where, record.fix, record.tool,
      record.repro, record.expected, record.actual].filter(Boolean).join(' ').toLowerCase()
    return search.split(/\s+/).every(word => text.includes(word))
  }).sort((one, other) => String(other.at || '').localeCompare(String(one.at || '')) || one.id.localeCompare(other.id))
  if (!matches.length) return { status: 'empty', query: search, matched: 0, item: null }
  const item = matches[0]
  return {
    status: 'review', verified: false,
    authority: {
      direct: 'Small, compatible engine fixes and improvements needed by the game task, with regression checks and guide updates.',
      ask: 'Breaking changes, new dependencies, data migrations, broad redesigns, or destructive and external actions.'
    },
    selection: { query: search, matched: matches.length, rule: explicit ? 'explicit id' : 'newest matching open record; not a priority score' },
    item,
    guide: 'docs/evolution.md',
    review: [
      'Reproduce against current code. Record expected and actual results; inspect ledger commands before running them.',
      'If already fixed, cite the current check and close the stale item. If not reproducible, leave it open and report what is missing.',
      'Choose game code, an existing guide/tool, or an engine fix. Make small compatible improvements directly; ask for changes outside authority.direct.',
      'Name the actual files in prepare.request and use agent.prepare. Use a separate worktree when another writer is active.'
    ],
    prepare: {
      op: 'agent.prepare', id: `evolve-${item.id}`,
      request: { task: `Resolve ${item.id}: ${item.what}. Reproduce first; change code, regression check and owning guide together; retry the original game task.`, files: [] }
    },
    acceptance: [
      'A reproduction and regression check that fails before and passes after, or a verified documentation example.',
      'Required packet checks pass; the original game task works without the workaround.',
      'Update the owning guide, regenerate derived instructions, and remove obsolete advice or workarounds.',
      'Release and merge through the existing workspace workflow. Close the item only after the change lands.'
    ],
    close: { op: item.source === 'pain' ? 'pain.resolve' : 'insight.adopt', id: item.id,
      noteRequired: 'Landed change, reproduction, check result, original task result, and guide path.' }
  }
}
