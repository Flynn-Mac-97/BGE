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
# The kitten is the only WHITE thing in the game. A hundred enemies are warm
# mid-tones on a green field, so white is the one value nothing else claims,
# and it is spent on the face, the chest, the four paws and the tail tip — the
# parts a camera looking down at 60 degrees actually sees. The tail is held up
# and hooked because a vertical line at the centre of the frame is the fastest
# thing on screen to find.
#
# There are no tabby bars. Five dark bands across the back is surface pattern,
# the one thing art/world/bible.md forbids (edgeDensity at most 0.045), and at
# phone size it reads as noise. One dark cap over the head and shoulders does
# the same job as a single shape.

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
    "kittenFur": "#f5a03c",     # hot ginger, saturated well above the meadow
    "kittenCap": "#d2701c",     # one dark shape over head and shoulders
    "kittenWhite": "#fffaf0",   # face, chest, paws, tail tip — nothing else is white
    "kittenPink": "#ff9aa8",    # nose and inner ear
    "dark": "#241a24",          # pupils, ear backs
    "kittenOutline": "#3a1508", # the inverted hull, a near-black of the cat's own hue
}
MATERIAL_ORDER = ["kittenFur", "kittenCap", "kittenWhite", "kittenPink",
                  "dark", "kittenOutline"]
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

# The cap covers the back from the shoulders forward and the whole head. One
# patch, no periodic band: a banded tube reads as a caterpillar from above.
CAP_FROM = -0.060
CAP_ABOVE = 0.35
BELLY_ABOVE = -0.42

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

    silhouette = loft(bm, rings)
    for face in silhouette:
        centre = face.calc_center_median()
        centre_z, _, half_height = body_profile(centre.y)
        above = (centre.z - centre_z) / max(half_height, 1e-6)
        if above < BELLY_ABOVE:
            face.material_index = SLOT["kittenWhite"]
        elif above > CAP_ABOVE and centre.y > CAP_FROM:
            face.material_index = SLOT["kittenCap"]
        else:
            face.material_index = SLOT["kittenFur"]

    silhouette += build_head(bm)
    silhouette += build_tail(bm)
    add_shell(bm, silhouette, 0.020, SLOT, "kittenOutline")
    return finish(bm, "kittenBody", materials)


def build_head(bm):
    # The cap runs over the top and back of the head and stops at the brow, so
    # the face below it is one clean pale field for the eyes to sit in.
    made = rounded_block(bm, HEAD_CENTRE, HEAD_HALF, roundness=0.74)
    for face in made:
        centre = face.calc_center_median()
        above = centre.z - HEAD_CENTRE[2]
        if above > HEAD_HALF[2] * 0.30 and centre.y < HEAD_CENTRE[1] + HEAD_HALF[1] * 0.55:
            face.material_index = SLOT["kittenCap"]
        else:
            face.material_index = SLOT["kittenFur"]

    # The blaze: a wide white wedge up the front of the face. It is the single
    # brightest patch on the animal and it faces the camera at this pitch.
    paint(rounded_block(bm, (0.0, HEAD_CENTRE[1] + 0.086, HEAD_CENTRE[2] - 0.030),
                        (0.086, 0.052, 0.078), roundness=0.55), SLOT, "kittenWhite")

    # The blaze carries on over the brow, so the cat has a white mark at the
    # head end as well as at the tail tip. Those two are what a player picks
    # the cat out by when the camera is looking down at the top of it.
    paint(rounded_block(bm, (0.0, HEAD_CENTRE[1] + 0.030, HEAD_CENTRE[2] + 0.098),
                        (0.062, 0.072, 0.052), roundness=0.6), SLOT, "kittenWhite")

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


# Base to tip, as (y, z, radius). Thick and held up, hooked forward at the top:
# the one part of the cat above the horde, and the thing a player finds first.
TAIL_PATH = [
    (-0.238, 0.222, 0.052),
    (-0.272, 0.276, 0.048),
    (-0.296, 0.340, 0.043),
    (-0.302, 0.404, 0.038),
    (-0.286, 0.464, 0.033),
    (-0.248, 0.512, 0.029),
    (-0.196, 0.540, 0.026),
    (-0.142, 0.548, 0.024),
]


def build_tail(bm):
    rings = rings_along(bm, TAIL_PATH, sides=6, squareness=0.35)
    faces = loft(bm, rings)
    around = len(rings[0])
    for index, face in enumerate(faces):
        segment = index // around
        # White for the last third only. A ringed tail is a pattern, and a
        # pattern is what the bible spends no pixels on.
        face.material_index = (SLOT["kittenWhite"] if segment >= len(rings) - 3
                               else SLOT["kittenFur"])
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
    flat_dark("kittenOutline")
    build_body(materials)
    for name, (hip_x, hip_y, path, paw_forward) in LEGS.items():
        build_leg(name, hip_x, hip_y, HIP_HEIGHT, path, paw_forward, materials,
                  SLOT, "kittenFur", "kittenWhite",
                  paw_half=(0.046, 0.056, 0.020))
    return export(MODEL_PATH, posed=list(LEGS))


print(build())
