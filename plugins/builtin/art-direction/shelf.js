/**
 * Where a subject's direction is stored, and which subject a command means.
 *
 * Direction is per SUBJECT, not per game. The world, the effects and the
 * interface are looked at from different distances, answer different questions
 * and need different references, and one shelf holding all three produces
 * agreement between pictures that were never about the same thing.
 */

/** Hand-written art documents this plugin supersedes once a bible exists. */
const LEGACY = ['art-language.md', 'art-bible.md', 'style-guide.md']

export const slug = name => String(name).toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)

export const paths = subject => ({
  brief: `art/${subject}/brief.json`,
  references: `art/${subject}/references.json`,
  rulings: `art/${subject}/rulings.json`,
  bible: `art/${subject}/bible.md`,
  images: `art/${subject}/references`
})

export const readJSON = async (context, path, fallback) => {
  try { return JSON.parse(await context.files.read(path)) } catch { return fallback }
}

/** Every subject this project has opened, read off the directories on disk. */
export async function subjectsIn(context) {
  const tree = await context.files.tree().catch(() => [])
  return [...new Set(tree.map(node => node.path)
    .map(path => path.match(/^art\/([^/]+)\/brief\.json$/)?.[1])
    .filter(Boolean))].sort()
}

/**
 * Which subject a command is about.
 *
 * Named explicitly, or the only one there is. With several open and none named
 * it refuses and lists them: silently answering about the world when the
 * question was about the interface is a wrong answer that reads as a right one.
 */
export async function resolve(context, options = {}) {
  const open = await subjectsIn(context)
  if (options.subject) {
    const wanted = slug(options.subject)
    return { subject: wanted, ...paths(wanted), open, known: open.includes(wanted) }
  }
  if (open.length === 1) return { subject: open[0], ...paths(open[0]), open, known: true }
  return {
    error: open.length
      ? `name a subject: ${open.join(', ')}. Pass {"subject":"<one of these>"}.`
      : 'no subject yet — open one with art.brief \'{"subject":"the world","reads":"...","camera":"..."}\'',
    open
  }
}

/** A reference image path from the checkout root, which is what readImage takes. */
export const fromRoot = (context, where, file) =>
  `${context.editor.projectDirectory}/${file.includes('/') ? file : `${where.images}/${file}`}`

/** Reference images on disk that no entry in this subject's references.json accounts for. */
export async function unregistered(context, where, entries) {
  const tree = await context.files.tree().catch(() => [])
  const known = new Set(entries.map(entry => entry.file))
  return tree
    .map(node => node.path)
    .filter(path => path.startsWith(`${where.images}/`) && /\.(png|jpe?g|webp|gif)$/i.test(path))
    .map(path => path.slice(where.images.length + 1))
    .filter(file => !known.has(file))
}

/** The hand-written document this project had before, if it still has one. */
export async function legacyDocument(context) {
  for (const path of LEGACY) {
    const text = await context.files.read(path).catch(() => null)
    if (text) return { path: `${context.editor.projectDirectory}/${path}`, lines: text.split('\n').length }
  }
  return null
}
