# Builds `kitten-survivors/assets/models/hound.glb`, the enemy that soaks hits.
#
# Run inside Blender: paste into the Text Editor and press Run, or send
# `exec(open(r'<this file>').read())` through BlenderMCP. It clears the scene.
#
# Feet on the origin, nose at Blender +Y, four leg objects legFrontLeft..
# legBackRight with their origin at the hip and the hip inside the body mass.
#
# The identity is a HUGE PALE MANE, a scalloped collar half again as wide as
# the shoulders, with a small dark muzzle poking out of the front of it. From
# directly above a hound is a pale flower with a dark centre, and nothing else
# on the meadow is that shape or that size.
#
# Cool slate blue, and the only cool family in the game. The type file used to
# call it warm grey, chosen so it would not be confused with the crow's
# near-black. Grey solves that by having no colour at all, which loses against
# art/world/bible.md: the actors have to out-saturate the arena or the floor
# becomes the loudest thing on screen. A saturated cool blue keeps the hound
# well above the crow in value AND gives it a hue no other family uses.

LIB_PATH = globals().get(
    "LIB_PATH", "Z:/Code/browser game engine/tools/blender/lib.py")
exec(open(globals().get(
    "CREATURE_LIB",
    "Z:/Code/browser game engine/agent-runs/creatures/blender/creature-lib.py")).read())

MODEL_PATH = globals().get(
    "MODEL_PATH", "Z:/Code/browser game engine/kitten-survivors/assets/models/hound.glb")

# types/hound.js declares the hull [0.95, 0.85, 1.5].
HIP_HEIGHT = 0.360

COLOURS = {
    "houndCoat": "#5f74a4",    # saturated cool slate — the only cool family
    "houndMane": "#cdd9ee",    # the pale collar, the whole find cue
    "houndMuzzle": "#39456a",  # muzzle and paws, a step down from the coat
    "houndWhite": "#fffdf5",   # eye whites and the two lower fangs
    "dark": "#1b2136",         # pupils, nose
    "houndOutline": "#0d1122", # the inverted hull
}
MATERIAL_ORDER = ["houndCoat", "houndMane", "houndMuzzle", "houndWhite",
                  "dark", "houndOutline"]
SLOT = {name: index for index, name in enumerate(MATERIAL_ORDER)}


# ------------------------------------------------------------------ the body

# Tail to neck, as (y, centre z, half width, half height). Heavy and level:
# a hound walks in a straight line and its job is to be in the way.
BODY_RINGS = [
    (-0.560, 0.470, 0.088, 0.084),   # rump cap
    (-0.470, 0.470, 0.208, 0.196),
    (-0.330, 0.462, 0.248, 0.232),   # hips
    (-0.130, 0.456, 0.226, 0.216),   # waist
    (0.060, 0.466, 0.262, 0.244),    # shoulders, the widest point
    (0.180, 0.494, 0.196, 0.184),    # neck
]
BODY_SECTIONS = 10
BELLY_ABOVE = -0.55

HEAD_CENTRE = (0.0, 0.470, 0.596)
HEAD_HALF = (0.210, 0.196, 0.172)

MANE_CENTRE = (0.0, 0.235, 0.500)


def body_profile(y):
    if y <= BODY_RINGS[0][0]:
        return BODY_RINGS[0][1:]
    if y >= BODY_RINGS[-1][0]:
        return BODY_RINGS[-1][1:]
    for near, far in zip(BODY_RINGS, BODY_RINGS[1:]):
        if near[0] <= y <= far[0]:
            span = far[0] - near[0]
            mix = 0.0 if span == 0 else (y - near[0]) / span
            return tuple(a + (b - a) * mix for a, b in zip(near[1:], far[1:]))
    return BODY_RINGS[-1][1:]


def build_body(materials):
    bm = bmesh.new()

    tail_end, neck_end = BODY_RINGS[0][0], BODY_RINGS[-1][0]
    sections = []
    for index in range(BODY_SECTIONS):
        y = tail_end + (neck_end - tail_end) * index / (BODY_SECTIONS - 1)
        sections.append((y,) + body_profile(y))
    rings = [ring(bm, *values, sides=8, squareness=0.6) for values in sections]

    silhouette = loft(bm, rings)
    for face in silhouette:
        centre = face.calc_center_median()
        centre_z, _, half_height = body_profile(centre.y)
        above = (centre.z - centre_z) / max(half_height, 1e-6)
        face.material_index = (SLOT["houndMuzzle"] if above < BELLY_ABOVE
                               else SLOT["houndCoat"])

    silhouette += build_tail(bm)
    silhouette += build_head(bm)
    silhouette += build_mane(bm)

    add_shell(bm, silhouette, 0.030, SLOT, "houndOutline")
    return finish(bm, "houndBody", materials)


