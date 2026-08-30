# Builds `kitten-survivors/assets/models/kitten.glb`, the cat the player steers.
#
# Run inside Blender: paste into the Text Editor and press Run, or send
# `exec(open(r'<this file>').read())` through BlenderMCP. It clears the scene.
#
# Four rules types/kitten.js and engine/render.js both read:
#
#   Feet on the origin. `mesh.anchor: 'feet'` drops the model by half the hull.
#   Nose at Blender +Y, which the exporter maps to glTF -Z.
#   Four leg objects legFrontLeft..legBackRight, origin AT THE HIP.
#   The hip sits inside the body mass, or a swinging leg opens a gap.
#
# The proportions are a character's, not an animal's: the head is wider than
# the ribs and nearly half the standing height, the legs are short stubs, and
# the body between them is short. At 5% of a phone screen a correctly
# proportioned cat is a smudge, and only the head-to-body ratio survives.
#
# THE OUTLINE SAYS: a hook. The tail runs back out of the rump, rises, and
# curls hard to one side, so from above the cat is a compact body with a thick
# J behind it. Six families have to be told apart with the colour removed, so
# the cat owns "a body with a hook" and nothing else may be it — the rat's tail
# is the only other line behind a body, and it is thin, dark and straight.
#
# It is also the only BRIGHT family. The measured play frame runs a median of
# 0.72 luminance and the five enemies are now held under 0.38, so the top
# surfaces of the cat — back, head and the whole upper tail — are 0.92 white
# and it is the one thing on screen above the ground. Ginger is kept for the
# ears, the legs, the flanks and the base of the tail, which the camera sees
# edge-on at 60 degrees and which read as the marks on a white cat.
#
# White on the chest, the paws and the tail tip is white this camera never
# sees: those faces point away from it, and what is left from above is a ginger
# cat at 0.67 on a 0.72 ground, which is no contrast at all.
#
# There are no tabby bars. Five dark bands across the back is surface pattern,
# the one thing art/world/bible.md forbids (edgeDensity at most 0.045), and at
# phone size it reads as noise. One ginger brow band does the same job as a
# single shape.

LIB_PATH = globals().get(
    "LIB_PATH", "Z:/Code/browser game engine/tools/blender/lib.py")
exec(open(globals().get(
    "CREATURE_LIB",
    "Z:/Code/browser game engine/agent-runs/creatures/blender/creature-lib.py")).read())

MODEL_PATH = globals().get(
    "MODEL_PATH", "Z:/Code/browser game engine/kitten-survivors/assets/models/kitten.glb")

# Metres, against the 0.45 m cat the bible sets as the ruler. types/kitten.js
# declares the hull [0.5, 0.45, 0.8]; ears and tail overshoot it on purpose,
# because the hull is what a weapon hits and the silhouette is what is found.
HIP_HEIGHT = 0.155

COLOURS = {
    "kittenWhite": "#f4e8d5",   # 0.915 luminance, the mass: back, head, tail. Warm, not paper white — a pure white clips under a 2.85 sun
    "kittenFur": "#ef8f22",     # 0.610, hot ginger, the marks: ears, legs, flanks, tail base
    "kittenCap": "#c06412",     # 0.446, the ear backs and the brow
    "kittenPink": "#ff9aa8",    # nose and inner ear
    "dark": "#241a24",          # pupils
}
MATERIAL_ORDER = ["kittenFur", "kittenCap", "kittenWhite", "kittenPink", "dark"]
SLOT = {name: index for index, name in enumerate(MATERIAL_ORDER)}


# ------------------------------------------------------------------ the body

# Tail to neck, as (y, centre z, half width, half height). Short and barrelled:
# the hips are the widest point, the waist barely pinches, and the whole run is
# 0.35 m so the head can be the rest of the animal.
BODY_RINGS = [
    (-0.235, 0.215, 0.052, 0.050),   # rump cap, where the tail leaves
    (-0.200, 0.208, 0.104, 0.096),   # rump
    (-0.140, 0.202, 0.120, 0.112),   # hips, the widest point
    (-0.060, 0.198, 0.104, 0.100),   # waist, a shallow pinch
    (0.020, 0.200, 0.118, 0.110),    # ribs
    (0.080, 0.212, 0.110, 0.102),    # shoulders
    (0.125, 0.240, 0.082, 0.078),    # neck
]
BODY_SECTIONS = 11

# The white covers everything the camera can see from 60 degrees up: one patch
# running the length of the back. No periodic band — a banded tube reads as a
# caterpillar from above, and art/world/bible.md spends no detail on pattern.
WHITE_ABOVE = 0.05

HEAD_CENTRE = (0.0, 0.255, 0.300)
HEAD_HALF = (0.150, 0.134, 0.133)


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
    rings = [ring(bm, *values, sides=8, squareness=0.60) for values in sections]

    body = loft(bm, rings)
    for face in body:
        centre = face.calc_center_median()
        centre_z, _, half_height = body_profile(centre.y)
        above = (centre.z - centre_z) / max(half_height, 1e-6)
        face.material_index = (SLOT["kittenWhite"] if above > WHITE_ABOVE
                               else SLOT["kittenFur"])

    build_head(bm)
    build_tail(bm)
    return finish(bm, "kittenBody", materials)


