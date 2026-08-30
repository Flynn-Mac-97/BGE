export default {
  about: 'the volume the bomb may be planted in. A trigger: felt, never walked into, and placed generously',
  appearance: 'A large yellow box twelve metres square over one end of the map. Editor Markers hides it in play.',
  looksWrongWhen: 'a yellow box shows during a round, or a plant fails while the player stands inside the site.',

  // The volume the bomb may be planted in. A trigger, so it is felt and never
  // walked into, and it is meant to be placed generously: a plant that fails
  // because the player stood thirty centimetres outside an invisible box is the
  // worst bug a map can ship, and nobody can see the box to know they were out.
  // Better to cover a little more of the site than the pros would call "site"
  // than to have one corner of A that silently is not A.
  //
  // The collider is the volume; the mesh is the same volume drawn, so the box is
  // visible and draggable while editing. Like `spawn-point`, the plan is for an
  // editor plugin to hide it in play rather than for this file to guess.
  // Seen while building, never while playing — Editor Markers hides it on play.
  marker: true,
  mesh: {
    box: [12, 3, 12],
    tint: '#e0b040'
  },
  collider: { box: [12, 3, 12] },
  properties: { body: 'trigger', site: 'A' }
}
