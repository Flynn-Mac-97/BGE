# Builds `kitten-survivors/assets/models/kitten.glb`, the cat the player steers.
#
# Run it inside Blender: paste it into the Text Editor and press Run, or send
# `exec(open(r'<this file>').read())` through BlenderMCP. It clears the scene,
# so open a fresh file.
#
# The camera looks down at about 60 degrees from 14 metres, so the shapes that
# earn their vertices are the ones a player sees from ABOVE: the round head, the
# two ear triangles, the waist between ribs and hips, and the raised tail. The
# face is nearly edge-on at that angle and gets the fewest.
#
# Four rules this model has to keep, because `types/kitten.js` and the renderer
# both read it:
#
#   Feet on the origin. `mesh.anchor: 'feet'` drops the model by half the hull,
#   so z = 0 in Blender is the ground the cat stands on.
#
#   Nose at Blender +Y. The glTF exporter maps Blender +Y to glTF -Z, and -Z is
#   the direction the camera faces at yaw 0.
#
#   Four leg objects named legFrontLeft, legFrontRight, legBackLeft,
#   legBackRight, each with its object origin AT THE HIP. `applyPose` in
#   engine/render.js swings a named node about its local X, and a hip anywhere
#   else swings the leg through the body.
#
#   The hip sits INSIDE the body mass. A leg whose top face is out in the open
#   opens a gap the moment it swings, and four gaps read as a broken toy.

import bpy
import bmesh
import math

MODEL_PATH = "Z:/Code/browser game engine/kitten-survivors/assets/models/kitten.glb"

# Ground is z = 0. Every number below is metres, measured against the 0.45 m
# cat the art language sets as the ruler for the whole meadow.
GROUND = 0.0
HIP_HEIGHT = 0.175


# --------------------------------------------------------------- the palette

def linear(hex_colour):
    """glTF stores linear colour; the art language writes sRGB."""
    value = int(hex_colour.lstrip("#"), 16)
    out = []
    for shift in (16, 8, 0):
        channel = ((value >> shift) & 255) / 255.0
        out.append(channel / 12.92 if channel <= 0.04045
                   else ((channel + 0.055) / 1.055) ** 2.4)
    return (out[0], out[1], out[2], 1.0)


# Ginger tabby. The cat is the one thing on the field allowed to be both light
# and warm, so the base sits above the grass in value as well as in hue.
COLOURS = {
    "kittenFur": "#e0a05a",      # the body
    "kittenStripe": "#a75c22",   # the bars across the back, read from above
    "kittenFace": "#eebb78",     # head and muzzle, a shade lighter than the body
    "kittenCream": "#f2e3c4",    # belly, chin, paws, tail tip
    "kittenPink": "#d98a94",     # nose and inner ear
    "dark": "#241a24",           # eyes and ear backs
}
MATERIAL_ORDER = ["kittenFur", "kittenStripe", "kittenFace",
                  "kittenCream", "kittenPink", "dark"]
SLOT = {name: index for index, name in enumerate(MATERIAL_ORDER)}


def build_materials():
    made = []
    for name in MATERIAL_ORDER:
        material = bpy.data.materials.new(name)
        material.use_nodes = True
        shader = material.node_tree.nodes["Principled BSDF"]
        shader.inputs["Base Color"].default_value = linear(COLOURS[name])
        shader.inputs["Roughness"].default_value = 0.85
        shader.inputs["Metallic"].default_value = 0.0
        made.append(material)
    return made


# ------------------------------------------------------------ mesh machinery

def ring(bm, y, centre_z, half_width, half_height, sides=8, squareness=0.72):
    """
    One cross-section of a limb or a body, as a rounded octagon in the XZ plane.

    `squareness` 0 gives a circle and 1 gives a box. Between them the profile
    keeps flat top, bottom and sides with cut corners, which is the silhouette
    the rest of the meadow is built from.
    """
    verts = []
    for index in range(sides):
        angle = (index + 0.5) * 2.0 * math.pi / sides
        across, up = math.cos(angle), math.sin(angle)
        stretch = 1.0 / max(abs(across), abs(up)) ** squareness
        verts.append(bm.verts.new((across * stretch * half_width,
                                   y,
                                   centre_z + up * stretch * half_height)))
    return verts


def loft(bm, rings, cap_first=True, cap_last=True):
    """Skin a run of rings into quads, then close the ends."""
    made = []
    for near, far in zip(rings, rings[1:]):
        count = len(near)
        for index in range(count):
            step = (index + 1) % count
            made.append(bm.faces.new((near[index], near[step],
                                      far[step], far[index])))
    if cap_first:
        made.append(bm.faces.new(list(reversed(rings[0]))))
    if cap_last:
        made.append(bm.faces.new(rings[-1]))
    return made


