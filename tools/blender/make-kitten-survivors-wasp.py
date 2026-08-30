# Builds `kitten-survivors/assets/models/wasp.glb`, the one that will not be
# dodged.
#
# Run inside Blender: paste into the Text Editor and press Run, or send
# `exec(open(r'<this file>').read())` through BlenderMCP. It clears the scene.
#
# Ground rule still holds — feet on the origin, nose at Blender +Y — even
# though a wasp flies: `properties.hover` lifts the entity, and the model's
# own lowest point is what "feet" means here. No legs: at this size and this
# camera distance a wasp's legs are noise, and the whole point of the model
# is the one shape a rat, a boar and a hound cannot have — a waist pinched
# almost to nothing between a small thorax and a banded abdomen. That waist
# is the fix for the old model's fault: a banded TUBE with no waist reads as
# a caterpillar, and a wasp is not a caterpillar.

LIB_PATH = globals().get("LIB_PATH", "Z:/Code/browser game engine/tools/blender/lib.py")
exec(open(LIB_PATH).read())

MODEL_PATH = globals().get(
    "MODEL_PATH", "Z:/Code/browser game engine/kitten-survivors/assets/models/wasp.glb")

COLOURS = {
    "waspFur": "#f0b428",    # body — bright warm yellow, the only warm colour by size alone
    "waspBand": "#221c14",   # the abdomen bands — a real wasp marking, not a caterpillar one
    "waspWing": "#e8dfc8",   # wings, pale and warm
    "dark": "#1c1712",       # eyes
}
MATERIAL_ORDER = ["waspFur", "waspBand", "waspWing", "dark"]
SLOT = {name: index for index, name in enumerate(MATERIAL_ORDER)}


# ------------------------------------------------------------------ the body

# Stinger to head, as (y, centre z, half width, half height). The waist ring
# is the point of this list: half the width of the thorax on either side of
# it, which is the one shape that reads as an insect rather than a grub.
BODY_RINGS = [
    (-0.190, 0.045, 0.006, 0.006),   # stinger tip
    (-0.160, 0.049, 0.050, 0.046),   # abdomen rear — the model's lowest point
    (-0.085, 0.055, 0.062, 0.058),   # abdomen, the widest point
    (-0.020, 0.055, 0.050, 0.046),   # abdomen front
    (0.014, 0.059, 0.016, 0.016),    # waist — pinched almost to nothing
    (0.058, 0.065, 0.048, 0.044),    # thorax, where the wings root
    (0.098, 0.069, 0.028, 0.026),    # neck
]
BODY_SECTIONS = 15

# Bands sit only on the abdomen, between these two y values, every second
# ring — never on the thorax or the waist, so the pinch always reads clean.
BAND_FROM = -0.16
BAND_TO = -0.02
BAND_EVERY = 2

HEAD_CENTRE = (0.0, 0.132, 0.073)
HEAD_HALF = (0.030, 0.026, 0.026)


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
    rings = [ring(bm, *values, sides=8, squareness=0.4) for values in sections]

    faces = loft(bm, rings)
    around = len(rings[0])
    for index, face in enumerate(faces):
        segment = index // around
        centre = face.calc_center_median()
        banded = (BAND_FROM <= centre.y <= BAND_TO) and (segment % BAND_EVERY == 0)
        face.material_index = SLOT["waspBand"] if banded else SLOT["waspFur"]

    build_head(bm)

    return finish(bm, "waspTorso", materials)


def build_head(bm):
    paint(rounded_block(bm, HEAD_CENTRE, HEAD_HALF, roundness=0.65), SLOT, "waspFur")

    # Eyes: large for the head's size — two dark discs are what makes a spot
    # this small still read as facing something.
    for side in (-1, 1):
        paint(rounded_block(bm, (side * 0.020, HEAD_CENTRE[1] + 0.006, HEAD_CENTRE[2] + 0.002),
                            (0.012, 0.010, 0.011), roundness=0.8), SLOT, "dark")


# ------------------------------------------------------------------ the wings

WING_ROOT = (0.0, 0.058, 0.073)   # the thorax — matches the thorax body ring


def build_wing(name, side, materials):
    bm = bmesh.new()
    # Local to WING_ROOT. One flat lobe is enough at this size — a second
    # segment would be faces nobody a metre away can resolve.
    paint(rounded_block(bm, (side * 0.075, -0.015, -0.004), (0.062, 0.038, 0.006),
                        roundness=0.4), SLOT, "waspWing")
    return finish(bm, name, materials, origin=WING_ROOT)


def build():
    clear_scene()
    materials = build_materials(COLOURS, MATERIAL_ORDER)
    build_body(materials)
    for side, name in ((-1, "wingLeft"), (1, "wingRight")):
        build_wing(name, side, materials)
    bpy.ops.export_scene.gltf(filepath=MODEL_PATH,
                              export_format="GLB",
                              export_yup=True,
                              export_apply=True)
    return MODEL_PATH


build()
