# Builds `kitten-survivors/assets/models/hound.glb`, the wall that follows you.
#
# Run inside Blender: paste into the Text Editor and press Run, or send
# `exec(open(r'<this file>').read())` through BlenderMCP. It clears the scene.
#
# Same four rules as make-kitten-survivors-kitten.py: feet on the origin, nose
# at Blender +Y, four leg objects named legFrontLeft..legBackRight with their
# origin at the hip, hip buried inside the body mass.
#
# Size alone is the cue that survives a crowded screen, so the hound is the
# longest body in the loft and the one ring where the profile bulges wider
# than its own shoulders: a mane at the neck, painted a shade darker, reads
# from above as a broad collar nothing else on the meadow has.

LIB_PATH = globals().get("LIB_PATH", "Z:/Code/browser game engine/tools/blender/lib.py")
exec(open(LIB_PATH).read())

MODEL_PATH = globals().get(
    "MODEL_PATH", "Z:/Code/browser game engine/kitten-survivors/assets/models/hound.glb")

# Metres, against the 0.45 m cat. types/hound.js declares box [0.95, 0.85, 1.5].
HIP_HEIGHT = 0.34

COLOURS = {
    "houndFur": "#9c8570",    # body — warm taupe grey, not the old cold blue-grey
    "houndMane": "#6d5a48",   # the ruff at the neck, one patch, not a band
    "houndCream": "#dcc9a8",  # muzzle, paws, belly
    "dark": "#241f1a",        # eyes, nose
}
MATERIAL_ORDER = ["houndFur", "houndMane", "houndCream", "dark"]
SLOT = {name: index for index, name in enumerate(MATERIAL_ORDER)}


# ------------------------------------------------------------------ the body

# Tail to neck, as (y, centre z, half width, half height). The mane ring is
# wider than the shoulders on both sides of it, so the bulge is a shape in the
# loft itself and costs nothing extra to build.
BODY_RINGS = [
    (-0.620, 0.460, 0.062, 0.056),   # tail cap
    (-0.540, 0.470, 0.172, 0.152),   # rump
    (-0.300, 0.450, 0.152, 0.138),   # waist
    (-0.060, 0.470, 0.192, 0.172),   # ribs
    (0.190, 0.498, 0.204, 0.184),    # shoulders
    (0.360, 0.525, 0.232, 0.204),    # mane — wider than the shoulders either side
    (0.480, 0.548, 0.138, 0.122),    # neck, narrows again above the mane
]
BODY_SECTIONS = 17

MANE_FROM = 0.28
MANE_TO = 0.42
BELLY_ABOVE = -0.35

HEAD_CENTRE = (0.0, 0.610, 0.535)
HEAD_HALF = (0.152, 0.142, 0.132)


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

    tail_end, nose_end = BODY_RINGS[0][0], BODY_RINGS[-1][0]
    sections = []
    for index in range(BODY_SECTIONS):
        y = tail_end + (nose_end - tail_end) * index / (BODY_SECTIONS - 1)
        sections.append((y,) + body_profile(y))
    rings = [ring(bm, *values, sides=8, squareness=0.66) for values in sections]

    faces = loft(bm, rings)
    for face in faces:
        centre = face.calc_center_median()
        centre_z, _, half_height = body_profile(centre.y)
        above = (centre.z - centre_z) / max(half_height, 1e-6)
        if above < BELLY_ABOVE:
            face.material_index = SLOT["houndCream"]
        elif above > 0.0 and MANE_FROM <= centre.y <= MANE_TO:
            face.material_index = SLOT["houndMane"]
        else:
            face.material_index = SLOT["houndFur"]

    build_head(bm)
    build_tail(bm)

    return finish(bm, "houndBody", materials)


def build_head(bm):
    for face in rounded_block(bm, HEAD_CENTRE, HEAD_HALF, roundness=0.5):
        centre = face.calc_center_median()
        face.material_index = (SLOT["houndCream"] if centre.z < HEAD_CENTRE[2] - 0.03
                               else SLOT["houndFur"])

    # Muzzle: a pale block, blunt rather than pointed — a hound built for
    # bulk, not for speed.
    paint(rounded_block(bm, (0.0, HEAD_CENTRE[1] + HEAD_HALF[1] - 0.01, HEAD_CENTRE[2] - 0.05),
                        (0.065, 0.055, 0.045), roundness=0.5), SLOT, "houndCream")

    # Eyes.
    for side in (-1, 1):
        paint(rounded_block(bm, (side * 0.075, HEAD_CENTRE[1] + 0.06, HEAD_CENTRE[2] + 0.03),
                            (0.022, 0.013, 0.020), roundness=0.7), SLOT, "dark")

    # Ears: set wide and pointed, further apart than the rat's and much
    # bigger — the second silhouette cue after sheer size.
    for side in (-1, 1):
        base = (side * 0.130, HEAD_CENTRE[1] - 0.075, HEAD_CENTRE[2] + 0.115)
        tip = (side * 0.205, HEAD_CENTRE[1] - 0.100, HEAD_CENTRE[2] + 0.235)
        for face in cone(bm, base, 0.062, tip, sides=4, turn=math.pi / 4):
            centre = face.calc_center_median()
            face.material_index = (SLOT["houndFur"] if centre.z > base[2]
                                   else SLOT["dark"])


# Base to tip, as (y, z, radius). Held low and level, a thick rope rather
# than a flourish — a hound is not trying to be noticed.
TAIL_PATH = [
    (-0.600, 0.450, 0.048),
    (-0.680, 0.420, 0.040),
    (-0.755, 0.395, 0.032),
    (-0.815, 0.378, 0.024),
]


def build_tail(bm):
    rings = rings_along(bm, TAIL_PATH, sides=6, squareness=0.35)
    paint(loft(bm, rings, cap_last=False), SLOT, "houndFur")


# ------------------------------------------------------------------ the legs

# Local to the hip: (z, y offset, radius). Thick and straight — a hound plants
# itself rather than moving quickly, and the first ring sits above the hip
# and inside the body.
LEG = [
    (0.050, 0.000, 0.076),
    (-0.050, 0.003, 0.063),
    (-0.150, 0.006, 0.052),
    (-0.255, 0.008, 0.047),
    (-0.335, 0.008, 0.047),
]

LEGS = {
    "legFrontLeft": (-0.155, 0.180),
    "legFrontRight": (0.155, 0.180),
    "legBackLeft": (-0.145, -0.420),
    "legBackRight": (0.145, -0.420),
}


def build():
    clear_scene()
    materials = build_materials(COLOURS, MATERIAL_ORDER)
    build_body(materials)
    for name, (hip_x, hip_y) in LEGS.items():
        build_leg(name, hip_x, hip_y, HIP_HEIGHT, LEG, 0.020, materials,
                  SLOT, "houndFur", "houndCream", paw_half=(0.052, 0.062, 0.022))
    bpy.ops.export_scene.gltf(filepath=MODEL_PATH,
                              export_format="GLB",
                              export_yup=True,
                              export_apply=True)
    return MODEL_PATH


build()
