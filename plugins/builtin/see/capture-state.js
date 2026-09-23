import { revealOverlays } from './frame-context.js'

export async function waitForModel(context, subjectEntity) {
  const declaredModel = !context.renderer.blank
    && subjectEntity && (subjectEntity.mesh || subjectEntity._definition?.mesh)?.model
  for (let waited = 0; waited < 40 && declaredModel
    && context.renderer.modelState?.(declaredModel) !== 'ready'
    && context.renderer.modelState?.(declaredModel) !== 'failed'; waited++) {
    context.renderer.sync(context.world)
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

export async function prepareStudio(context, subjectEntity, state) {
  for (const other of context.world.entities) {
    if (other === subjectEntity || other.hidden) continue
    other.hidden = true
    state.concealed.push(other)
  }
  const THREE = await import('three/webgpu')
  const scene = context.renderer.scene
  const studio = state.studio = { THREE, scene, background: scene.background, fog: scene.fog, dimmed: [] }
  scene.fog = null
  scene.background = null
  // The post chain is the Post Processing plugin's pass; ask it to stand down so
  // the studio frame is the raw scene. `restoreCapture` asks for it back.
  context.post?.hold?.()
  for (const child of scene.children) {
    if (child.isLight && child.visible) { child.visible = false; studio.dimmed.push(child) }
  }
  studio.rig = new THREE.Group()
  studio.rig.add(new THREE.AmbientLight('#ffffff', 0.9))
  const key = new THREE.DirectionalLight('#ffffff', 1.7)
  key.position.set(2, 4, 3)
  studio.rig.add(key)
  scene.add(studio.rig)
}

export function hideStudioBackground(studio, subjectEntity) {
  for (const child of studio.scene.children) {
    if (!child.visible || child === studio.rig) continue
    if (child.userData?.entity === subjectEntity.id) continue
    child.visible = false
    studio.dimmed.push(child)
  }
}

export function restoreCapture(context, state) {
  const { sized, moved, kept, concealed, overlays, studio } = state
  const view = context.view
  if (sized) context.renderer.resize()
  for (const other of concealed) other.hidden = false
  revealOverlays(overlays)
  if (studio) {
    studio.scene.remove(studio.rig)
    studio.scene.background = studio.background
    studio.scene.fog = studio.fog
    for (const child of studio.dimmed) child.visible = true
    context.post?.release?.()
  }
  if (moved) Object.assign(view, kept)
  delete view.borrowedBy
  if (sized || moved || studio || concealed.length || overlays.length) {
    try {
      context.renderer.sync(context.world)
      context.renderer.draw()
    } catch { /* the frame is already taken */ }
  }
}
