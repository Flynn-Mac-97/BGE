# Builds `kitten-survivors/assets/models/crow.glb`, the flock.
#
# Run inside Blender: paste into the Text Editor and press Run, or send
# `exec(open(r'<this file>').read())` through BlenderMCP. It clears the scene.
#
# Ground rule still holds — feet on the origin, nose at Blender +Y — even
# though a crow flies: `properties.hover` lifts the entity, and the model's
# own lowest point (the tucked talons) is what "feet" means here. A crow has
# no legFrontLeft-style quadruped legs, so the parts a future flap would swing
# are named wingLeft and wingRight instead, each with its origin at the
# shoulder and buried in the body — the same reason a quadruped's hip is.
#
# The body is small and mostly hidden; the wings, spread wide and flat, are
# the whole of what a top-down camera resolves, and they overshoot the
# collider on purpose — the hull is what a weapon hits, the wings are what
# says "bird".

LIB_PATH = globals().get("LIB_PATH", "Z:/Code/browser game engine/tools/blender/lib.py")
exec(open(LIB_PATH).read())

MODEL_PATH = globals().get(
    "MODEL_PATH", "Z:/Code/browser game engine/kitten-survivors/assets/models/crow.glb")

# Metres, against the 0.45 m cat. types/crow.js declares box [0.28, 0.5, 0.34].
# properties.hover lifts the entity; the model itself is built feet-on-origin
# like every other creature here.
LEG_HEIGHT = 0.10

COLOURS = {
    "crowBody": "#3a2a20",   # body — warm near-black, not the old cool purple-black
    "crowWing": "#2a1e17",   # wings, a shade darker for depth against the body
    "crowBeak": "#d9b46a",   # beak, pale and warm
    "dark": "#1c1310",       # eyes, talons
}
MATERIAL_ORDER = ["crowBody", "crowWing", "crowBeak", "dark"]
SLOT = {name: index for index, name in enumerate(MATERIAL_ORDER)}


# ------------------------------------------------------------------ the body

# Tail to neck, as (y, centre z, half width, half height). Narrow and tall —
# the opposite silhouette to a rat in every dimension, which is what makes
# the two tellable apart at a glance even before the wings are counted.
BODY_RINGS = [
    (-0.115, 0.320, 0.038, 0.044),   # tail base
    (-0.055, 0.300, 0.078, 0.088),   # belly
    (0.015, 0.335, 0.088, 0.098),    # chest, the widest point — a puffed bird
    (0.075, 0.375, 0.062, 0.070),    # shoulders, where the wings root
    (0.115, 0.410, 0.040, 0.046),    # neck
]
BODY_SECTIONS = 9

HEAD_CENTRE = (0.0, 0.145, 0.440)
HEAD_HALF = (0.056, 0.056, 0.054)


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
    rings = [ring(bm, *values, sides=8, squareness=0.5) for values in sections]
    paint(loft(bm, rings), SLOT, "crowBody")

    build_head(bm)
    build_tail(bm)

    return finish(bm, "crowTorso", materials)


def build_head(bm):
    paint(rounded_block(bm, HEAD_CENTRE, HEAD_HALF, roundness=0.6), SLOT, "crowBody")

    # Beak: a pale forward-pointing cone, angled down — the one warm-toned
    # mark on an otherwise dark bird, and where "facing" reads from.
    paint(cone(bm, (0.0, HEAD_CENTRE[1] + HEAD_HALF[1] - 0.006, HEAD_CENTRE[2] - 0.006),
               0.020, (0.0, HEAD_CENTRE[1] + HEAD_HALF[1] + 0.052, HEAD_CENTRE[2] - 0.028),
               sides=4, turn=math.pi / 4), SLOT, "crowBeak")

    for side in (-1, 1):
        paint(rounded_block(bm, (side * 0.040, HEAD_CENTRE[1] + 0.038, HEAD_CENTRE[2] + 0.020),
                            (0.014, 0.009, 0.013), roundness=0.7), SLOT, "dark")


# A small flat fan behind the body — a bird's tail spreads sideways, not up.
def build_tail(bm):
    paint(rounded_block(bm, (0.0, -0.145, 0.300), (0.062, 0.058, 0.011), roundness=0.4),
          SLOT, "crowWing")


# ------------------------------------------------------------------ the wings

# Two flat lobes per wing, root then tip, each offset outward and a little
# back so the pair reads as swept rather than as a straight bar. Chunky and
# flat is the point at this budget — a true rotated aerofoil costs faces this
# model does not need to spend.
WING_ROOT = (0.0, 0.075, 0.375)   # the shoulder — matches the shoulders body ring


def build_wing(name, side, materials):
    bm = bmesh.new()
    # Coordinates here are LOCAL to WING_ROOT, since the object's own origin
    # sits there once `finish` places it — everything below is relative to
    # the shoulder, not to the body centre.
    paint(rounded_block(bm, (side * 0.145, -0.055, -0.015), (0.100, 0.075, 0.014), roundness=0.35),
          SLOT, "crowWing")
    paint(rounded_block(bm, (side * 0.290, -0.095, -0.030), (0.078, 0.052, 0.010), roundness=0.35),
          SLOT, "crowWing")
    return finish(bm, name, materials, origin=WING_ROOT)


# ------------------------------------------------------------------- the legs

# Thin and tucked, hanging almost straight down from the belly — a crow in
# flight folds its legs against the body, so they carry almost no silhouette.
LEG = [
    (0.020, 0.000, 0.014),
    (-0.040, 0.000, 0.011),
    (-0.085, 0.000, 0.008),
    (-0.095, 0.000, 0.008),
]

LEGS = {
    "legLeft": (-0.024, -0.030),
    "legRight": (0.024, -0.030),
}


def build():
    clear_scene()
    materials = build_materials(COLOURS, MATERIAL_ORDER)
    build_body(materials)
    for side, name in ((-1, "wingLeft"), (1, "wingRight")):
        build_wing(name, side, materials)
    for name, (hip_x, hip_y) in LEGS.items():
        build_leg(name, hip_x, hip_y, LEG_HEIGHT, LEG, 0.006, materials,
                  SLOT, "crowBody", "dark", paw_half=(0.012, 0.016, 0.006))
    bpy.ops.export_scene.gltf(filepath=MODEL_PATH,
                              export_format="GLB",
                              export_yup=True,
                              export_apply=True)
    return MODEL_PATH


build()
