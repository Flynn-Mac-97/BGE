# Builds `kitten-survivors/assets/models/rat.glb`, the horde's floor.
#
# Run inside Blender: paste into the Text Editor and press Run, or send
# `exec(open(r'<this file>').read())` through BlenderMCP. It clears the scene.
#
# Same four rules as make-kitten-survivors-kitten.py: feet on the origin, nose
# at Blender +Y, four leg objects named legFrontLeft..legBackRight with their
# origin at the hip, hip buried inside the body mass.
#
# Comic and top-heavy: a big round head with two oversized paddle ears is most
# of what a top-down camera resolves, so the ears carry the silhouette rather
# than a marking. The dark saddle is one patch that follows the spine and
# narrows at each end, not a periodic band — a banded tube reads as a
# caterpillar from above, and a rat is not a caterpillar. A long thin tail
# drags flat and low behind it, the one part of a rat taller than nothing.

# LIB_PATH and MODEL_PATH may be set by the caller before this file is exec'd
# (BlenderMCP runs a script string in one shared namespace), so the same file
# runs unmodified from any checkout of this repo, worktree or main.
LIB_PATH = globals().get("LIB_PATH", "Z:/Code/browser game engine/tools/blender/lib.py")
exec(open(LIB_PATH).read())

MODEL_PATH = globals().get(
    "MODEL_PATH", "Z:/Code/browser game engine/kitten-survivors/assets/models/rat.glb")

# Metres, against the 0.45 m cat. types/rat.js declares box [0.42, 0.32, 0.62].
HIP_HEIGHT = 0.10

COLOURS = {
    "ratFur": "#a3552b",     # body — warm rust brown, saturated against a bright field
    "ratSaddle": "#7a3418",  # one dark patch down the spine, not a band
    "ratCream": "#ecd2a8",   # belly, paws, tail tip
    "ratEar": "#d98a94",     # inner ear, nose
    "dark": "#241a18",       # eyes, ear rim
}
MATERIAL_ORDER = ["ratFur", "ratSaddle", "ratCream", "ratEar", "dark"]
SLOT = {name: index for index, name in enumerate(MATERIAL_ORDER)}


# ------------------------------------------------------------------ the body

# Tail cap to neck, as (y, centre z, half width, half height). Short and
# round rather than sleek: the hips are the widest point and the waist barely
# pinches, which is what "top-heavy" means at this budget.
BODY_RINGS = [
    (-0.270, 0.170, 0.034, 0.030),   # tail cap
    (-0.230, 0.182, 0.088, 0.078),   # rump
    (-0.160, 0.192, 0.104, 0.092),   # hips, the widest point
    (-0.070, 0.184, 0.082, 0.074),   # waist, a shallow pinch
    (0.020, 0.190, 0.098, 0.086),    # ribs
    (0.095, 0.198, 0.090, 0.080),    # shoulders
    (0.155, 0.218, 0.058, 0.054),    # neck
]
BODY_SECTIONS = 13

# The saddle patch sits on the back between these two y values and tapers out
# by the ring's own narrowing width — no separate falloff needed.
SADDLE_FROM = -0.215
SADDLE_TO = 0.075
SADDLE_ABOVE = 0.30
BELLY_ABOVE = -0.40

HEAD_CENTRE = (0.0, 0.235, 0.240)
HEAD_HALF = (0.082, 0.076, 0.076)


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
    rings = [ring(bm, *values, sides=8, squareness=0.62) for values in sections]

    faces = loft(bm, rings)
    for face in faces:
        centre = face.calc_center_median()
        centre_z, _, half_height = body_profile(centre.y)
        above = (centre.z - centre_z) / max(half_height, 1e-6)
        if above < BELLY_ABOVE:
            face.material_index = SLOT["ratCream"]
        elif above > SADDLE_ABOVE and SADDLE_FROM <= centre.y <= SADDLE_TO:
            face.material_index = SLOT["ratSaddle"]
        else:
            face.material_index = SLOT["ratFur"]

    build_head(bm)
    build_tail(bm)

    return finish(bm, "ratBody", materials)


