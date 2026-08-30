# Builds `kitten-survivors/assets/models/crow.glb`, the swarmer.
#
# Run inside Blender: paste into the Text Editor and press Run, or send
# `exec(open(r'<this file>').read())` through BlenderMCP. It clears the scene.
#
# Feet on the origin, nose at Blender +Y. Two wing objects named wingLeft and
# wingRight, origin AT THE SHOULDER, because engine/render.js `applyPose`
# swings a named node about its local X and a shoulder anywhere else swings the
# wing through the body. The wings are swept well back, which is what turns
# that X rotation into a visible flap: the further back the tip, the further it
# rises and falls.
#
# The silhouette is one wide swept arrowhead. It is the only family the camera
# sees from above with nothing under it, so the plan view is the whole design:
# two long wings, a round head between them, and one hot orange beak.
#
# Blue-black, not brown-black. A neutral dark on a warm bright field reads as
# a hole; a blue dark reads as a bird. The orange beak is the only saturated
# mark on it and it is what makes a near-black shape findable at all.
#
# The feet are modelled INTO the body, tucked up. The previous crow carried two
# leg stubs hanging in clear air below the belly.

LIB_PATH = globals().get(
    "LIB_PATH", "Z:/Code/browser game engine/tools/blender/lib.py")
exec(open(globals().get(
    "CREATURE_LIB",
    "Z:/Code/browser game engine/agent-runs/creatures/blender/creature-lib.py")).read())

MODEL_PATH = globals().get(
    "MODEL_PATH", "Z:/Code/browser game engine/kitten-survivors/assets/models/crow.glb")

# types/crow.js declares the hull [0.28, 0.5, 0.34]. The wings overshoot it by
# design: the hull is what a weapon hits, the wings are what says "bird".
SHOULDER = (0.062, 0.030, 0.225)

COLOURS = {
    "crowBody": "#3d4674",   # blue-black; a neutral dark reads as a hole
    "crowWing": "#2e3559",   # a step darker, so the wing edge shows on the body
    "crowBeak": "#ff9b21",   # the one saturated mark, and the whole find cue
    "crowWhite": "#f4f1ff",  # eye whites
    "dark": "#14161f",       # pupils
    "crowOutline": "#0a0b14",  # the inverted hull; also what parts one bird from the next in a flock
}
MATERIAL_ORDER = ["crowBody", "crowWing", "crowBeak", "crowWhite", "dark",
                  "crowOutline"]
SLOT = {name: index for index, name in enumerate(MATERIAL_ORDER)}


# ------------------------------------------------------------------ the body

# Tail to neck, as (y, centre z, half width, half height). A teardrop: widest
# at the shoulders where the wings leave, tapering to the tail fan.
BODY_RINGS = [
    (-0.190, 0.198, 0.026, 0.020),   # tail root
    (-0.140, 0.202, 0.062, 0.056),   # rump
    (-0.060, 0.208, 0.086, 0.078),   # belly
    (0.020, 0.216, 0.092, 0.084),    # shoulders, the widest point
    (0.078, 0.232, 0.064, 0.060),    # neck
]
BODY_SECTIONS = 8

HEAD_CENTRE = (0.0, 0.140, 0.258)
HEAD_HALF = (0.082, 0.078, 0.076)


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
    silhouette = loft(bm, [ring(bm, *values, sides=8, squareness=0.55)
                           for values in sections])
    paint(silhouette, SLOT, "crowBody")

    silhouette += build_head(bm)
    silhouette += build_tail(bm)
    build_feet(bm)
    add_shell(bm, silhouette, 0.015, SLOT, "crowOutline")
    return finish(bm, "crowBody", materials)


def build_head(bm):
    made = rounded_block(bm, HEAD_CENTRE, HEAD_HALF, roundness=0.78)
    paint(made, SLOT, "crowBody")

    # The beak: long, chunky and level. A short beak on a round head reads as
    # an owl, and the flock has to read as crows.
    beak = cone(bm, (0.0, HEAD_CENTRE[1] + 0.052, HEAD_CENTRE[2] - 0.004), 0.042,
                (0.0, HEAD_CENTRE[1] + 0.164, HEAD_CENTRE[2] - 0.016),
                sides=4, turn=math.pi / 4)
    paint(beak, SLOT, "crowBeak")

    eyes(bm, SLOT, 0.052, HEAD_CENTRE[1] + 0.044, HEAD_CENTRE[2] + 0.028,
         (0.030, 0.020, 0.030), (0.019, 0.015, 0.019),
         "crowWhite", "dark", forward=0.013)
    return made + beak


def build_tail(bm):
    # A flat fan lying in the horizontal plane, tipped up a little the way a
    # bird's tail sits in level flight. The plate's own plane is horizontal at
    # zero tilt, so a near-upright tilt would stand it on edge and the top-down
    # camera would see a fin rather than a tail.
    # Set well forward of the rump: the body ends in a 0.026 m point and the
    # hexagon starts in one, so a tail placed just behind it touches at a point
    # and reads as detached from directly above.
    made = plate(bm, (0.0, -0.186, 0.200), 0.082, 0.118, 0.022,
                 sides=6, tilt=(-0.22, 0.0, 0.0))
    paint(made, SLOT, "crowWing")
    return made


def build_feet(bm):
    # Tucked up against the belly, part of the body mesh. A flying bird does
    # not dangle its legs, and a separate leg object under a hovering body
    # leaves a gap of clear air the eye reads as breakage.
    for side in (-1, 1):
        paint(rounded_block(bm, (side * 0.036, 0.006, 0.152),
                            (0.020, 0.048, 0.020), roundness=0.6),
              SLOT, "crowBeak")


# ------------------------------------------------------------------ the wings

# Local to the shoulder: (x out, leading y, trailing y). The chord narrows and
# the whole wing sweeps back, so the tip is 0.20 m behind the shoulder — that
# offset is what an X rotation converts into up-and-down at the tip.
WING = [
    (0.000, 0.096, -0.112),
    (0.092, 0.090, -0.156),
    (0.178, 0.056, -0.184),   # the chord stays broad to mid span, or it reads as a stick
    (0.250, -0.006, -0.190),
    (0.304, -0.078, -0.172),
    (0.336, -0.150, -0.198),   # the tip runs to a point behind the trailing edge
]


def build_wing(name, side, materials):
    bm = bmesh.new()
    sections = [(side * across, leading, trailing)
                for across, leading, trailing in WING]
    # Mirroring x reverses the winding, so the left wing is skinned tip to root
    # to put its faces back on the outside.
    if side < 0:
        sections.reverse()
    wing = blade(bm, sections, 0.024, 0.0)
    paint(wing, SLOT, "crowWing")
    # The wings ARE the silhouette of this family, so they carry the rim too.
    add_shell(bm, wing, 0.014, SLOT, "crowOutline")
    return finish(bm, name, materials, origin=(side * SHOULDER[0],
                                               SHOULDER[1], SHOULDER[2]))


def build():
    clear_scene()
    materials = build_materials(COLOURS, MATERIAL_ORDER)
    flat_dark("crowOutline")
    build_body(materials)
    build_wing("wingLeft", -1, materials)
    build_wing("wingRight", 1, materials)
    return export(MODEL_PATH, posed=["wingLeft", "wingRight"])


print(build())
