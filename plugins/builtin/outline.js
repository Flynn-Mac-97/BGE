/**
 * Outline — a line round a thing, switched on and off as feedback.
 *
 * The line itself is the renderer's keyline: a hull grown by a fixed number of
 * screen pixels, so it is the same width whatever the thing is and however far
 * away it stands. This plugin owns when it is on, which is the part a game
 * cares about — hover, selection, "you can pick this up", "this one is next".
 *
 * An outline turned on here is never saved. It is feedback about the moment,
 * not a fact about the level, and writing it to disk would leave every hovered
 * crate outlined for the next person who opens the project.
 */

/** What an outline looks like when the caller does not say. */
const DEFAULTS = { width: 3, colour: '#ffd34d' }

/**
 * Which entities are outlined, and what their mesh declared before.
 *
 * The declared value is kept so that hiding restores it. A level is allowed to
 * outline something permanently, and feedback must give that back rather than
 * delete it.
 */
const shown = new Map()

/** The pixel width to draw, held to something a screen can show. */
const widthOf = value => Math.min(24, Math.max(0.5, Number(value) || DEFAULTS.width))

/** Whether the panel mirrors the selection. */
const panel = { follow: false, width: DEFAULTS.width, colour: DEFAULTS.colour }

/** Put the outline keys on an entity's mesh, remembering what was there. */
function light(context, entity, width, colour) {
  if (!entity?.mesh) return false
  if (!shown.has(entity.id)) {
    shown.set(entity.id, { keyline: entity.mesh.keyline, keylineColour: entity.mesh.keylineColour })
  }
  entity.mesh = { ...entity.mesh, keyline: widthOf(width), keylineColour: colour || DEFAULTS.colour }
  return true
}

/** Put back whatever the mesh declared before it was outlined. */
function darken(context, entity) {
  const was = shown.get(entity?.id)
  if (!was) return false
  const mesh = { ...entity.mesh }
  if (was.keyline === undefined) delete mesh.keyline
  else mesh.keyline = was.keyline
  if (was.keylineColour === undefined) delete mesh.keylineColour
  else mesh.keylineColour = was.keylineColour
  entity.mesh = mesh
  shown.delete(entity.id)
  return true
}

/**
 * Draw the change without writing it.
 *
 * `world:changed` is what the renderer syncs on. `context.save` is deliberately
 * not called — see the note at the top of the file.
 */
function settle(context) {
  context.bus.emit('world:changed')
  context.redraw?.()
}

/** Every entity a command's argument names: one id, a list, or a type. */
function chosen(context, what) {
  if (!what) return context.selection?.filter(entity => entity.mesh) || []
  const names = Array.isArray(what) ? what : [what]
  const found = []
  for (const name of names) {
    const one = context.world.byId(name)
    if (one) { found.push(one); continue }
    if (context.world.types?.has(name)) found.push(...context.world.all(name))
  }
  return found.filter(entity => entity.mesh)
}

