# Builds `kitten-survivors/assets/models/boar.glb`, the charger.
#
# Run inside Blender: paste into the Text Editor and press Run, or send
# `exec(open(r'<this file>').read())` through BlenderMCP. It clears the scene.
#
# Feet on the origin, nose at Blender +Y, four leg objects legFrontLeft..
# legBackRight with their origin at the hip and the hip inside the body mass.
#
# THE OUTLINE SAYS: a slab with two hooks out in front of it. The sides are
# straight and parallel from rump to shoulder, the back edge is flat, the cross
# section is squared off, and the tusks reach 0.27 m ahead of the face and hook
# inward. Six families have to be told apart with the colour removed, so the
# boar owns "a rectangle with horns" and nothing else may be it.
#
# Not a wedge. A wedge is a triangle and the crow is already a triangle, so the
# two would be one shape at two sizes. A rectangle cannot be mistaken for a
# triangle at any size.
#
# The tusks point along the charge, so the tell is in the shape either way.
#
# Saturated brick red, mass 0.30 luminance. It was 0.19 and read as a hole:
# the keyline is a near-black line at constant screen width on everything that
# moves, and a near-black line on a near-black body separates nothing.
#
# It is the lowest of the three warm families — wasp amber 0.45, rat 0.38,
# boar 0.30 — and the reddest of them at hue 9, so the rat above it stays a
# separate animal at a distance. It shares a screen with the hound and both are
# large, so hue and the gap under the hound part those two before size does.
#
# The mantle over the head and shoulders is 47% of the model's area, so it sets
# the mass as much as the hide does. It stays a clear step under the hide at the
# same hue: a body that is one flat mid tone reads as a sticker.

LIB_PATH = globals().get(
    "LIB_PATH", "Z:/Code/browser game engine/tools/blender/lib.py")
exec(open(globals().get(
    "CREATURE_LIB",
    "Z:/Code/browser game engine/agent-runs/creatures/blender/creature-lib.py")).read())

MODEL_PATH = globals().get(
    "MODEL_PATH", "Z:/Code/browser game engine/kitten-survivors/assets/models/boar.glb")

# types/boar.js declares the hull [0.8, 0.65, 1.3].
HIP_HEIGHT = 0.265

COLOURS = {
    "boarHide": "#b03a24",     # 0.320 luminance, hue 9, saturated brick red
    "boarMantle": "#742a1e",   # 0.223, one dark shape over the head and shoulders, and 47% of the area
    "boarSnout": "#cc6a60",    # 0.495, the snout disc and the ear inners; a mark, not mass
    "boarTusk": "#fff4dc",     # tusks and eye whites
    "dark": "#1a0d10",         # bristles, pupils, hooves
}
MATERIAL_ORDER = ["boarHide", "boarMantle", "boarSnout", "boarTusk", "dark"]
SLOT = {name: index for index, name in enumerate(MATERIAL_ORDER)}


# ------------------------------------------------------------------ the body

# Tail to neck, as (y, centre z, half width, half height). Parallel sides are
# the whole design: 0.32 at the rump against 0.34 at the shoulders, and a flat
# back edge. A taper here would make the plan view a triangle, which is the
# crow's shape.
BODY_RINGS = [
    (-0.470, 0.348, 0.290, 0.150),   # rump, the flat back edge
    (-0.440, 0.350, 0.320, 0.174),
    (-0.300, 0.352, 0.332, 0.192),
    (-0.120, 0.354, 0.338, 0.202),
    (0.060, 0.356, 0.340, 0.208),    # shoulders
    (0.170, 0.354, 0.326, 0.200),    # neck, still full width
]
BODY_SECTIONS = 10

# The mantle covers the front third of the back and the whole head. One shape,
# and it is what makes the wide end read as the heavy end.
MANTLE_FROM = -0.060
MANTLE_ABOVE = -0.20
BELLY_ABOVE = -0.62

HEAD_CENTRE = (0.0, 0.360, 0.330)
# Wide and shallow, so the front of the animal is a straight edge rather than
# a snout narrowing to a point.
HEAD_HALF = (0.240, 0.150, 0.136)


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
    rings = [ring(bm, *values, sides=8, squareness=0.66) for values in sections]

    body = loft(bm, rings)
    for face in body:
        centre = face.calc_center_median()
        centre_z, _, half_height = body_profile(centre.y)
        above = (centre.z - centre_z) / max(half_height, 1e-6)
        if above < BELLY_ABOVE:
            face.material_index = SLOT["boarMantle"]
        elif centre.y > MANTLE_FROM and above > MANTLE_ABOVE:
            face.material_index = SLOT["boarMantle"]
        else:
            face.material_index = SLOT["boarHide"]

    build_head(bm)
    build_bristles(bm)
    return finish(bm, "boarBody", materials)


