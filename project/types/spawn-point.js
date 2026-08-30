export default {
  about: 'a build-time marker: where a player starts and which way they face. Not part of the played game',
  appearance: 'A red post the size of a standing player. Editor Markers hides it the moment play starts.',
  looksWrongWhen: 'red posts are visible during a round — Editor Markers is off, so a marker is drawn in play.',

  // Where a player starts, and nothing else. No collider, because a marker that
  // pushed players around would be the single most annoying entity in the map.
  //
  // It carries a mesh anyway, sized like a standing player, because a spawn you
  // cannot see is a spawn you cannot move, and placing ten of these by feel in
  // an empty sand yard is exactly the job the editor viewport is for. The plan
  // is that an editor plugin hides every `spawn-point` the moment play starts —
  // one line in a plugin, rather than a hook here that guesses whether it is
  // being looked at. Until that plugin exists these show up in play as red
  // posts, which is honest: the marker is really there.
  //
  // `rotation` on the placement is the yaw the player faces on spawning, in
  // degrees, so a spawn says which way you are looking as well as where you are.
  // Seen while building, never while playing — Editor Markers hides it on play.
  marker: true,
  mesh: {
    box: [0.6, 1.8, 0.6],
    tint: '#d2432f'
  },
  properties: { team: 'terrorist' }
}
