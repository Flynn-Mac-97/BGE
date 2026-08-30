# Builds `kitten-survivors/assets/models/hound.glb`, the enemy that soaks hits.
#
# Run inside Blender: paste into the Text Editor and press Run, or send
# `exec(open(r'<this file>').read())` through BlenderMCP. It clears the scene.
#
# Feet on the origin, nose at Blender +Y, four leg objects legFrontLeft..
# legBackRight with their origin at the hip and the hip inside the body mass.
#
# THE OUTLINE SAYS: daylight underneath. The body is carried 0.48 m clear of
# the ground on four thin legs set wide apart, so the shape has holes in it and
# the bright meadow shows through. Every other family is a solid mass on the
# floor. It is also the tallest thing in the game at 1.08 m, more than twice
# the cat. Six families have to be told apart with the colour removed, so the
# hound owns "tall, and you can see under it" and nothing else may be it.
#
# Size is not shape. Three families at three sizes read as one family; height
# and a gap read as two different things.
#
# The scalloped mane is a step in value, not a pale ring. A pale collar
# measures about 0.85 luminance, which is inside the band the ground occupies.
#
# Saturated slate blue, mass 0.37, and the only BLUE family — the crow is the
# other cool one and it is violet. It was 0.33 and read as a dark mass: the
# keyline is a near-black line at constant screen width on everything that
# moves, and a near-black line on a near-black body separates nothing.
#
# The muzzle, legs and paws stay near-black. Dark legs against lit ground are
# the strongest contrast the model can make, and that gap is the whole claim.

LIB_PATH = globals().get(
    "LIB_PATH", "Z:/Code/browser game engine/tools/blender/lib.py")
exec(open(globals().get(
    "CREATURE_LIB",
    "Z:/Code/browser game engine/agent-runs/creatures/blender/creature-lib.py")).read())

MODEL_PATH = globals().get(
    "MODEL_PATH", "Z:/Code/browser game engine/kitten-survivors/assets/models/hound.glb")

# types/hound.js declares the hull [0.95, 0.85, 1.5]. The model stands 1.08 m
# and overshoots it, the same way the crow's wings and the rat's ears do: the
# hull is what a weapon hits, the silhouette is what is read.
HIP_HEIGHT = 0.600

COLOURS = {
    "houndCoat": "#46679f",    # 0.392 luminance, hue 218, saturated slate blue
    "houndMane": "#5b7cb8",    # 0.476, the collar; a step up from the coat, still under the lit ground
    "houndMuzzle": "#29334d",  # 0.199, muzzle, legs and paws — the model's dark end
    "houndWhite": "#fffdf5",   # eye whites and the two lower fangs
    "dark": "#141828",         # pupils, nose
}
MATERIAL_ORDER = ["houndCoat", "houndMane", "houndMuzzle", "houndWhite", "dark"]
SLOT = {name: index for index, name in enumerate(MATERIAL_ORDER)}


# ------------------------------------------------------------------ the body

# Tail to neck, as (y, centre z, half width, half height). Carried 0.24 m
# higher than it used to be and a little narrower, so the legs under it are
# four separate columns with meadow between them rather than a skirt.
BODY_RINGS = [
    (-0.560, 0.710, 0.078, 0.074),   # rump cap
    (-0.470, 0.710, 0.184, 0.172),
    (-0.330, 0.702, 0.218, 0.204),   # hips
    (-0.130, 0.696, 0.198, 0.190),   # waist
    (0.060, 0.706, 0.230, 0.216),    # shoulders, the widest point
    (0.180, 0.734, 0.172, 0.162),    # neck
]
BODY_SECTIONS = 10
BELLY_ABOVE = -0.55

HEAD_CENTRE = (0.0, 0.470, 0.836)
HEAD_HALF = (0.210, 0.196, 0.172)

MANE_CENTRE = (0.0, 0.235, 0.740)


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

    body = loft(bm, rings)
    for face in body:
        centre = face.calc_center_median()
        centre_z, _, half_height = body_profile(centre.y)
        above = (centre.z - centre_z) / max(half_height, 1e-6)
        face.material_index = (SLOT["houndMuzzle"] if above < BELLY_ABOVE
                               else SLOT["houndCoat"])

    build_tail(bm)
    build_head(bm)
    build_mane(bm)
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
    # Two scalloped plates, the lighter one in front of the darker one,
    # standing across the body behind the head. It sits at the top of a shape
    # that is mostly legs, so it says where the mass is; smaller than it was,
    # because a collar wide enough to reach past the shoulders closes the gap
    # under the body when the camera is anywhere but straight overhead.
    made = plate(bm, (MANE_CENTRE[0], MANE_CENTRE[1] - 0.030, MANE_CENTRE[2]),
                 0.318, 0.290, 0.140, sides=14, tilt=(1.5708, 0.0, 0.0),
                 scallop=0.24)
    paint(made, SLOT, "houndMuzzle")

    # Thick, not a sheet. A thin plate reads as a blanket laid on the back from
    # every angle but straight down; a ruff with depth reads as fur.
    front = plate(bm, (MANE_CENTRE[0], MANE_CENTRE[1] + 0.058, MANE_CENTRE[2]),
                  0.348, 0.318, 0.160, sides=14, tilt=(1.5708, 0.0, 0.0),
                  scallop=0.32)
    paint(front, SLOT, "houndMane")
    return made + front


def build_tail(bm):
    # Short, thick and held up. A hound needs one thing above the mane line so
    # it is not a perfect disc from directly overhead.
    made = rings_along(bm, [(-0.556, 0.720, 0.072),
                            (-0.606, 0.800, 0.062),
                            (-0.628, 0.886, 0.052),
                            (-0.620, 0.962, 0.044)], sides=6, squareness=0.35)
    faces = loft(bm, made)
    paint(faces, SLOT, "houndMane")
    return faces


# ------------------------------------------------------------------ the legs

# Local to the hip: (z, y offset, radius). Long and thin, because the gap they
# hold the body over is what names this family. A thick leg at this length
# fills that gap back in and the hound is a solid mass again.
LEG = [
    (0.060, 0.000, 0.086),
    (-0.100, 0.004, 0.070),
    (-0.300, 0.008, 0.056),
    (-0.530, 0.010, 0.048),
    (-0.600, 0.010, 0.048),
]

# Set wide and far apart, so the four columns are four shapes rather than two
# pairs. The front pair is under the shoulders, the back pair under the hips.
LEGS = {
    "legFrontLeft": (-0.200, 0.100),
    "legFrontRight": (0.200, 0.100),
    "legBackLeft": (-0.190, -0.370),
    "legBackRight": (0.190, -0.370),
}


def build():
    clear_scene()
    materials = build_materials(COLOURS, MATERIAL_ORDER)
    build_body(materials)
    for name, (hip_x, hip_y) in LEGS.items():
        build_leg(name, hip_x, hip_y, HIP_HEIGHT, LEG, 0.020, materials,
                  SLOT, "houndCoat", "houndMuzzle", paw_half=(0.086, 0.104, 0.036))
    return export(MODEL_PATH, posed=list(LEGS))


print(build())