def build_head(bm):
    skull = rounded_block(bm, HEAD_CENTRE, HEAD_HALF, roundness=0.62)
    paint(skull, SLOT, "houndCoat")

    # Muzzle: a dark block out the front of the mane, with a nose on the end.
    # It is the only dark thing inside a pale collar, so it is what says which
    # way a hound is facing from directly above.
    muzzle = rounded_block(bm, (0.0, HEAD_CENTRE[1] + 0.180, HEAD_CENTRE[2] - 0.072),
                           (0.110, 0.106, 0.082), roundness=0.5)
    paint(muzzle, SLOT, "houndMuzzle")
    made = skull + muzzle

    paint(rounded_block(bm, (0.0, HEAD_CENTRE[1] + 0.272, HEAD_CENTRE[2] - 0.048),
                        (0.052, 0.032, 0.040), roundness=0.8), SLOT, "dark")

    # Two lower fangs. White reads at any size and says the thing bites.
    for side in (-1, 1):
        paint(cone(bm, (side * 0.058, HEAD_CENTRE[1] + 0.226, HEAD_CENTRE[2] - 0.126),
                   0.026, (side * 0.058, HEAD_CENTRE[1] + 0.238, HEAD_CENTRE[2] - 0.196),
                   sides=4, turn=math.pi / 4), SLOT, "houndWhite")

    eyes(bm, SLOT, 0.108, HEAD_CENTRE[1] + 0.128, HEAD_CENTRE[2] + 0.062,
         (0.058, 0.038, 0.052), (0.036, 0.028, 0.036),
         "houndWhite", "dark", forward=0.024)

    # Ears: thick slabs laid back along the skull rather than pricked up. A
    # pricked ear would compete with the mane outline for the same silhouette.
    for side in (-1, 1):
        ear = cone(bm, (side * 0.176, HEAD_CENTRE[1] - 0.040, HEAD_CENTRE[2] + 0.086),
                   0.078, (side * 0.268, HEAD_CENTRE[1] - 0.150,
                           HEAD_CENTRE[2] - 0.010), sides=4, turn=math.pi / 4)
        paint(ear, SLOT, "houndMuzzle")
        made += ear
    return made


def build_mane(bm):
    # Two scalloped plates, the pale one in front of the dark one, standing
    # across the body behind the head. 0.84 m across against 0.52 m of
    # shoulder: size is the only cue that survives three hundred bodies, so
    # the mane is simply much wider rather than a little wider.
    made = plate(bm, (MANE_CENTRE[0], MANE_CENTRE[1] - 0.030, MANE_CENTRE[2]),
                 0.386, 0.340, 0.150, sides=14, tilt=(1.5708, 0.0, 0.0),
                 scallop=0.24)
    paint(made, SLOT, "houndMuzzle")

    # Thick, not a sheet. A thin plate reads as a blanket laid on the back from
    # every angle but straight down; a ruff with depth reads as fur.
    front = plate(bm, (MANE_CENTRE[0], MANE_CENTRE[1] + 0.058, MANE_CENTRE[2]),
                  0.420, 0.372, 0.170, sides=14, tilt=(1.5708, 0.0, 0.0),
                  scallop=0.32)
    paint(front, SLOT, "houndMane")
    return made + front


def build_tail(bm):
    # Short, thick and held up. A hound needs one thing above the mane line so
    # it is not a perfect disc from directly overhead.
    made = rings_along(bm, [(-0.556, 0.480, 0.072),
                            (-0.606, 0.560, 0.062),
                            (-0.628, 0.646, 0.052),
                            (-0.620, 0.722, 0.044)], sides=6, squareness=0.35)
    faces = loft(bm, made)
    paint(faces, SLOT, "houndMane")
    return faces


# ------------------------------------------------------------------ the legs

# Local to the hip: (z, y offset, radius). Columns, not limbs — the hound is
# heavy and its legs carry that by being thick and barely tapering.
LEG = [
    (0.060, 0.000, 0.104),
    (-0.060, 0.004, 0.096),
    (-0.200, 0.008, 0.082),
    (-0.320, 0.010, 0.076),
    (-0.360, 0.010, 0.076),
]

LEGS = {
    "legFrontLeft": (-0.184, 0.078),
    "legFrontRight": (0.184, 0.078),
    "legBackLeft": (-0.176, -0.318),
    "legBackRight": (0.176, -0.318),
}


def build():
    clear_scene()
    materials = build_materials(COLOURS, MATERIAL_ORDER)
    flat_dark("houndOutline")
    build_body(materials)
    for name, (hip_x, hip_y) in LEGS.items():
        build_leg(name, hip_x, hip_y, HIP_HEIGHT, LEG, 0.020, materials,
                  SLOT, "houndCoat", "houndMuzzle", paw_half=(0.086, 0.104, 0.036))
    return export(MODEL_PATH, posed=list(LEGS))


print(build())
