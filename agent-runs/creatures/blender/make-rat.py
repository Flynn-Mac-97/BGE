# Builds `kitten-survivors/assets/models/rat.glb`, the horde's floor.
#
# Run inside Blender: paste into the Text Editor and press Run, or send
# `exec(open(r'<this file>').read())` through BlenderMCP. It clears the scene.
#
# Same rules as make-kitten.py: feet on the origin, nose at Blender +Y, four
# leg objects legFrontLeft..legBackRight with their origin at the hip, and the
# hip buried inside the body mass.
#
# THE OUTLINE SAYS: two discs standing outboard of a small low body, and one
# thin line dragging behind it. The ear span is 0.34 m against a 0.19 m body,
# so the discs are nearly twice the width of the thing carrying them, and the
# tail runs 0.24 m behind the rump at a fifth of their thickness. Six families
# have to be told apart with the colour removed, so the rat owns "twin discs
# plus a trailing line" and nothing else may be it.
#
# Both are held under the cat: a rat that draws more pixels than the player is
# a rat the player looks at instead of the player. Measured at play distance,
# the cat is 0.5 m across and 0.67 m tall; the rat clears neither.
#
# The ears are discs rather than cones because a disc keeps its full outline
# when the camera looks down at it, and the camera always looks down at it.
#
# Warm rust at 0.29 luminance. Every prop is held above 0.44, so a rat crossing
# one never shares its value; the hue keeps it off the crow and the hound,
# which are the other dark families.

LIB_PATH = globals().get(
    "LIB_PATH", "Z:/Code/browser game engine/tools/blender/lib.py")
exec(open(globals().get(
    "CREATURE_LIB",
    "Z:/Code/browser game engine/agent-runs/creatures/blender/creature-lib.py")).read())

MODEL_PATH = globals().get(
    "MODEL_PATH", "Z:/Code/browser game engine/kitten-survivors/assets/models/rat.glb")

# types/rat.js declares the hull [0.42, 0.32, 0.62]. The ears overshoot it.
HIP_HEIGHT = 0.072

COLOURS = {
    "ratFur": "#8f3d25",     # 0.301 luminance, warm rust, saturated against a green field
    "ratBelly": "#6d3a2e",   # 0.266, belly and paws — faces down, so it carries no shape
    "ratEar": "#82384a",     # 0.287, ear discs, nose and tail; deep rose, still the rat's own hue
    "ratWhite": "#fffdf5",   # eye whites and the two front teeth
    "dark": "#2a1c20",       # 0.123, pupils and the ear rims behind the discs
}
MATERIAL_ORDER = ["ratFur", "ratBelly", "ratEar", "ratWhite", "dark"]
SLOT = {name: index for index, name in enumerate(MATERIAL_ORDER)}


# ------------------------------------------------------------------ the body

# Tail to neck, as (y, centre z, half width, half height). Short and round so
# the head can be a third of the animal.
BODY_RINGS = [
    (-0.200, 0.115, 0.030, 0.026),   # tail cap
    (-0.170, 0.120, 0.076, 0.068),   # rump
    (-0.115, 0.126, 0.094, 0.084),   # hips, the widest point
    (-0.045, 0.124, 0.082, 0.076),   # waist
    (0.020, 0.130, 0.090, 0.082),    # ribs
    (0.070, 0.140, 0.072, 0.066),    # neck
]
BODY_SECTIONS = 9
BELLY_ABOVE = -0.40

HEAD_CENTRE = (0.0, 0.150, 0.168)
# Smaller than the ears it carries. The discs have to be the shape the eye
# lands on, and a head their size makes the whole thing one lump again.
HEAD_HALF = (0.090, 0.088, 0.084)


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
    rings = [ring(bm, *values, sides=8, squareness=0.58) for values in sections]

    body = loft(bm, rings)
    for face in body:
        centre = face.calc_center_median()
        centre_z, _, half_height = body_profile(centre.y)
        above = (centre.z - centre_z) / max(half_height, 1e-6)
        face.material_index = (SLOT["ratBelly"] if above < BELLY_ABOVE
                               else SLOT["ratFur"])

    build_head(bm)
    build_tail(bm)
    return finish(bm, "ratBody", materials)


