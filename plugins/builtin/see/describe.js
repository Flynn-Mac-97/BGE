import { makeProjector } from '../../../engine/camera-project.js'
import { boundsOf, frameSubject } from './frame-facts.js'
import { selectMarks, addHulls, markPalette, addClipping } from './describe-marks.js'
import { rigFacts } from './rig-marks.js'
import { projectEntities, screenCoverage, markedRelations, screenRegions, describeBetween, worldSpans, emptyBands, findSizeOutliers, findStackedEntities } from './describe-facts.js'
export { simplifyHull } from './describe-marks.js'
export { findSizeOutliers, findStackedEntities } from './describe-facts.js'

// Every query and image uses the same facts. No renderer is needed here.
export function describe(context, options = {}) {
  const view = { ...context.view, ...(options.camera || {}) }
  let subject = null
  if (options.subject) {
    subject = context.world.byId(options.subject)
    if (!subject) return { error: `no entity "${options.subject}"` }
    Object.assign(view, frameSubject(subject, boundsOf(subject), options.shot), options.camera || {})
    if (view.mode === 'third-person-still') view.mode = 'perspective'
  }
  const projector = makeProjector(view, context.viewport)

  const { visible, offscreenByType, population } = projectEntities(context, options, subject, view, projector)

  const marked = selectMarks(visible, population, subject)
  addHulls(marked, projector)
  const { markedTypes, palette } = markPalette(visible, marked)

  const coverage = screenCoverage(visible)

  const { overlaps, occlusions } = markedRelations(marked)

  const regions = screenRegions(visible)

  // Cut belongs to every visible entity, not only the marked few: the frame
  // answer reports a share for each entity it lists.
  addClipping(visible)

  const between = describeBetween(context, options, projector)

  const verticalSpan = worldSpans(context, options)

  const heightGaps = emptyBands(verticalSpan)

  const sizeOutliers = findSizeOutliers(context, options)
  const stackedEntities = findStackedEntities(context, options)

  // `_share` stays: a caller measuring one subject reads the same share the
  // frame answer used. The hull and world box were only inputs to those facts.
  for (const entry of visible) {
    delete entry._world
    delete entry._coverage
    delete entry._hull
  }

  const listed = options.brief ? visible.filter(entry => entry.mark) : visible
  const rigs = options.rig ? rigFacts(context, options, projector) : []

  return {
    ...(options.brief ? { brief: true, listedOnlyMarked: true } : {}),
    project: context.editor?.projectName,
    level: context.editor?.levelName,
    camera: {
      mode: projector.mode, x: round(view.x), y: round(view.y), z: round(view.z || 0),
      yaw: round(view.yaw || 0), pitch: round(view.pitch || 0),
      ...(projector.mode === 'ortho' ? { zoom: view.zoom } : { fov: view.fov || 90 })
    },
    viewport: { ...context.viewport },
    visible: listed,
    ...(options.rig ? { rigs } : {}),
    counts: {
      visible: visible.length,
      offscreen: Object.values(offscreenByType).reduce((sum, n) => sum + n, 0),
      offscreenByType
    },
    coverage,
    verticalSpan,
    ...(heightGaps.length ? { heightGaps } : {}),
    ...(sizeOutliers.length ? { sizeOutliers } : {}),
    ...(stackedEntities.length ? { stackedEntities } : {}),
    palette,
    ...(options.about === false ? {} : aboutTypes(context, markedTypes)),
    overlaps,
    occlusions,
    regions,
    ...(between ? { between } : {})
  }
}

export function aboutTypes(context, typeNames) {
  const about = {}
  const undescribed = []
  for (const type of [...new Set(typeNames)].sort()) {
    const written = context.world.types.get(type)?.about
    if (written) about[type] = written
    else undescribed.push(type)
  }
  return { about, ...(undescribed.length ? { undescribed } : {}) }
}

const round = n => Math.round(n * 100) / 100
