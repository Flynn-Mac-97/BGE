/**
 * Kimodo's node half: make a take from a saved design (designer.js). Only a
 * run in node can start kimodo.cpp, so the browser half answers with the
 * command instead (see `needsNode` in kimodo.js).
 *
 * The design's keys become a constraint file beside the take's stored motion,
 * and `tools/make-rig-clip.mjs` generates and retargets it onto the design's
 * model as `take-<name>`. It takes minutes.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { kimodoRecord } from './designer.js'
import { main as makeRigClip } from '../../../tools/make-rig-clip.mjs'

const FRAMES_PER_SECOND = 30

/**
 * Generate the take for the design stored at `file` (a path in the project).
 * Answers `{ clip, prompt, frames }`: the take's clip, as kimodo.takes names it.
 */
export async function generateDesign(host, file) {
  const design = JSON.parse(fs.readFileSync(path.join(host.project, file), 'utf8'))
  if (!design.prompt?.trim()) throw new Error(`${file}: write a prompt first`)
  const base = JSON.parse(fs.readFileSync(path.join(host.project, 'assets', design.base), 'utf8'))
  const template = base.source?.from ? path.basename(base.source.from) : null
  if (!template) throw new Error(`${design.base} records no stored motion to read the body from; pick a base take made by kimodo`)
  const constraints = path.join(os.tmpdir(), `kimodo-design-${design.name}.json`)
  fs.writeFileSync(constraints, JSON.stringify(kimodoRecord(design, template), null, 2))
  const name = `take-${design.name}`
  const frames = Math.round(design.seconds * FRAMES_PER_SECOND)
  await makeRigClip([
    '--project', host.project, '--onto', design.model, '--prompt', design.prompt, '--name', name,
    '--frames', String(frames), '--seed', String(design.seed ?? 0), '--constraints', constraints,
    ...(design.loop ? [] : ['--once'])
  ])
  const folder = path.basename(design.model, path.extname(design.model))
  return { clip: `motion/${folder}/${name}.json`, prompt: design.prompt, frames }
}