export default {
  name: 'Outline',
  category: 'visuals',
  about: 'Switches a screen-width outline on and off per entity. The standard feedback for hover, selection, and what a player can act on. Never saved into the level.',

  panels: [{
    id: 'outline',
    title: 'Outline',
    dock: 'right',
    order: 43,

    render(ui, context) {
      const meshes = context.selection?.filter(entity => entity.mesh) || []
      const on = [...shown.keys()]

      return ui.stack([
        ui.toggle({
          label: 'Follow the selection',
          value: panel.follow,
          onChange: value => {
            panel.follow = value
            if (!value) { for (const id of [...shown.keys()]) darken(context, context.world.byId(id)) }
            else for (const entity of meshes) light(context, entity, panel.width, panel.colour)
            settle(context)
          }
        }),

        ui.slider({
          k: 'width', min: 1, max: 12, step: 0.5, value: panel.width,
          onChange: value => { panel.width = value; repaint(context) }
        }),

        ui.fold('Colour and what is lit', [
          ui.field({ k: 'colour', v: panel.colour }),
          ui.text(on.length ? on.join(', ') : 'nothing outlined', { dim: true })
        ], { open: false, meta: `${on.length} on` }),

        meshes.length && !panel.follow
          ? ui.row([ui.button(
              `Outline ${meshes.length === 1 ? meshes[0].id : `${meshes.length} things`}`,
              () => { for (const entity of meshes) light(context, entity, panel.width, panel.colour); settle(context) },
              { primary: true })], { pad: true })
          : null,

        on.length
          ? ui.row([ui.button('Clear', () => {
              for (const id of on) darken(context, context.world.byId(id))
              settle(context)
            })], { pad: true })
          : null
      ].filter(Boolean))
    }
  }],

  onLoad(context) {
    // The verbs a game calls. Same shape as the commands, so a terminal and a
    // behaviour reach the same thing.
    context.outline = {
      show: (what, options = {}) => {
        const many = chosen(context, what)
        for (const entity of many) light(context, entity, options.width ?? panel.width, options.colour ?? panel.colour)
        settle(context)
        return many.map(entity => entity.id)
      },
      hide: what => {
        const many = what ? chosen(context, what) : [...shown.keys()].map(id => context.world.byId(id))
        const gone = many.filter(entity => darken(context, entity)).map(entity => entity.id)
        settle(context)
        return gone
      },
      toggle: (what, options = {}) => {
        const many = chosen(context, what)
        for (const entity of many) {
          if (shown.has(entity.id)) darken(context, entity)
          else light(context, entity, options.width ?? panel.width, options.colour ?? panel.colour)
        }
        settle(context)
        return [...shown.keys()]
      },
      shown: () => [...shown.keys()],
      // What an outline looks like when nothing says otherwise. A game sets its
      // own selection colour once rather than passing it at every call.
      style: ({ width, colour } = {}) => {
        if (width !== undefined) panel.width = widthOf(width)
        if (colour !== undefined) panel.colour = colour
        repaint(context)
        return { width: panel.width, colour: panel.colour }
      }
    }

    // Following the selection is what makes this readable as feedback rather
    // than as a level edit: the line appears on the thing under the cursor and
    // leaves when it does.
    context.bus.on('selection:changed', () => {
      if (!panel.follow) return
      const wanted = new Set((context.selection || []).filter(entity => entity.mesh).map(entity => entity.id))
      for (const id of [...shown.keys()]) if (!wanted.has(id)) darken(context, context.world.byId(id))
      for (const id of wanted) light(context, context.world.byId(id), panel.width, panel.colour)
      settle(context)
    })

    // An entity that leaves takes its outline with it, or the map grows for as
    // long as the session lasts.
    context.bus.on('entity:removed', entity => { shown.delete(entity?.id ?? entity) })
  },

  commands: [
    {
      id: 'outline.show',
      label: 'Outline one entity, a list of them, or every one of a type',
      // run outline.show crate              — one id, or a type
      // run outline.show '["a","b"]'        — several
      // run outline.show                    — whatever is selected
      run: (context, what, options) => ({ outlined: context.outline.show(what, options || {}) })
    },
    {
      id: 'outline.hide',
      label: 'Take the outline off — everything, if nothing is named',
      run: (context, what) => ({ cleared: context.outline.hide(what) })
    },
    {
      id: 'outline.toggle',
      label: 'Switch the outline on what is named, or on the selection',
      run: (context, what, options) => ({ outlined: context.outline.toggle(what, options || {}) })
    },
    {
      id: 'outline.list',
      label: 'What is outlined now, and what an outline looks like',
      run: () => ({ outlined: [...shown.keys()], width: panel.width, colour: panel.colour, following: panel.follow })
    }
  ]
}

/** Redraw every outline that is already on, at the current width and colour. */
function repaint(context) {
  for (const id of shown.keys()) {
    const entity = context.world.byId(id)
    if (entity?.mesh) entity.mesh = { ...entity.mesh, keyline: widthOf(panel.width), keylineColour: panel.colour }
  }
  settle(context)
}
