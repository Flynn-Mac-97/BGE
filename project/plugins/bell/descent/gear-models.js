/**
 * How grid items look on the side-on hero. `hold` names a hold file in assets/models/items/ for the hand;
 * `back` names the model hung on the back while it is not in hand. Items not listed are not drawn.
 */
export const gearModels = {
  dagger: { hold: 'sword', back: 'sword', scale: 0.7 },
  widowFang: { hold: 'sword', back: 'sword', scale: 0.85 },
  sword: { hold: 'greatsword', back: 'greatsword', scale: 0.85 },
  graveEdge: { hold: 'greatsword', back: 'greatsword', scale: 1 },
  hammer: { hold: 'greatsword', back: 'greatsword', scale: 0.75 },
  bellHammer: { hold: 'greatsword', back: 'greatsword', scale: 0.9 },
  buckler: { offHand: 'shield', back: 'shield', scale: 0.9 },
  sapwoodStaff: { back: 'bow', scale: 1 },
  rootwardenStaff: { back: 'crossbow', scale: 1 }
}

/** Where each back slot hangs, on the Spine2 node, in that node's space; radians. Slots fill in order. */
export const backSlots = [
  { position: [0.05, 0.3, -0.24], rotation: [0.25, 0, 0.35] },
  { position: [-0.05, 0.3, -0.3], rotation: [0.25, 0, -0.35] },
  { position: [0, 0.05, -0.34], rotation: [0, 0, 0] },
  { position: [0, 0.4, -0.36], rotation: [0.5, 0, 0] }
]
