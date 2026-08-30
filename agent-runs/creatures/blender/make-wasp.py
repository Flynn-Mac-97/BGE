# Builds `kitten-survivors/assets/models/wasp.glb`, the fastest enemy.
#
# Run inside Blender: paste into the Text Editor and press Run, or send
# `exec(open(r'<this file>').read())` through BlenderMCP. It clears the scene.
#
# Feet on the origin, nose at Blender +Y. Two wing objects wingLeft and
# wingRight with their origin at the wing root, swept back so the X rotation
# engine/render.js applies reads as a buzz at the tip.
#
# The smallest thing in the game, so it gets the loudest colour and the
# simplest shape: a hot yellow teardrop with TWO fat black bands and a long
# pale sting. Two bands, not six — six is a texture, and art/world/bible.md
# spends no detail on texture. Two bands each a third of the abdomen are
# geometry, and they still say wasp at 2% of a phone screen.
#
# It flies higher than the crow, so the plan view is all the player gets: from
# directly above it is a yellow-and-black barred oval with a spike out the
# back and two pale wings. Nothing else on the meadow is yellow.

LIB_PATH = globals().get(
    "LIB_PATH", "Z:/Code/browser game engine/tools/blender/lib.py")
exec(open(globals().get(
    "CREATURE_LIB",
    "Z:/Code/browser game engine/agent-runs/creatures/blender/creature-lib.py")).read())

MODEL_PATH = globals().get(
    "MODEL_PATH", "Z:/Code/browser game engine/kitten-survivors/assets/models/wasp.glb")

# types/wasp.js declares the hull [0.24, 0.22, 0.44]. The wings overshoot it.
ROOT = (0.030, 0.020, 0.150)

COLOURS = {
    "waspYellow": "#ffc31f",  # the loudest colour in the game, on the smallest thing
    "waspBlack": "#241f27",   # two bands, the thorax, the eyes
    "waspWing": "#e4f2fb",    # pale, so the wings show against a green field
    "waspSting": "#fff6de",   # the sting and the eye whites
    "waspOutline": "#2a1800",  # the inverted hull, a dark of the wasp's own hue
}
MATERIAL_ORDER = ["waspYellow", "waspBlack", "waspWing", "waspSting",
                  "waspOutline"]
SLOT = {name: index for index, name in enumerate(MATERIAL_ORDER)}


# --------------------------------------------------------------- the abdomen

# Sting end to thorax, as (y, centre z, half width, half height).
BODY_RINGS = [
    (-0.196, 0.128, 0.018, 0.016),   # the point the sting leaves
    (-0.160, 0.132, 0.052, 0.048),
    (-0.108, 0.140, 0.078, 0.072),   # the widest point
    (-0.048, 0.146, 0.074, 0.068),
    (0.004, 0.150, 0.058, 0.054),    # the waist into the thorax
]
BODY_SECTIONS = 13

# Two bands, as fractions along the abdomen. Wide enough to be shapes.
BANDS = [(0.20, 0.36), (0.54, 0.70)]

HEAD_CENTRE = (0.0, 0.128, 0.156)
HEAD_HALF = (0.062, 0.052, 0.056)


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


def banded(y):
    sting_end, waist = BODY_RINGS[0][0], BODY_RINGS[-1][0]
    along = (y - sting_end) / (waist - sting_end)
    return any(low <= along <= high for low, high in BANDS)


def build_body(materials):
    bm = bmesh.new()

    sting_end, waist = BODY_RINGS[0][0], BODY_RINGS[-1][0]
    sections = []
    for index in range(BODY_SECTIONS):
        y = sting_end + (waist - sting_end) * index / (BODY_SECTIONS - 1)
        sections.append((y,) + body_profile(y))
    rings = [ring(bm, *values, sides=8, squareness=0.5) for values in sections]

    silhouette = loft(bm, rings)
    for face in silhouette:
        face.material_index = (SLOT["waspBlack"]
                               if banded(face.calc_center_median().y)
                               else SLOT["waspYellow"])

    silhouette += build_sting(bm)
    silhouette += build_thorax(bm)
    silhouette += build_head(bm)
    add_shell(bm, silhouette, 0.011, SLOT, "waspOutline")
    return finish(bm, "waspBody", materials)


def build_sting(bm):
    made = cone(bm, (0.0, -0.194, 0.128), 0.016, (0.0, -0.286, 0.116),
                sides=4, turn=math.pi / 4)
    paint(made, SLOT, "waspSting")
    return made


def build_thorax(bm):
    made = rounded_block(bm, (0.0, 0.038, 0.152), (0.066, 0.048, 0.058),
                         roundness=0.7)
    paint(made, SLOT, "waspBlack")
    return made


def build_head(bm):
    made = rounded_block(bm, HEAD_CENTRE, HEAD_HALF, roundness=0.8)
    paint(made, SLOT, "waspYellow")

    # Eyes big enough to be a third of the head. On a body this small an eye
    # is the only thing that says which end is the front.
    eyes(bm, SLOT, 0.042, HEAD_CENTRE[1] + 0.022, HEAD_CENTRE[2] + 0.010,
         (0.026, 0.024, 0.030), (0.017, 0.017, 0.020),
         "waspSting", "waspBlack", forward=0.010)

    for side in (-1, 1):
        antenna = cone(bm, (side * 0.026, HEAD_CENTRE[1] + 0.030,
                            HEAD_CENTRE[2] + 0.046), 0.009,
                       (side * 0.052, HEAD_CENTRE[1] + 0.068,
                        HEAD_CENTRE[2] + 0.086), sides=3)
        paint(antenna, SLOT, "waspBlack")
    return made


# ------------------------------------------------------------------ the wings

# Local to the root: (x out, leading y, trailing y). Short and broad, swept
# back so the tip rises and falls when the node turns.
WING = [
    (0.000, 0.046, -0.030),
    (0.062, 0.040, -0.062),
    (0.126, 0.010, -0.086),
    (0.172, -0.032, -0.090),
    (0.196, -0.076, -0.078),
]


def build_wing(name, side, materials):
    bm = bmesh.new()
    sections = [(side * across, leading, trailing)
                for across, leading, trailing in WING]
    # Mirroring x reverses the winding, so the left wing is skinned tip to root.
    if side < 0:
        sections.reverse()
    paint(blade(bm, sections, 0.012, 0.0), SLOT, "waspWing")
    return finish(bm, name, materials,
                  origin=(side * ROOT[0], ROOT[1], ROOT[2]))


def build():
    clear_scene()
    materials = build_materials(COLOURS, MATERIAL_ORDER)
    flat_dark("waspOutline")
    build_body(materials)
    build_wing("wingLeft", -1, materials)
    build_wing("wingRight", 1, materials)
    return export(MODEL_PATH, posed=["wingLeft", "wingRight"])


print(build())