def build_head(bm):
    made = rounded_block(bm, HEAD_CENTRE, HEAD_HALF, roundness=0.34)
    paint(made, SLOT, "boarMantle")

    # The snout: a flat disc on the front of the head, facing forward and
    # tipped up so the camera catches it. It is the one light mark on a dark
    # head and it names which end is the front from any angle.
    snout = plate(bm, (0.0, HEAD_CENTRE[1] + 0.146, HEAD_CENTRE[2] - 0.030),
                  0.090, 0.066, 0.044, sides=8, tilt=(1.30, 0.0, 0.0))
    paint(snout, SLOT, "boarSnout")
    made += snout

    eyes(bm, SLOT, 0.146, HEAD_CENTRE[1] + 0.084, HEAD_CENTRE[2] + 0.070,
         (0.046, 0.030, 0.038), (0.028, 0.022, 0.026),
         "boarTusk", "dark", forward=0.020)

    # Tusks: two hooks running FORWARD past the face and curling inward at the
    # tip, not up. Up puts them in the top edge of the outline, where they read
    # as a crest; forward puts them out in clear air ahead of a flat front, and
    # a rectangle with two horns is a shape nothing else in the game has. They
    # point along the charge, so they are still the tell.
    for side in (-1, 1):
        tusk = rings_at(bm, [
            (side * 0.150, HEAD_CENTRE[1] + 0.090, HEAD_CENTRE[2] - 0.090, 0.038),
            (side * 0.220, HEAD_CENTRE[1] + 0.190, HEAD_CENTRE[2] - 0.070, 0.031),
            (side * 0.256, HEAD_CENTRE[1] + 0.290, HEAD_CENTRE[2] - 0.048, 0.024),
            (side * 0.240, HEAD_CENTRE[1] + 0.372, HEAD_CENTRE[2] - 0.026, 0.017),
            (side * 0.194, HEAD_CENTRE[1] + 0.424, HEAD_CENTRE[2] - 0.012, 0.010),
        ], sides=5, squareness=0.3)
        faces = loft(bm, tusk)
        paint(faces, SLOT, "boarTusk")
        made += faces

        # Ears laid back along the skull. A pricked ear would break the flat
        # top edge the slab depends on.
        ear = cone(bm, (side * 0.166, HEAD_CENTRE[1] - 0.060, HEAD_CENTRE[2] + 0.096),
                   0.060, (side * 0.246, HEAD_CENTRE[1] - 0.150,
                           HEAD_CENTRE[2] + 0.128), sides=4, turn=math.pi / 4)
        paint(ear, SLOT, "boarMantle")
        made += ear
    return made


def build_bristles(bm):
    # Five dark spikes down the spine. A ridge, not a fur pattern: five shapes
    # a camera resolves rather than a texture it cannot. Low, so the top edge
    # of the outline stays flat and the boar never grows the hound's crest.
    made = []
    ridge = [(0.120, 0.560, 0.048, 0.052),
             (0.010, 0.562, 0.054, 0.060),
             (-0.108, 0.558, 0.052, 0.056),
             (-0.230, 0.550, 0.044, 0.046),
             (-0.348, 0.540, 0.036, 0.036)]
    for y, z, radius, height in ridge:
        made += cone(bm, (0.0, y, z - 0.030), radius, (0.0, y - 0.020, z + height),
                     sides=4, turn=math.pi / 4)
    paint(made, SLOT, "dark")
    return made


# ------------------------------------------------------------------ the legs

# Local to the hip: (z, y offset, radius). Short and thick, ending in a dark
# hoof. A boar's legs are almost hidden under the body from this camera, so
# they carry weight rather than shape.
LEG = [
    (0.055, 0.000, 0.082),
    (-0.050, 0.002, 0.072),
    (-0.150, 0.004, 0.058),
    (-0.235, 0.006, 0.050),
    (-0.265, 0.006, 0.050),
]

# Under the four corners of the slab, so the footprint is a rectangle too.
LEGS = {
    "legFrontLeft": (-0.244, 0.056),
    "legFrontRight": (0.244, 0.056),
    "legBackLeft": (-0.236, -0.348),
    "legBackRight": (0.236, -0.348),
}


def build():
    clear_scene()
    materials = build_materials(COLOURS, MATERIAL_ORDER)
    build_body(materials)
    for name, (hip_x, hip_y) in LEGS.items():
        build_leg(name, hip_x, hip_y, HIP_HEIGHT, LEG, 0.014, materials,
                  SLOT, "boarHide", "dark", paw_half=(0.056, 0.066, 0.026))
    return export(MODEL_PATH, posed=list(LEGS))


print(build())