def build_head(bm):
    made = rounded_block(bm, HEAD_CENTRE, HEAD_HALF, roundness=0.72)
    paint(made, SLOT, "ratFur")

    # Snout: a pale wedge with a pink nose on the end. It keeps the front of
    # the head off the body colour so the face reads as a face.
    paint(rounded_block(bm, (0.0, HEAD_CENTRE[1] + 0.078, HEAD_CENTRE[2] - 0.032),
                        (0.048, 0.048, 0.038), roundness=0.6), SLOT, "ratBelly")
    paint(cone(bm, (0.0, HEAD_CENTRE[1] + 0.112, HEAD_CENTRE[2] - 0.026), 0.020,
               (0.0, HEAD_CENTRE[1] + 0.140, HEAD_CENTRE[2] - 0.040),
               sides=4, turn=math.pi / 4), SLOT, "ratEar")

    # Two front teeth. Two white blocks under the snout is the shortest way to
    # say "rodent", and white is the one value the rest of the model never uses.
    for side in (-1, 1):
        paint(rounded_block(bm, (side * 0.017, HEAD_CENTRE[1] + 0.108,
                                 HEAD_CENTRE[2] - 0.070),
                            (0.014, 0.014, 0.026), roundness=0.25), SLOT, "ratWhite")

    eyes(bm, SLOT, 0.056, HEAD_CENTRE[1] + 0.062, HEAD_CENTRE[2] + 0.030,
         (0.030, 0.018, 0.028), (0.019, 0.014, 0.019),
         "ratWhite", "dark", forward=0.012)

    # The ears. Everything else on this model exists to hold them up: two discs
    # standing upright and turned out, their outer rims 0.170 m from the centre
    # line against a body half-width of 0.094. The dark rim behind is a step
    # larger than the rose face, so the disc keeps an edge of its own when the
    # screen-space outline is not what is separating it.
    for side in (-1, 1):
        centre = (side * 0.078, HEAD_CENTRE[1] - 0.014, HEAD_CENTRE[2] + 0.106)
        lean = (1.62, side * 0.34, 0.0)
        back = plate(bm, (centre[0], centre[1] - 0.012, centre[2]),
                     0.092, 0.098, 0.018, sides=8, tilt=lean)
        paint(back, SLOT, "dark")
        paint(plate(bm, centre, 0.078, 0.084, 0.018, sides=8, tilt=lean),
              SLOT, "ratEar")
        made += back
    return made


# Base to tip, as (y, z, radius). It runs 0.20 m behind the rump at a fifth of
# the ear thickness and finishes almost on the ground: the second half of the
# outline claim, and the reason a rat is not a hamster. It stops where it does
# so the whole rat stays inside the 0.62 m hull types/rat.js declares, and so
# the commonest enemy never draws more pixels than the player.
TAIL_PATH = [
    (-0.198, 0.114, 0.024),
    (-0.246, 0.096, 0.018),
    (-0.292, 0.076, 0.013),
    (-0.332, 0.058, 0.010),
    (-0.366, 0.042, 0.007),
    (-0.394, 0.032, 0.005),
]


def build_tail(bm):
    rings = rings_along(bm, TAIL_PATH, sides=5, squareness=0.3)
    faces = loft(bm, rings, cap_last=False)
    paint(faces, SLOT, "ratEar")
    return faces


# ------------------------------------------------------------------ the legs

# Local to the hip: (z, y offset, radius). Stubs — a rat scurries low, and at
# this size a modelled joint is four wasted vertices.
LEG = [
    (0.024, 0.000, 0.030),
    (-0.020, 0.001, 0.026),
    (-0.055, 0.002, 0.022),
    (-0.072, 0.002, 0.021),
]

LEGS = {
    "legFrontLeft": (-0.066, 0.052),
    "legFrontRight": (0.066, 0.052),
    "legBackLeft": (-0.076, -0.108),
    "legBackRight": (0.076, -0.108),
}


def build():
    clear_scene()
    materials = build_materials(COLOURS, MATERIAL_ORDER)
    build_body(materials)
    for name, (hip_x, hip_y) in LEGS.items():
        build_leg(name, hip_x, hip_y, HIP_HEIGHT, LEG, 0.012, materials,
                  SLOT, "ratFur", "ratBelly", paw_half=(0.026, 0.032, 0.012))
    return export(MODEL_PATH, posed=list(LEGS))


print(build())