def rounded_block(bm, centre, half, roundness=0.45):
    """
    A cube with its corners pulled toward a sphere: 24 quads, chunky, and the
    only head shape at this budget that does not read as a wedge.

    It is shaped in a bmesh of its own and then copied in. Doing it in place
    would mean telling the new geometry from the old, and bmesh elements
    compare by wrapper identity rather than by the vertex they stand for, so
    a set of them is not a reliable answer to "was this here before".
    """
    block = bmesh.new()
    bmesh.ops.create_cube(block, size=2.0)
    bmesh.ops.subdivide_edges(block, edges=list(block.edges), cuts=1,
                              use_grid_fill=True)
    block.verts.ensure_lookup_table()
    block.verts.index_update()

    copied = []
    for vert in block.verts:
        position = vert.co.copy()
        length = position.length
        if length > 0:
            position = position.lerp(position / length, roundness)
        copied.append(bm.verts.new((position.x * half[0] + centre[0],
                                    position.y * half[1] + centre[1],
                                    position.z * half[2] + centre[2])))

    made = [bm.faces.new([copied[corner.index] for corner in face.verts])
            for face in block.faces]
    block.free()
    return made


def cone(bm, base_centre, base_radius, tip, sides=4, turn=0.0):
    """A pyramid, used for the ears and the nose."""
    base = []
    for index in range(sides):
        angle = turn + index * 2.0 * math.pi / sides
        base.append(bm.verts.new((base_centre[0] + math.cos(angle) * base_radius,
                                  base_centre[1] + math.sin(angle) * base_radius,
                                  base_centre[2])))
    point = bm.verts.new(tip)
    made = []
    for index in range(sides):
        step = (index + 1) % sides
        made.append(bm.faces.new((base[index], base[step], point)))
    made.append(bm.faces.new(list(reversed(base))))
    return made


def paint(faces, material):
    for face in faces:
        face.material_index = SLOT[material]


def finish(bm, name, materials, origin=(0.0, 0.0, 0.0)):
    """Turn a bmesh into a flat-shaded object with every material attached."""
    bm.normal_update()
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for polygon in mesh.polygons:
        polygon.use_smooth = False
    for material in materials:
        mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    obj.location = origin
    bpy.context.collection.objects.link(obj)
    return obj


# ------------------------------------------------------------------ the body

# Nose to rump, as (y, centre z, half width, half height). The waist between
# ribs and hips is the whole point of the list: from directly above it is the
# one line that separates a cat from a sausage.
BODY_RINGS = [
    (-0.285, 0.238, 0.050, 0.048),   # rump cap, where the tail leaves
    (-0.250, 0.226, 0.098, 0.090),   # rump
    (-0.180, 0.216, 0.115, 0.104),   # hips, the widest point
    (-0.085, 0.206, 0.092, 0.089),   # waist
    (0.020, 0.204, 0.110, 0.099),    # ribs
    (0.115, 0.209, 0.107, 0.095),    # shoulders
    (0.195, 0.238, 0.074, 0.069),    # neck
]

# The body is skinned at this many sections rather than at the seven above. The
# extra ones change no silhouette; they exist so the tabby bars can be a segment
# wide. Painted on the seven, a bar is a third of the animal.
BODY_SECTIONS = 19

# One bar every third segment, which puts five across the back. The bars are
# the only marking the top-down camera resolves at all, so they are the one
# place on this model worth spending geometry.
STRIPE_EVERY = 3
STRIPE_PHASE = 1

# How far down the flank a bar reaches, as a fraction of the half height from
# the centre line. Bars that stop at the spine read as a ladder; bars that reach
# the belly read as a wasp.
STRIPE_REACH = -0.30

HEAD_CENTRE = (0.0, 0.288, 0.296)
HEAD_HALF = (0.114, 0.106, 0.110)


def body_profile(y):
    """The ring the body would have at this y, interpolated. Used to decide
    which faces are back and which are belly."""
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

    nose_end, tail_end = BODY_RINGS[-1][0], BODY_RINGS[0][0]
    sections = []
    for index in range(BODY_SECTIONS):
        y = tail_end + (nose_end - tail_end) * index / (BODY_SECTIONS - 1)
        sections.append((y,) + body_profile(y))
    rings = [ring(bm, *values) for values in sections]

    faces = loft(bm, rings)
    around = len(rings[0])
    for index, face in enumerate(faces):
        segment = index // around
        centre = face.calc_center_median()
        centre_z, _, half_height = body_profile(centre.y)
        above = (centre.z - centre_z) / max(half_height, 1e-6)
        striped = segment % STRIPE_EVERY == STRIPE_PHASE and segment < len(rings) - 1
        if above < -0.45:
            face.material_index = SLOT["kittenCream"]         # belly
        elif striped and above > STRIPE_REACH:
            face.material_index = SLOT["kittenStripe"]        # tabby bars
        else:
            face.material_index = SLOT["kittenFur"]

    build_head(bm)
    build_tail(bm)

    return finish(bm, "kittenBody", materials)


