/**
 * Art Direction — reference, measurement and ruling, so an art rule can be checked.
 *
 * An art document written from nothing is one agent's taste in the shape of a
 * law. Nothing sourced it and nothing can test it, so it drifts: the game stops
 * obeying it and the document goes on claiming otherwise, and no command
 * anywhere reports the gap.
 *
 * This closes it by making a rule carry its evidence. A ruling names the
 * references it came from, the field it is measured on, and the bound it sets.
 * `art.check` then measures a real frame with the code that measured the
 * references and reports every ruling the game breaks.
 *
 * Rules that no number decides — does the silhouette read, is the composition
 * any good — are tagged `judged` and are never scored. They are checked with
 * `art.compare`, a sheet of one reference beside one frame, which is the only
 * question this engine trusts a vision model with. A third kind, `derived`,
 * follows by arithmetic from the camera or the screen and holds whatever the
 * style is.
 *
 * Direction is per SUBJECT, not per game — the world, the effects and the
 * interface each own a directory under `<project>/art/`. `art-direction/shelf.js`
 * holds that layout and decides which subject a command means.
 *
 * The reference images are put there by an agent that searched, or by a person
 * with a folder. This plugin never reaches the network: searching is the
 * agent's job and downloading is an approval a plugin must not take on itself.
 */
import { readImage, composePair, writeImage } from './art-direction/image.js'
import { measureImage, agreement, judge } from './art-direction/measure.js'
import { renderBible } from './art-direction/bible.js'
import {
  slug, paths, readJSON, subjectsIn, resolve, fromRoot, unregistered, legacyDocument
} from './art-direction/shelf.js'

/**
 * How a ruling is settled. The three are not interchangeable, and mislabelling
 * one is the failure this plugin exists to prevent.
 *
 *   measured  a field and a bound. `art.check` tests it against a frame.
 *   judged    no number decides it. `art.compare` and an eye.
 *   derived   it follows by arithmetic from a stated fact — the camera pitch,
 *             the screen size, the unit scale. Its `why` IS the proof, so it is
 *             required, and it holds whatever the style is.
 */
const KINDS = ['measured', 'judged', 'derived']

/**
 * Measure one reference and keep the facts on its entry.
 *
 * The facts are stored rather than recomputed because a ruling quotes numbers
 * from them, and a reference file that changes under a ruling has to be visible
 * as a change. `measuredBy` records which decoder answered: the browser reads
 * any format and node reads PNG, and the two must never be silently mixed up.
 */
async function measureReference(context, where, entry) {
  try {
    const image = await readImage(fromRoot(context, where, entry.file))
    entry.facts = measureImage(image)
    entry.measuredBy = image.how
    delete entry.error
  } catch (error) {
    entry.error = String(error?.message || error)
    delete entry.facts
  }
  return entry
}

const countKinds = rulings =>
  Object.fromEntries(KINDS.map(kind => [kind, rulings.filter(entry => entry.check === kind).length]))

