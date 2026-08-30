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
# THE OUTLINE SAYS: a chevron, and the only shape in the game wider than it is
# long. The span is 0.95 m against 0.55 m of body, and the wings sweep so far
# back that their tips finish behind the tail, which cuts a deep notch into the
# trailing edge. Six families have to be told apart with the colour removed, so
# the crow owns "wide, concave at the back, no legs" and nothing else may be it.
#
# The tail fan is small on purpose. A wide fan fills the notch and the chevron
# collapses into a blob.
#
# Blue-black, and the darkest family in the game at 0.14 luminance. Every prop
# is held above 0.44, so a crow crossing one never shares its value. The orange
# beak is the only mark above that band and it is small.
#
# The feet are modelled INTO the body, tucked up. A separate leg object under a
# hovering body leaves a gap of clear air that reads as breakage, and the gap
# under a body is the hound's claim.

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
    "crowBody": "#262b4a",   # 0.174 luminance; a neutral dark reads as a hole, a blue dark reads as a bird
    "crowWing": "#1b1f38",   # 0.126, a step darker so the wing edge shows on the body
    "crowBeak": "#ff8a12",   # 0.605, the one mark above the prop band, and small
    "crowWhite": "#f4f1ff",  # eye whites
    "dark": "#0f111a",       # pupils
}
MATERIAL_ORDER = ["crowBody", "crowWing", "crowBeak", "crowWhite", "dark"]
SLOT = {name: index for index, name in enumerate(MATERIAL_ORDER)}


# ------------------------------------------------------------------ the body

# Tail to neck, as (y, centre z, half width, half height). A flat teardrop:
# widest at the shoulders where the wings leave. Half the height of the old
# body, because a chevron has to be flat — mass in the middle rebuilds the
# blob the wings exist to break.
BODY_RINGS = [
    (-0.176, 0.200, 0.024, 0.015),   # tail root
    (-0.130, 0.202, 0.058, 0.042),   # rump
    (-0.056, 0.206, 0.080, 0.058),   # belly
    (0.020, 0.212, 0.086, 0.062),    # shoulders, the widest point
    (0.072, 0.222, 0.060, 0.046),    # neck
]
BODY_SECTIONS = 8

HEAD_CENTRE = (0.0, 0.132, 0.244)
HEAD_HALF = (0.076, 0.072, 0.066)


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
    body = loft(bm, [ring(bm, *values, sides=8, squareness=0.55)
                     for values in sections])
    paint(body, SLOT, "crowBody")

    build_head(bm)
    build_tail(bm)
    build_feet(bm)
    return finish(bm, "crowBody", materials)


def build_head(bm):
    made = rounded_block(bm, HEAD_CENTRE, HEAD_HALF, roundness=0.78)
    paint(made, SLOT, "crowBody")

    # The beak: chunky and level. Short, because body length is what a chevron
    # trades away — a long beak makes the bird as long as it is wide.
    beak = cone(bm, (0.0, HEAD_CENTRE[1] + 0.048, HEAD_CENTRE[2] - 0.004), 0.038,
                (0.0, HEAD_CENTRE[1] + 0.126, HEAD_CENTRE[2] - 0.014),
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
    # Narrow: the wings finish 0.10 m behind it and the gap between them is the
    # notch that makes the outline a chevron. A wide fan fills the notch.
    made = plate(bm, (0.0, -0.172, 0.202), 0.046, 0.094, 0.018,
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

# Local to the shoulder: (x out, leading y, trailing y). The chord stays broad
# to mid span so the wing is a plate rather than a stick, and the whole wing
# sweeps back until the tip is 0.33 m behind the shoulder — further back than
# the tail. That sweep is what cuts the notch, and the offset is what an X
# rotation converts into up-and-down at the tip.
#
# Tip at x 0.412 on a shoulder 0.062 out gives a 0.95 m span against 0.55 m of
# body. Nothing else in the game is wider than it is long.
WING = [
    (0.000, 0.100, -0.104),
    (0.116, 0.086, -0.150),
    (0.226, 0.040, -0.196),
    (0.318, -0.036, -0.240),
    (0.376, -0.130, -0.276),
    (0.412, -0.226, -0.300),   # the tip finishes behind the tail fan
]


def build_wing(name, side, materials):
    bm = bmesh.new()
    sections = [(side * across, leading, trailing)
                for across, leading, trailing in WING]
    # Mirroring x reverses the winding, so the left wing is skinned tip to root
    # to put its faces back on the outside.
    if side < 0:
        sections.reverse()
    paint(blade(bm, sections, 0.024, 0.0), SLOT, "crowWing")
    return finish(bm, name, materials, origin=(side * SHOULDER[0],
                                               SHOULDER[1], SHOULDER[2]))


def build():
    clear_scene()
    materials = build_materials(COLOURS, MATERIAL_ORDER)
    build_body(materials)
    build_wing("wingLeft", -1, materials)
    build_wing("wingRight", 1, materials)
    return export(MODEL_PATH, posed=["wingLeft", "wingRight"])


print(build())