def build_head(bm):
    # White over the crown and the face, ginger under the cheek line. The head
    # is 40% of the standing height and it faces this camera, so it carries
    # more of the cat's mass value than anything else on the model.
    made = rounded_block(bm, HEAD_CENTRE, HEAD_HALF, roundness=0.74)
    for face in made:
        above = face.calc_center_median().z - HEAD_CENTRE[2]
        face.material_index = (SLOT["kittenWhite"] if above > -HEAD_HALF[2] * 0.30
                               else SLOT["kittenFur"])

    # A ginger brow band across the top of the face. One dark line under a
    # white crown is what stops the head reading as a featureless ball.
    paint(rounded_block(bm, (0.0, HEAD_CENTRE[1] + 0.100, HEAD_CENTRE[2] + 0.100),
                        (0.104, 0.038, 0.024), roundness=0.5), SLOT, "kittenCap")

    paint(cone(bm, (0.0, HEAD_CENTRE[1] + 0.128, HEAD_CENTRE[2] - 0.014), 0.022,
               (0.0, HEAD_CENTRE[1] + 0.160, HEAD_CENTRE[2] - 0.026),
               sides=4, turn=math.pi / 4), SLOT, "kittenPink")

    # Set high and wide: at 60 degrees down the brow hides anything lower.
    eyes(bm, SLOT, 0.078, HEAD_CENTRE[1] + 0.096, HEAD_CENTRE[2] + 0.044,
         (0.048, 0.024, 0.044), (0.030, 0.018, 0.030),
         "kittenWhite", "dark", forward=0.016)

    # Ears: two big pyramids, splayed out and tilted back. From directly above
    # they are half the silhouette, so they are sized against the head rather
    # than against a real cat.
    for side in (-1, 1):
        base = (side * 0.084, HEAD_CENTRE[1] - 0.020, HEAD_CENTRE[2] + 0.096)
        tip = (side * 0.136, HEAD_CENTRE[1] - 0.056, HEAD_CENTRE[2] + 0.250)
        ear = cone(bm, base, 0.084, tip, sides=4, turn=math.pi / 4)
        for face in ear:
            centre = face.calc_center_median()
            face.material_index = (SLOT["kittenPink"] if centre.y > base[1]
                                   else SLOT["kittenCap"])
        made += ear
    return made


# Base to tip, as (x, y, z, radius). The cat's own outline mark: a thick tail
# that runs back and up out of the rump and then hooks hard to one side, so
# from above it is a J behind the body. Nothing else in the game has a hook.
#
# The hook is in the ground plane, not in height. This camera is close to plan,
# so a metre of height projects to a fraction of a metre on screen and a purely
# vertical tail foreshortens to nothing; a metre of ground does not.
#
# Thick all the way to the tip. A tapering tail is 3 px across at the top at
# play distance, which is under the width of the outline meant to separate it.
TAIL_PATH = [
    (0.000, -0.238, 0.222, 0.056),
    (0.000, -0.302, 0.288, 0.058),
    (0.006, -0.356, 0.356, 0.058),
    (0.026, -0.400, 0.418, 0.055),
    (0.070, -0.426, 0.468, 0.051),
    (0.128, -0.430, 0.502, 0.047),
    (0.186, -0.410, 0.522, 0.043),
]


def build_tail(bm):
    rings = rings_at(bm, TAIL_PATH, sides=6, squareness=0.35)
    faces = loft(bm, rings)
    around = len(rings[0])
    for index, face in enumerate(faces):
        segment = index // around
        # Ginger for the first segment only, so the mast is one unbroken white
        # line and the ginger reads as where it leaves the body. A ringed tail
        # is a pattern, and the bible spends no pixels on pattern.
        face.material_index = (SLOT["kittenFur"] if segment < 1
                               else SLOT["kittenWhite"])
    return faces


# ------------------------------------------------------------------ the legs

# Local to the hip: (z, y offset, radius). Short, thick and barely tapered —
# a stub with a white paw, not a limb. The first ring sits above the hip and
# inside the body so a swinging leg never opens a hole at the shoulder.
FRONT_LEG = [
    (0.030, 0.000, 0.056),
    (-0.040, 0.002, 0.050),
    (-0.095, 0.004, 0.043),
    (-0.140, 0.006, 0.041),
    (-0.155, 0.006, 0.041),
]

BACK_LEG = [
    (0.030, 0.000, 0.062),
    (-0.038, -0.014, 0.056),
    (-0.088, -0.026, 0.046),
    (-0.132, -0.010, 0.041),
    (-0.155, -0.004, 0.041),
]

LEGS = {
    "legFrontLeft": (-0.090, 0.086, FRONT_LEG, 0.014),
    "legFrontRight": (0.090, 0.086, FRONT_LEG, 0.014),
    "legBackLeft": (-0.100, -0.140, BACK_LEG, 0.016),
    "legBackRight": (0.100, -0.140, BACK_LEG, 0.016),
}


def build():
    clear_scene()
    materials = build_materials(COLOURS, MATERIAL_ORDER)
    build_body(materials)
    for name, (hip_x, hip_y, path, paw_forward) in LEGS.items():
        build_leg(name, hip_x, hip_y, HIP_HEIGHT, path, paw_forward, materials,
                  SLOT, "kittenFur", "kittenWhite",
                  paw_half=(0.046, 0.056, 0.020))
    return export(MODEL_PATH, posed=list(LEGS))


print(build())
