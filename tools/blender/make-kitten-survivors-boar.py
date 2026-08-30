# Builds `kitten-survivors/assets/models/boar.glb`, the charger.
#
# Run inside Blender: paste into the Text Editor and press Run, or send
# `exec(open(r'<this file>').read())` through BlenderMCP. It clears the scene.
#
# Same four rules as make-kitten-survivors-kitten.py: feet on the origin, nose
# at Blender +Y, four leg objects named legFrontLeft..legBackRight with their
# origin at the hip, hip buried inside the body mass.
#
# A boar tapers the wrong way round on purpose: narrow rump, huge shoulders
# and head, widest point at the front — the opposite silhouette to every other
# quadruped on the field, so the shape alone says "this one is coming at you
# nose-first". Two pale curved tusks hook up from the snout, the one mark the
# top-down camera actually resolves.

LIB_PATH = globals().get("LIB_PATH", "Z:/Code/browser game engine/tools/blender/lib.py")
exec(open(LIB_PATH).read())

MODEL_PATH = globals().get(
    "MODEL_PATH", "Z:/Code/browser game engine/kitten-survivors/assets/models/boar.glb")

# Metres, against the 0.45 m cat. types/boar.js declares box [0.8, 0.65, 1.3].
HIP_HEIGHT = 0.28

COLOURS = {
    "boarFur": "#c1502b",     # body — bright rust red, warm and saturated
    "boarCream": "#e8d9b0",   # tusks, hooves, belly
    "dark": "#241a15",        # eyes, nose
}
MATERIAL_ORDER = ["boarFur", "boarCream", "dark"]
SLOT = {name: index for index, name in enumerate(MATERIAL_ORDER)}


# ------------------------------------------------------------------ the body

# Tail to neck, as (y, centre z, half width, half height). Every ring gets
# wider moving forward — the opposite taper to the kitten and the rat, which
# is the whole of a boar's silhouette.
BODY_RINGS = [
    (-0.560, 0.400, 0.058, 0.052),   # rump cap, where the tail leaves
    (-0.480, 0.415, 0.150, 0.135),   # rump, the narrow end
    (-0.320, 0.400, 0.185, 0.165),   # waist
    (-0.120, 0.415, 0.225, 0.195),   # ribs
    (0.090, 0.435, 0.270, 0.225),    # shoulders
    (0.280, 0.450, 0.290, 0.235),    # chest, the widest point
    (0.420, 0.455, 0.190, 0.160),    # neck
]
BODY_SECTIONS = 15

BELLY_ABOVE = -0.35

HEAD_CENTRE = (0.0, 0.590, 0.430)
HEAD_HALF = (0.185, 0.165, 0.155)


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
    rings = [ring(bm, *values, sides=8, squareness=0.68) for values in sections]

    faces = loft(bm, rings)
    for face in faces:
        centre = face.calc_center_median()
        centre_z, _, half_height = body_profile(centre.y)
        above = (centre.z - centre_z) / max(half_height, 1e-6)
        face.material_index = SLOT["boarCream"] if above < BELLY_ABOVE else SLOT["boarFur"]

    build_head(bm)
    build_tail(bm)

    return finish(bm, "boarBody", materials)


def build_head(bm):
    for face in rounded_block(bm, HEAD_CENTRE, HEAD_HALF, roundness=0.42):
        face.material_index = SLOT["boarFur"]

    # Snout: a blunt pale block, the ground a tusk pair reads against.
    snout_centre = (0.0, HEAD_CENTRE[1] + HEAD_HALF[1] - 0.01, HEAD_CENTRE[2] - 0.075)
    paint(rounded_block(bm, snout_centre, (0.075, 0.05, 0.048), roundness=0.5),
          SLOT, "boarCream")

    # Eyes: small and set high on a head this blunt, so the animal still
    # reads as facing forward from directly above.
    for side in (-1, 1):
        paint(rounded_block(bm, (side * 0.10, HEAD_CENTRE[1] + 0.02, HEAD_CENTRE[2] + 0.05),
                            (0.02, 0.012, 0.017), roundness=0.7), SLOT, "dark")

    # Ears: small and pointed, wide apart — a boar is read by its tusks and
    # its width, not by its ears, so they get few faces.
    for side in (-1, 1):
        base = (side * 0.115, HEAD_CENTRE[1] - 0.10, HEAD_CENTRE[2] + 0.135)
        tip = (side * 0.155, HEAD_CENTRE[1] - 0.03, HEAD_CENTRE[2] + 0.205)
        paint(cone(bm, base, 0.05, tip, sides=4, turn=math.pi / 4), SLOT, "boarFur")

    # Tusks: pale hooks that curve up and out from the snout, forward then in
    # on themselves. The one mark a top-down camera actually resolves.
    for side in (-1, 1):
        points = [
            (side * 0.085, snout_centre[1] - 0.01, snout_centre[2] - 0.01, 0.026),
            (side * 0.140, snout_centre[1] + 0.045, snout_centre[2] + 0.03, 0.019),
            (side * 0.175, snout_centre[1] + 0.065, snout_centre[2] + 0.09, 0.012),
            (side * 0.155, snout_centre[1] + 0.045, snout_centre[2] + 0.145, 0.005),
        ]
        rings = rings_at(bm, points, sides=6, squareness=0.2)
        paint(loft(bm, rings, cap_first=False), SLOT, "boarCream")


# Base to tip, as (y, z, radius). A tight low curl — the one shape on the
# rump, and short enough it never competes with the tusks for attention.
TAIL_PATH = [
    (-0.545, 0.395, 0.030),
    (-0.590, 0.375, 0.022),
    (-0.610, 0.345, 0.015),
    (-0.590, 0.320, 0.010),
]


def build_tail(bm):
    rings = rings_along(bm, TAIL_PATH, sides=5, squareness=0.3)
    paint(loft(bm, rings, cap_last=False), SLOT, "boarFur")


# ------------------------------------------------------------------ the legs

# Local to the hip: (z, y offset, radius). Thick and short — a boar is built
# low and wide, and the first ring sits above the hip and inside the body.
LEG = [
    (0.050, 0.000, 0.086),
    (-0.055, 0.004, 0.072),
    (-0.150, 0.008, 0.056),
    (-0.235, 0.010, 0.050),
    (-0.275, 0.010, 0.050),
]

LEGS = {
    "legFrontLeft": (-0.185, 0.180),
    "legFrontRight": (0.185, 0.180),
    "legBackLeft": (-0.135, -0.350),
    "legBackRight": (0.135, -0.350),
}


def build():
    clear_scene()
    materials = build_materials(COLOURS, MATERIAL_ORDER)
    build_body(materials)
    for name, (hip_x, hip_y) in LEGS.items():
        build_leg(name, hip_x, hip_y, HIP_HEIGHT, LEG, 0.028, materials,
                  SLOT, "boarFur", "boarCream", paw_half=(0.062, 0.072, 0.026))
    bpy.ops.export_scene.gltf(filepath=MODEL_PATH,
                              export_format="GLB",
                              export_yup=True,
                              export_apply=True)
    return MODEL_PATH


build()