export default {
  name: 'Art Direction',
  about: 'Gathers visual references per subject — the world, the effects, the interface — measures '
    + 'them, and turns what they agree on into rulings a frame can be checked against. Each '
    + 'subject\'s art bible is generated from that evidence, never typed.',

  commands: [
    {
      id: 'art.brief',
      label: 'Open a subject, or read what one is for',
      run: async (context, options = {}) => {
        if (options.subject && (options.reads || options.camera || options.questions)) {
          const subject = slug(options.subject)
          const where = paths(subject)
          const merged = { ...(await readJSON(context, where.brief, {})), ...options }
          await context.files.writeJSON(where.brief, merged)
          return { written: where.brief, subject, brief: merged }
        }
        const where = await resolve(context, options)
        if (where.error) return { error: where.error, subjects: where.open }
        const brief = await readJSON(context, where.brief, {})
        return Object.keys(brief).length
          ? { subject: where.subject, brief, subjects: where.open }
          : { subject: where.subject, brief: null, subjects: where.open }
      }
    },

    {
      id: 'art.reference',
      label: 'List a subject\'s references, or put one on its shelf',
      run: async (context, options = {}) => {
        const where = await resolve(context, options)
        if (where.error) return { error: where.error, subjects: where.open }
        const entries = await readJSON(context, where.references, [])
        if (!options.file) {
          return {
            subject: where.subject,
            references: entries.map(({ facts, ...rest }) => ({ ...rest, measured: !!facts })),
            // A file nobody registered answers no question, so nothing may cite it.
            unregistered: await unregistered(context, where, entries),
            add: 'art.reference \'{"subject":"...","file":"x.png","source":"<url>","answers":"<the question it settles>"}\''
          }
        }
        if (!options.answers) {
          return { error: 'a reference needs `answers` — the question it settles. One that answers nothing is decoration.' }
        }
        const file = String(options.file).replace(/^.*\//, '')
        const entry = await measureReference(context, where, {
          file, source: options.source || null, answers: options.answers
        })
        await context.files.writeJSON(where.references,
          entries.filter(other => other.file !== file).concat(entry))
        return { subject: where.subject, added: file, measuredBy: entry.measuredBy || null, facts: entry.facts || null, error: entry.error }
      }
    },

    {
      id: 'art.measure',
      label: 'Measure a subject\'s references and report what they agree on',
      run: async (context, options = {}) => {
        const where = await resolve(context, options)
        if (where.error) return { error: where.error, subjects: where.open }
        const entries = await readJSON(context, where.references, [])
        if (!entries.length) return { error: `no references for ${where.subject} yet — add one with art.reference` }
        const wanted = options.file ? entries.filter(entry => entry.file === options.file) : entries
        for (const entry of wanted) await measureReference(context, where, entry)
        await context.files.writeJSON(where.references, entries)
        return {
          subject: where.subject,
          measured: wanted.map(entry => ({ file: entry.file, facts: entry.facts, error: entry.error })),
          ...agreement(entries),
          next: 'turn an agreed field into a ruling with art.rule'
        }
      }
    },

    {
      id: 'art.rule',
      label: 'List a subject\'s rulings, or write one',
      run: async (context, options = {}) => {
        const where = await resolve(context, options)
        if (where.error) return { error: where.error, subjects: where.open }
        const rulings = await readJSON(context, where.rulings, [])
        if (!options.id) {
          return {
            subject: where.subject,
            rulings,
            counts: countKinds(rulings),
            kinds: KINDS,
            add: 'art.rule \'{"subject":"...","id":"arena-stays-quiet","says":"...","check":"measured",'
              + '"field":"saturation.p95","wants":{"max":0.45},"from":["x.png"],"why":"..."}\''
          }
        }
        if (!options.says) return { error: 'a ruling needs `says` — the rule in one sentence' }
        const check = KINDS.includes(options.check) ? options.check : 'judged'
        if (check === 'measured' && !options.field) {
          return { error: 'a measured ruling needs `field` — the measurement it is decided by. '
            + 'Run art.measure to see the field names. With no field it is `judged`.' }
        }
        if (check === 'derived' && !options.why) {
          return { error: 'a derived ruling needs `why` — the fact it follows from. '
            + 'Without the derivation it is someone\'s preference wearing a proof.' }
        }
        const ruling = {
          id: options.id,
          says: options.says,
          why: options.why || null,
          check,
          field: check === 'measured' ? options.field : null,
          wants: check === 'measured' ? (options.wants || {}) : null,
          // Where a derived rule is actually enforced, when something enforces it.
          enforcedBy: options.enforcedBy || null,
          from: options.from || []
        }
        await context.files.writeJSON(where.rulings,
          rulings.filter(other => other.id !== ruling.id).concat(ruling))
        return { subject: where.subject, written: where.rulings, ruling }
      }
    },

    {
      id: 'art.check',
      label: 'Measure a frame and test a subject\'s measured rulings against it',
      run: async (context, options = {}) => {
        const where = await resolve(context, options)
        if (where.error) return { error: where.error, subjects: where.open }
        if (!options.frame) {
          return { error: 'name a frame: art.check \'{"frame":"agent-runs/see/look.png"}\'. '
            + 'Write one first with see.capture.' }
        }
        const rulings = await readJSON(context, where.rulings, [])
        if (!rulings.length) return { error: `no rulings for ${where.subject} yet — nothing to check against` }

        let image
        try { image = await readImage(options.frame) } catch (error) { return { error: String(error?.message || error) } }
        const facts = measureImage(image)
        const measured = rulings.filter(entry => entry.check === 'measured').map(entry => judge(entry, facts))

        return {
          subject: where.subject,
          frame: options.frame,
          measuredBy: image.how,
          facts,
          broken: measured.filter(entry => !entry.ok),
          held: measured.filter(entry => entry.ok).map(entry => entry.id),
          // Named, never scored. A ruling no frame decides, reported as passing,
          // would be a measurement nobody took.
          judged: rulings.filter(entry => entry.check === 'judged')
            .map(entry => ({ id: entry.id, says: entry.says, check: 'run art.compare and read the sheet' })),
          derived: rulings.filter(entry => entry.check === 'derived')
            .map(entry => ({ id: entry.id, says: entry.says, check: entry.enforcedBy || 'no automatic check' }))
        }
      }
    },

    {
      id: 'art.compare',
      label: 'One reference beside one frame, same height, no marks',
      run: async (context, options = {}) => {
        const where = await resolve(context, options)
        if (where.error) return { error: where.error, subjects: where.open }
        if (!options.reference || !options.frame) {
          return { error: 'art.compare \'{"reference":"x.png","frame":"agent-runs/see/look.png"}\'' }
        }
        const entries = await readJSON(context, where.references, [])
        let reference
        let frame
        try {
          reference = await readImage(fromRoot(context, where, options.reference))
          frame = await readImage(options.frame)
        } catch (error) { return { error: String(error?.message || error) } }

        const written = await writeImage(options.name || `compare-${where.subject}`,
          composePair({ image: reference }, { image: frame }))
        return {
          ...written,
          subject: where.subject,
          left: `reference ${options.reference}`,
          right: `game frame ${options.frame}`,
          answers: entries.find(other => other.file === options.reference)?.answers || null,
          // Unmarked on purpose: an outline drawn on a frame lifts a vision
          // model's opinion of it, and this sheet exists to be judged.
          ask: 'Ask one forced choice against this sheet, then ask it again with the sides swapped. '
            + 'A flipped answer means the two are the same.'
        }
      }
    },

    {
      id: 'art.bible',
      label: 'Write a subject\'s art bible from its brief, references and rulings',
      run: async (context, options = {}) => {
        const where = await resolve(context, options)
        if (where.error) return { error: where.error, subjects: where.open }
        const [brief, references, rulings] = await Promise.all([
          readJSON(context, where.brief, {}),
          readJSON(context, where.references, []),
          readJSON(context, where.rulings, [])
        ])
        const text = renderBible({
          brief, references, rulings,
          agreed: agreement(references),
          legacy: await legacyDocument(context),
          siblings: where.open.filter(other => other !== where.subject)
        })
        await context.files.write(where.bible, text)
        return {
          subject: where.subject,
          written: `${context.editor.projectDirectory}/${where.bible}`,
          references: references.length,
          rulings: countKinds(rulings),
          lines: text.split('\n').length
        }
      }
    },

    {
      id: 'art.status',
      label: 'Every subject, and where each one is in the loop',
      run: async context => {
        const open = await subjectsIn(context)
        const subjects = []
        for (const subject of open) {
          const where = paths(subject)
          const [brief, references, rulings] = await Promise.all([
            readJSON(context, where.brief, {}),
            readJSON(context, where.references, []),
            readJSON(context, where.rulings, [])
          ])
          const measured = references.filter(entry => entry.facts)
          const steps = [
            ['brief', !!brief.subject, `art.brief '{"subject":"${subject}","reads":"...","camera":"..."}'`],
            ['references', references.length >= 3, `art.reference — three at least, or agreement means nothing`],
            ['measured', references.length > 0 && measured.length === references.length, `art.measure '{"subject":"${subject}"}'`],
            ['rulings', rulings.length > 0, `art.rule '{"subject":"${subject}",...}'`],
            ['bible', !!(await context.files.read(where.bible).catch(() => null)), `art.bible '{"subject":"${subject}"}'`]
          ]
          const next = steps.find(([, done]) => !done)
          subjects.push({
            subject,
            done: steps.filter(([, ok]) => ok).map(([step]) => step),
            next: next ? { step: next[0], run: next[2] } : null,
            references: references.length,
            measured: measured.length,
            rulings: countKinds(rulings),
            unregistered: await unregistered(context, where, references)
          })
        }
        return {
          subjects,
          // Named so a stale hand-written document is never mistaken for the
          // authority once a generated bible exists beside it.
          legacy: await legacyDocument(context),
          open: 'art.brief \'{"subject":"the interface","reads":"...","camera":"..."}\''
        }
      }
    }
  ]
}
