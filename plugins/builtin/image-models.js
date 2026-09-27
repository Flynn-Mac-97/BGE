/**
 * Image Models — run an image model on a picture in the project and keep
 * what it makes. A simple harness: each model is a program in its own Python
 * environment, run through one adapter script (image-models/models.mjs), and
 * a pose model's answer is stored as one pose record shape
 * (image-models/pose-record.js) in `assets/poses/`. SAM 3D Body is the first.
 *
 *   run image.models                                     every model, and whether it is installed
 *   run image.run '{"model":"sam-3d-body","image":"assets/images/lunge.jpg"}'
 *   run image.poses                                      the pose records made so far
 */
import { runHeadless } from '../../engine/headless-job.js'

/** The node half, loaded only where a program can be started. */
const nodeHalf = () => import('./image-models/models.mjs')

const IMAGE_FILE = /^assets\/.+\.(png|jpe?g|webp)$/i
const POSE_FILE = /^assets\/poses\/.+\.json$/

/** What the panel shows. Read by image.models and the file tree, never by a draw. */
const state = {
  isOpen: false,
  hasRead: false,
  models: [],
  images: [],
  poses: [],
  image: null,
  model: null,
  isRunning: false,
  note: null
}

/** Read the models, images and pose records again, then redraw. */
async function readPanel(context) {
  const paths = (await context.files.tree()).map(item => item.path)
  state.images = paths.filter(file => IMAGE_FILE.test(file))
  state.poses = paths.filter(file => POSE_FILE.test(file))
  state.image ??= state.images[0] ?? null
  context.redraw?.()
  state.models = await context.run('image.models')
  state.model ??= state.models.find(entry => entry.isInstalled)?.id ?? state.models[0]?.id ?? null
  context.redraw?.()
}

/** Run the chosen model on the chosen image; the answer or the failure is shown on the panel. */
async function runFromPanel(context) {
  state.isRunning = true
  state.note = `Running ${state.model} on ${state.image}. The first run loads the model and takes a while.`
  context.redraw?.()
  try {
    const done = await context.run('image.run', { model: state.model, image: state.image })
    state.note = `Wrote ${done.file}: ${done.people} ${done.people === 1 ? 'person' : 'people'}.`
    await readPanel(context)
  } catch (error) {
    state.note = String(error?.message || error)
  } finally {
    state.isRunning = false
    context.redraw?.()
  }
}

function panel(ui, context) {
  if (!state.hasRead) {
    state.hasRead = true
    queueMicrotask(() => readPanel(context).catch(error => (state.note = String(error?.message || error))))
  }
  const chosen = state.models.find(entry => entry.id === state.model)
  return ui.stack(
    [
      ui.select({
        k: 'image',
        options: state.images.length ? state.images : [{ value: '', label: 'no images under assets/' }],
        value: state.image ?? '',
        onChange: file => {
          state.image = file || null
        }
      }),
      ...(state.image ? [ui.preview(state.image.replace(/^assets\//, ''))] : []),
      ui.select({
        k: 'model',
        options: state.models.map(entry => ({
          value: entry.id,
          label: `${entry.id}${entry.isInstalled ? '' : ' (not installed)'}`
        })),
        value: state.model ?? '',
        onChange: id => {
          state.model = id
        }
      }),
      ...(chosen ? [ui.text(chosen.about, { dim: true })] : []),
      ...(chosen && !chosen.isInstalled
        ? [ui.text('To install:', { dim: true }), ...chosen.install.map(step => ui.text(step, { dim: true }))]
        : []),
      ui.button(state.isRunning ? 'Running…' : 'Run', () => runFromPanel(context), {
        primary: Boolean(chosen?.isInstalled && state.image && !state.isRunning)
      }),
      ...(state.note ? [ui.text(state.note, { dim: true })] : []),
      ui.fold('Poses', state.poses.length ? state.poses.map(file => ui.label(file)) : [ui.text('none yet', { dim: true })], {
        meta: String(state.poses.length)
      })
    ],
    { pad: true }
  )
}

/** The Image Models plugin: the IMAGES panel and the image.* commands. */
export default {
  name: 'Image Models',
  category: 'editor',
  about: 'Run an image model, such as SAM 3D Body, on a picture and keep the pose it finds.',

  menus: [
    {
      id: 'image.board',
      label: 'IMAGES',
      title: 'Run an image model on a picture',
      on: () => state.isOpen,
      run: context => context.run('image.panel')
    }
  ],

  panels: [
    {
      id: 'image-models',
      title: 'Image Models',
      dock: 'centre',
      order: 7,
      when: () => state.isOpen,
      actions: [{ label: 'Read', run: context => readPanel(context) }],
      render: panel
    }
  ],

  commands: [
    {
      id: 'image.panel',
      label: 'Show or hide the Image Models panel',
      run: context => {
        if (!context.shell) return { open: false, why: 'this is a headless world — there is no panel' }
        state.isOpen = !state.isOpen
        context.redraw()
        return { open: state.isOpen }
      }
    },
    {
      id: 'image.models',
      label: 'Image models, and which are installed',
      // Answers [{ id, about, makes, isInstalled, install }]; looking for a model needs node.
      run: async context =>
        context.host ? (await nodeHalf()).imageModels(context.host.checkout) : runHeadless('image.models')
    },
    {
      id: 'image.run',
      label: 'Run an image model on a picture',
      // args: {"model":"sam-3d-body","image":"assets/images/lunge.jpg"}; writes assets/poses/<image>.<model>.json
      run: async (context, options = {}) =>
        context.host ? (await nodeHalf()).runImageModel(context.host, options) : runHeadless('image.run', options)
    },
    {
      id: 'image.poses',
      label: 'Pose records made so far',
      run: async context => ({
        poses: (await context.files.tree()).map(item => item.path).filter(file => POSE_FILE.test(file))
      })
    }
  ]
}