def build_head(bm):
    for face in rounded_block(bm, HEAD_CENTRE, HEAD_HALF, roundness=0.6):
        face.material_index = SLOT["ratFur"]

    # Nose: low and blunt, level with the head's own mid-height — a rat's
    # snout points forward, not up.
    paint(cone(bm, (0.0, HEAD_CENTRE[1] + HEAD_HALF[1] - 0.006, HEAD_CENTRE[2] - 0.01),
               0.016, (0.0, HEAD_CENTRE[1] + HEAD_HALF[1] + 0.032, HEAD_CENTRE[2] - 0.014),
               sides=4, turn=math.pi / 4), SLOT, "ratEar")

    # Eyes: two dark dots forward on the head, enough to read as facing.
    for side in (-1, 1):
        paint(rounded_block(bm, (side * 0.046, HEAD_CENTRE[1] + 0.052, HEAD_CENTRE[2] + 0.014),
                            (0.017, 0.010, 0.015), roundness=0.7), SLOT, "dark")

    # Ears: two oversized paddles, the whole point of a rat seen from above.
    # A flattened 8-sided cone reads as a round disc, tilted out and slightly
    # back so its broad face turns toward the camera.
    for side in (-1, 1):
        base = (side * 0.062, HEAD_CENTRE[1] - 0.028, HEAD_CENTRE[2] + 0.058)
        tip = (side * 0.148, HEAD_CENTRE[1] - 0.058, HEAD_CENTRE[2] + 0.128)
        for face in cone(bm, base, 0.072, tip, sides=8, turn=0.0):
            centre = face.calc_center_median()
            face.material_index = (SLOT["ratEar"] if centre.z > base[2]
                                   else SLOT["dark"])


# Base to tip, as (y, z, radius). It drags low and flat behind the rat, the
# opposite of the kitten's raised tail, and the longest line on the model.
TAIL_PATH = [
    (-0.268, 0.168, 0.028),
    (-0.330, 0.140, 0.022),
    (-0.395, 0.105, 0.016),
    (-0.455, 0.072, 0.011),
    (-0.505, 0.045, 0.007),
    (-0.545, 0.028, 0.004),
]


def build_tail(bm):
    rings = rings_along(bm, TAIL_PATH, sides=6, squareness=0.3)
    faces = loft(bm, rings, cap_last=False)
    around = len(rings[0])
    for index, face in enumerate(faces):
        segment = index // around
        face.material_index = (SLOT["ratCream"] if segment >= len(rings) - 2
                               else SLOT["ratFur"])


# ------------------------------------------------------------------ the legs

# Local to the hip: (z, y offset, radius). Short and stubby — a rat scurries
# low, and the first ring sits above the hip and inside the body so a static
# leg still reads as attached rather than stuck on.
LEG = [
    (0.025, 0.000, 0.026),
    (-0.015, 0.001, 0.022),
    (-0.055, 0.002, 0.017),
    (-0.088, 0.003, 0.014),
    (-0.098, 0.003, 0.014),
]

LEGS = {
    "legFrontLeft": (-0.070, 0.100),
    "legFrontRight": (0.070, 0.100),
    "legBackLeft": (-0.082, -0.150),
    "legBackRight": (0.082, -0.150),
}


def build():
    clear_scene()
    materials = build_materials(COLOURS, MATERIAL_ORDER)
    build_body(materials)
    for name, (hip_x, hip_y) in LEGS.items():
        build_leg(name, hip_x, hip_y, HIP_HEIGHT, LEG, 0.010, materials,
                  SLOT, "ratFur", "ratCream")
    bpy.ops.export_scene.gltf(filepath=MODEL_PATH,
                              export_format="GLB",
                              export_yup=True,
                              export_apply=True)
    return MODEL_PATH


build()
