# Builds `kitten-survivors/assets/models/wasp.glb`, the fastest enemy.
#
# Run inside Blender: paste into the Text Editor and press Run, or send
# `exec(open(r'<this file>').read())` through BlenderMCP. It clears the scene.
#
# Feet on the origin, nose at Blender +Y. Two wing objects wingLeft and
# wingRight with their origin at the wing root, swept back so the X rotation
# engine/render.js applies reads as a buzz at the tip.
#
# THE OUTLINE SAYS: a needle. It is 0.61 m from nose to sting against 0.12 m
# across — five times as long as it is wide, where nothing else in the game
# passes two. The wings are short enough to stay inside that line, so the wasp
# never reads as the crow's chevron. Six families have to be told apart with
# the colour removed, so the wasp owns "a straight line with a spike" and
# nothing else may be it.
#
# Saturated amber with TWO fat black bands, mass 0.30 luminance. The amber
# itself is 0.45, the brightest mass in the horde, because the wasp is the
# smallest thing on the field and the one that must not be missed.
#
# It stops at 0.45 and not higher. Hot yellow measures 0.77 and the lit ground
# measures 0.68, so a brighter wasp vanishes crossing open meadow; the cat's
# ginger marks are 0.61 and the wasp must stay under them.
#
# The black bands hold the dark end. A body that is one flat mid tone reads as
# a sticker, and the keyline — near-black, constant screen width — needs the
# body to be lighter than it is.
#
# Two bands, not six — six is a texture, and art/world/bible.md spends no
# detail on texture. Two bands each a fifth of the abdomen are geometry, and
# they still say wasp at 2% of a phone screen.

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
    "waspAmber": "#ad6a10",   # 0.446 luminance, hue 34, the most saturated hue in the horde
    "waspBlack": "#1a1520",   # 0.089, two bands, the thorax, the eyes
    "waspWing": "#cfe0ee",    # pale and small; a mark, not mass
    "waspSting": "#ffeec2",   # the sting and the eye whites
}
MATERIAL_ORDER = ["waspAmber", "waspBlack", "waspWing", "waspSting"]
SLOT = {name: index for index, name in enumerate(MATERIAL_ORDER)}


# --------------------------------------------------------------- the abdomen

# Sting end to thorax, as (y, centre z, half width, half height). Half again
# as long as the old abdomen and a quarter narrower: length against width is
# the whole outline claim, so both ends of that ratio are pushed.
BODY_RINGS = [
    (-0.300, 0.126, 0.013, 0.012),   # the point the sting leaves
    (-0.250, 0.130, 0.042, 0.040),
    (-0.170, 0.138, 0.058, 0.056),   # the widest point
    (-0.080, 0.144, 0.052, 0.050),
    (0.004, 0.150, 0.042, 0.040),    # the waist into the thorax
]
BODY_SECTIONS = 15

# Two bands, as fractions along the abdomen. Wide enough to be shapes.
BANDS = [(0.24, 0.40), (0.56, 0.72)]

HEAD_CENTRE = (0.0, 0.128, 0.156)
HEAD_HALF = (0.050, 0.044, 0.046)


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

    body = loft(bm, rings)
    for face in body:
        face.material_index = (SLOT["waspBlack"]
                               if banded(face.calc_center_median().y)
                               else SLOT["waspAmber"])

    build_sting(bm)
    build_thorax(bm)
    build_head(bm)
    return finish(bm, "waspBody", materials)


def build_sting(bm):
    # Straight and in line with the body, not curled. A curl would round the
    # end of the needle off and the outline would stop being a line.
    made = cone(bm, (0.0, -0.298, 0.126), 0.013, (0.0, -0.442, 0.112),
                sides=4, turn=math.pi / 4)
    paint(made, SLOT, "waspSting")
    return made


def build_thorax(bm):
    made = rounded_block(bm, (0.0, 0.038, 0.152), (0.052, 0.046, 0.050),
                         roundness=0.7)
    paint(made, SLOT, "waspBlack")
    return made


def build_head(bm):
    made = rounded_block(bm, HEAD_CENTRE, HEAD_HALF, roundness=0.8)
    paint(made, SLOT, "waspAmber")

    # Eyes big enough to be a third of the head. On a body this small an eye
    # is the only thing that says which end is the front.
    eyes(bm, SLOT, 0.034, HEAD_CENTRE[1] + 0.020, HEAD_CENTRE[2] + 0.008,
         (0.022, 0.020, 0.026), (0.014, 0.014, 0.017),
         "waspSting", "waspBlack", forward=0.010)

    for side in (-1, 1):
        antenna = cone(bm, (side * 0.026, HEAD_CENTRE[1] + 0.030,
                            HEAD_CENTRE[2] + 0.046), 0.009,
                       (side * 0.052, HEAD_CENTRE[1] + 0.068,
                        HEAD_CENTRE[2] + 0.086), sides=3)
        paint(antenna, SLOT, "waspBlack")
    return made


# ------------------------------------------------------------------ the wings

# Local to the root: (x out, leading y, trailing y). Short and swept back so
# the tip rises and falls when the node turns. The span is 0.30 m against
# 0.61 m of body: the wings have to stay well inside the needle, or the wasp
# starts reading as a small crow.
WING = [
    (0.000, 0.044, -0.028),
    (0.048, 0.038, -0.056),
    (0.090, 0.008, -0.076),
    (0.118, -0.030, -0.078),
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
    build_body(materials)
    build_wing("wingLeft", -1, materials)
    build_wing("wingRight", 1, materials)
    return export(MODEL_PATH, posed=["wingLeft", "wingRight"])


print(build())
