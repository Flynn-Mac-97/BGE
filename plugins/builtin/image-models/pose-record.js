/**
 * Image Models: a pose model's raw points as the engine's pose record, the
 * one shape every pose model's answer is read in.
 *
 *   poseRecordOf({ model, image, names, people: [{ points: [[x, y, z], ...] }] })
 *   -> { model, image, kind: 'pose', people: [{ points: { left_wrist: [x, y, z], ... } }] }
 *
 * Raw points are camera space, as an image model gives them: metres, +X to
 * the image's right, +Y down, +Z away from the camera. A record's points are
 * the space Kimodo keys use: +Y up, the person facing +Z with their left at
 * +X, the ground point between the hips at x = z = 0, and the lowest foot
 * point on the floor at y = 0. A person facing the camera faces -Z in camera
 * space, so turning half a turn about X (y and z negated) is the whole change.
 */

/** Points on the feet, to put the floor under; a model that has none of them is floored by its lowest point. */
const FOOT_POINTS = ['left_ankle', 'right_ankle', 'left_heel', 'right_heel', 'left_big_toe', 'right_big_toe', 'left_small_toe', 'right_small_toe']

const rounded = value => Number(value.toFixed(4))

/** One person's points by name, turned and placed as the top of this file says. */
function personOf(names, points) {
  const turned = points.map(([x, y, z]) => [x, -y, -z])
  const byName = Object.fromEntries(names.map((name, index) => [name, turned[index]]).filter(([, point]) => point))
  const hips = [byName.left_hip, byName.right_hip].filter(Boolean)
  const [middleX, middleZ] = hips.length
    ? [0, 2].map(axis => hips.reduce((sum, point) => sum + point[axis], 0) / hips.length)
    : [0, 0]
  const feet = FOOT_POINTS.map(name => byName[name]).filter(Boolean)
  const floor = Math.min(...(feet.length ? feet : turned).map(point => point[1]))
  return {
    points: Object.fromEntries(
      Object.entries(byName).map(([name, [x, y, z]]) => [name, [rounded(x - middleX), rounded(y - floor), rounded(z - middleZ)]])
    )
  }
}

/** The pose record for a pose model's raw answer. `names` name the points in order. */
export function poseRecordOf({ model, image, names, people }) {
  return { model, image, kind: 'pose', people: people.map(person => personOf(names, person.points)) }
}
