# Builds `kitten-survivors/assets/models/boar.glb`, the charger.
#
# Run inside Blender: paste into the Text Editor and press Run, or send
# `exec(open(r'<this file>').read())` through BlenderMCP. It clears the scene.
#
# Feet on the origin, nose at Blender +Y, four leg objects legFrontLeft..
# legBackRight with their origin at the hip and the hip inside the body mass.
#
# The identity is a WEDGE and TWO FLARED TUSKS. The body is narrow at the rump
# and widest at the shoulders, and the tusks are the widest points of all, so
# from directly above a boar is an arrowhead pointing where it is about to
# charge. Nothing else in the horde tapers, and the taper is what tells the
# player which way the charge will go before it starts.
#
# Rust red, and darker over the head and shoulders. It shares a screen with the
# hound and both are large, so the two are told apart by hue before size: hot
# red against cool slate.

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
    "boarHide": "#cc4b2b",     # hot rust red, the loudest of the big two
    "boarMantle": "#7c2a1e",   # one dark shape over the head and shoulders
    "boarSnout": "#ff8f7c",    # the snout disc, and the ear inners
    "boarTusk": "#fff4dc",     # tusks and eye whites
    "dark": "#26141a",         # bristles, pupils, hooves
    "boarOutline": "#1c0709",  # the inverted hull
}
MATERIAL_ORDER = ["boarHide", "boarMantle", "boarSnout", "boarTusk",
                  "dark", "boarOutline"]
SLOT = {name: index for index, name in enumerate(MATERIAL_ORDER)}


# ------------------------------------------------------------------ the body

# Tail to neck, as (y, centre z, half width, half height). The taper is the
# whole design: 0.13 at the rump against 0.30 at the shoulders.
BODY_RINGS = [
    (-0.520, 0.330, 0.062, 0.058),   # rump cap
    (-0.450, 0.336, 0.132, 0.126),   # rump, the narrow end
    (-0.300, 0.348, 0.186, 0.176),
    (-0.120, 0.362, 0.252, 0.232),
    (0.060, 0.372, 0.300, 0.268),    # shoulders, the widest point
    (0.170, 0.362, 0.252, 0.226),    # neck, already dropping toward the head
]
BODY_SECTIONS = 10

# The mantle covers the front third of the back and the whole head. One shape,
# and it is what makes the wide end read as the heavy end.
MANTLE_FROM = -0.060
MANTLE_ABOVE = -0.20
BELLY_ABOVE = -0.62

HEAD_CENTRE = (0.0, 0.360, 0.316)
HEAD_HALF = (0.196, 0.202, 0.152)


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

    silhouette = loft(bm, rings)
    for face in silhouette:
        centre = face.calc_center_median()
        centre_z, _, half_height = body_profile(centre.y)
        above = (centre.z - centre_z) / max(half_height, 1e-6)
        if above < BELLY_ABOVE:
            face.material_index = SLOT["boarMantle"]
        elif centre.y > MANTLE_FROM and above > MANTLE_ABOVE:
            face.material_index = SLOT["boarMantle"]
        else:
            face.material_index = SLOT["boarHide"]

    silhouette += build_head(bm)
    silhouette += build_bristles(bm)

    add_shell(bm, silhouette, 0.026, SLOT, "boarOutline")
    return finish(bm, "boarBody", materials)


def build_head(bm):
    made = rounded_block(bm, HEAD_CENTRE, HEAD_HALF, roundness=0.5)
    paint(made, SLOT, "boarMantle")

    # The snout: a flat pink disc on the front of the head, facing forward and
    # tipped up so the camera catches it. It is the one warm light mark on a
    # dark head and it names which end is the front from any angle.
    snout = plate(bm, (0.0, HEAD_CENTRE[1] + 0.196, HEAD_CENTRE[2] - 0.036),
                  0.086, 0.070, 0.048, sides=8, tilt=(1.30, 0.0, 0.0))
    paint(snout, SLOT, "boarSnout")
    made += snout

    eyes(bm, SLOT, 0.116, HEAD_CENTRE[1] + 0.118, HEAD_CENTRE[2] + 0.076,
         (0.046, 0.030, 0.038), (0.028, 0.022, 0.026),
         "boarTusk", "dark", forward=0.020)

    # Tusks: the widest points on the animal, curving out and up from the jaw.
    # They are the plan-view signature and they are sized for that, not for a
    # real pig.
    for side in (-1, 1):
        tusk = rings_at(bm, [
            (side * 0.130, HEAD_CENTRE[1] + 0.120, HEAD_CENTRE[2] - 0.108, 0.036),
            (side * 0.194, HEAD_CENTRE[1] + 0.168, HEAD_CENTRE[2] - 0.072, 0.030),
            (side * 0.252, HEAD_CENTRE[1] + 0.196, HEAD_CENTRE[2] + 0.010, 0.023),
            (side * 0.290, HEAD_CENTRE[1] + 0.190, HEAD_CENTRE[2] + 0.096, 0.015),
            (side * 0.304, HEAD_CENTRE[1] + 0.176, HEAD_CENTRE[2] + 0.152, 0.008),
        ], sides=5, squareness=0.3)
        faces = loft(bm, tusk)
        paint(faces, SLOT, "boarTusk")
        made += faces

        ear = cone(bm, (side * 0.126, HEAD_CENTRE[1] - 0.088, HEAD_CENTRE[2] + 0.128),
                   0.058, (side * 0.176, HEAD_CENTRE[1] - 0.136,
                           HEAD_CENTRE[2] + 0.238), sides=4, turn=math.pi / 4)
        paint(ear, SLOT, "boarMantle")
        made += ear
    return made


def build_bristles(bm):
    # Five dark spikes down the spine. A ridge, not a fur pattern: five shapes
    # a camera resolves rather than a texture it cannot.
    made = []
    ridge = [(0.120, 0.632, 0.048, 0.108),
             (0.010, 0.646, 0.054, 0.126),
             (-0.108, 0.638, 0.052, 0.118),
             (-0.230, 0.612, 0.044, 0.096),
             (-0.348, 0.576, 0.036, 0.074)]
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

LEGS = {
    "legFrontLeft": (-0.196, 0.062),
    "legFrontRight": (0.196, 0.062),
    "legBackLeft": (-0.140, -0.336),
    "legBackRight": (0.140, -0.336),
}


def build():
    clear_scene()
    materials = build_materials(COLOURS, MATERIAL_ORDER)
    flat_dark("boarOutline")
    build_body(materials)
    for name, (hip_x, hip_y) in LEGS.items():
        build_leg(name, hip_x, hip_y, HIP_HEIGHT, LEG, 0.014, materials,
                  SLOT, "boarHide", "dark", paw_half=(0.056, 0.066, 0.026))
    return export(MODEL_PATH, posed=list(LEGS))


print(build())