def build_head(bm):
    for face in rounded_block(bm, HEAD_CENTRE, HEAD_HALF, roundness=0.55):
        centre = face.calc_center_median()
        # The face is the part a player sees least, so it gets one flat patch
        # rather than a modelled muzzle.
        face.material_index = (SLOT["kittenFace"] if centre.y > HEAD_CENTRE[1]
                               else SLOT["kittenFur"])

    # Muzzle: a small pale block, not a snout. A cat seen from above has almost
    # no muzzle, and a modelled one only steals faces from the ears.
    paint(rounded_block(bm, (0.0, 0.380, 0.270), (0.050, 0.032, 0.034),
                        roundness=0.5), "kittenCream")

    paint(cone(bm, (0.0, 0.406, 0.290), 0.018, (0.0, 0.424, 0.285), sides=4,
               turn=math.pi / 4), "kittenPink")

    # Eyes. Large and forward, because two dark discs are what makes a shape at
    # nine metres read as an animal facing you rather than a lump.
    for side in (-1, 1):
        paint(rounded_block(bm, (side * 0.062, 0.368, 0.322),
                            (0.032, 0.016, 0.028), roundness=0.75), "dark")

    # Ears. Tilted out and back, and the tallest thing on the animal apart from
    # the tail: from directly above they are the whole of the silhouette.
    for side in (-1, 1):
        base = (side * 0.066, 0.264, 0.372)
        tip = (side * 0.104, 0.238, 0.462)
        for face in cone(bm, base, 0.056, tip, sides=4, turn=math.pi / 4):
            centre = face.calc_center_median()
            # Front of the ear is pink, the back is dark: the pair of dark
            # triangles is what the top-down camera actually resolves.
            face.material_index = (SLOT["kittenPink"] if centre.y > base[1]
                                   else SLOT["dark"])


# Base to tip, as (y, z, radius). It stands up and curls forward, so the cat
# has one vertical line in a frame full of low enemies.
TAIL_PATH = [
    (-0.278, 0.248, 0.041),
    (-0.312, 0.290, 0.038),
    (-0.336, 0.336, 0.034),
    (-0.348, 0.386, 0.030),
    (-0.340, 0.434, 0.026),
    (-0.312, 0.474, 0.022),
    (-0.268, 0.500, 0.018),
    (-0.222, 0.512, 0.015),
]


def build_tail(bm):
    rings = []
    for y, z, radius in TAIL_PATH:
        rings.append(ring(bm, y, z, radius, radius, sides=6, squareness=0.4))

    faces = loft(bm, rings)
    around = len(rings[0])
    for index, face in enumerate(faces):
        segment = index // around
        # A ringed tail held upright is the one marking that survives a screen
        # full of enemies, because it is the only part of the cat above them.
        if segment >= len(rings) - 2:
            face.material_index = SLOT["kittenCream"]
        elif segment % 2 == 1:
            face.material_index = SLOT["kittenStripe"]
        else:
            face.material_index = SLOT["kittenFur"]


# ------------------------------------------------------------------ the legs

# Local to the hip: (z, y offset, radius). The first ring is ABOVE the hip and
# inside the body, so a swinging leg never opens a hole at the shoulder.
FRONT_LEG = [
    (0.030, 0.000, 0.049),
    (-0.045, 0.002, 0.041),
    (-0.105, 0.004, 0.031),
    (-0.150, 0.006, 0.029),
    (-0.175, 0.006, 0.029),
]

# The back leg bends at the hock. It is four vertices of difference and it is
# the difference between a cat and a coffee table.
BACK_LEG = [
    (0.030, 0.000, 0.056),
    (-0.040, -0.016, 0.048),
    (-0.090, -0.030, 0.034),
    (-0.140, -0.012, 0.028),
    (-0.175, -0.004, 0.028),
]

LEGS = {
    "legFrontLeft": (-0.082, 0.115, FRONT_LEG, 0.012),
    "legFrontRight": (0.082, 0.115, FRONT_LEG, 0.012),
    "legBackLeft": (-0.092, -0.175, BACK_LEG, 0.014),
    "legBackRight": (0.092, -0.175, BACK_LEG, 0.014),
}


def build_leg(name, materials):
    hip_x, hip_y, path, paw_forward = LEGS[name]
    bm = bmesh.new()

    # ring() lays a section out in the XZ plane at a given y, and a leg runs
    # down z instead, so the section is built flat and then turned.
    rings = []
    for z, y_offset, radius in path:
        section = ring(bm, 0.0, 0.0, radius, radius, sides=6, squareness=0.35)
        for vert in section:
            vert.co = (vert.co.x, y_offset + vert.co.z, z)
        rings.append(section)
    paint(loft(bm, rings), "kittenFur")

    ankle_z, ankle_y, _ = path[-1]
    paint(rounded_block(bm,
                        (0.0, ankle_y + paw_forward, ankle_z + 0.012),
                        (0.034, 0.042, 0.014),
                        roundness=0.5), "kittenCream")

    return finish(bm, name, materials, origin=(hip_x, hip_y, HIP_HEIGHT))


# ----------------------------------------------------------------- the build

def clear_scene():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for mesh in list(bpy.data.meshes):
        bpy.data.meshes.remove(mesh)
    for material in list(bpy.data.materials):
        bpy.data.materials.remove(material)


def build():
    clear_scene()
    materials = build_materials()
    build_body(materials)
    for name in LEGS:
        build_leg(name, materials)
    bpy.ops.export_scene.gltf(filepath=MODEL_PATH,
                              export_format="GLB",
                              export_yup=True,
                              export_apply=True)
    return MODEL_PATH


build()
