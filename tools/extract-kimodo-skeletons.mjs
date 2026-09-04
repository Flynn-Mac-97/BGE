#!/usr/bin/env node
/**
 * Read the skeleton tables out of kimodo.cpp and write them as JSON.
 *
 *   node tools/extract-kimodo-skeletons.mjs
 *
 * `tools/lib/skeletons.json` holds a joint name, a parent index and a bind-pose
 * offset for every joint of every skeleton kimodo emits. Extracted rather than
 * copied by hand: the order is the order of the raw rotation buffer, so one
 * transposed row poses the wrong limb and nothing reports it.
 *
 * Reads `src/skeleton.hpp` under KIMODO_HOME. The JSON is committed, so nothing
 * that uses it needs kimodo installed — only regenerating does.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const CHECKOUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HOME = process.env.KIMODO_HOME || path.resolve(CHECKOUT, '..', 'kimodo.cpp')
const OUT = path.join(CHECKOUT, 'tools', 'lib', 'skeletons.json')

/** Our name for each skeleton, and the C++ prefix its three arrays share. */
const WANTED = [
  ['smplx-22', 'smplx22'],
  ['soma-30', 'soma30'],
  ['g1-34', 'g1skel34']
]

const between = (text, start, end) => text.split(start)[1].split(end)[0]

export function main() {
  const header = path.join(HOME, 'src', 'skeleton.hpp')
  if (!fs.existsSync(header)) throw new Error(`no ${header} — run node tools/install-kimodo.mjs`)
  // Comments hold braces and quotes of their own, so they go first.
  const source = fs.readFileSync(header, 'utf8').replace(/\/\/[^\n]*/g, '')

  const skeletons = {}
  for (const [name, prefix] of WANTED) {
    const names = [...between(source, `${prefix}_names{`, '};').matchAll(/"([^"]+)"/g)].map(match => match[1])
    const parents = between(source, `${prefix}_parents{`, '}').split(',').map(Number)
    const offsets = [...between(source, `${prefix}_offsets{{`, '};').matchAll(/\{([^{}]+)\}/g)]
      // The literals carry a float suffix C++ needs and JSON does not.
      .map(match => match[1].split(',').map(value => Number(Number(value.replace(/F/g, '')).toFixed(6))))

    if (names.length !== parents.length || names.length !== offsets.length) {
      throw new Error(`${name}: ${names.length} names, ${parents.length} parents, ${offsets.length} offsets`)
    }
    skeletons[name] = { names, parents, offsets }
    console.log(`${name.padEnd(9)} ${names.length} joints`)
  }

  fs.writeFileSync(OUT, JSON.stringify(skeletons, null, 1) + '\n')
  console.log(`\n${path.relative(CHECKOUT, OUT).replaceAll('\\', '/')}`)
  return skeletons
}

if (typeof process !== 'undefined' && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main() } catch (error) { console.error(error.message); process.exit(1) }
}
