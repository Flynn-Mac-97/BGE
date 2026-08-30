# Extra geometry helpers for the Kitten Survivors creatures, on top of
# tools/blender/lib.py.
#
# A creature script brings both in with:
#
#   LIB_PATH = r"<repo>/tools/blender/lib.py"
#   exec(open(r"<repo>/agent-runs/creatures/blender/creature-lib.py").read())
#
# run inside Blender, before its own build(). No import system: BlenderMCP
# executes a string of code, and exec-of-a-file is the form that works from
# both the Text Editor and MCP.
#
# What these add over lib.py is the four shapes a character needs that a
# quadruped tube does not: an eye pair, a flat scalloped collar, a swept
# blade, and a flat disc.
#
# No outline helper. The keyline is a screen-space pass in engine/render.js at
# a constant pixel width; a modelled hull shrinks with distance, costs about a
# quarter of a creature's triangles, and is wound inside out.
#
# Ground is Blender z = 0. Nose is Blender +Y — the exporter maps that to
# glTF -Z, the direction the camera faces at yaw 0.

LIB_PATH = globals().get(
    "LIB_PATH", "Z:/Code/browser game engine/tools/blender/lib.py")
exec(open(LIB_PATH).read())

from mathutils import Euler, Vector


def placed(points, centre, tilt):
    """Rotate local points by an XYZ Euler and move them to `centre`."""
    rotation = Euler(tilt, "XYZ").to_matrix()
    return [tuple(rotation @ Vector(point) + Vector(centre)) for point in points]


def prism(bm, lower, upper):
    """Skin two matching rings of raw points into a closed slab."""
    low = [bm.verts.new(point) for point in lower]
    high = [bm.verts.new(point) for point in upper]
    made = []
    for index in range(len(low)):
        step = (index + 1) % len(low)
        made.append(bm.faces.new((low[index], low[step], high[step], high[index])))
    made.append(bm.faces.new(list(reversed(low))))
    made.append(bm.faces.new(high))
    return made


def plate(bm, centre, radius_across, radius_up, thickness,
          sides=10, tilt=(0.0, 0.0, 0.0), scallop=0.0):
    """
    A flat round slab: an ear, a snout, a wing, a collar.

    `scallop` pulls every other point in, which turns a disc into a ruffled
    star. That is the cheapest outline that reads as fur rather than as a
    plastic plate, and outline is all a top-down camera gets.
    """
    lower, upper = [], []
    for index in range(sides):
        angle = (index + 0.5) * 2.0 * math.pi / sides
        pull = 1.0 - scallop if index % 2 else 1.0
        across = math.cos(angle) * radius_across * pull
        up = math.sin(angle) * radius_up * pull
        lower.append((across, up, -thickness / 2.0))
        upper.append((across, up, thickness / 2.0))
    return prism(bm, placed(lower, centre, tilt), placed(upper, centre, tilt))


def blade(bm, sections, thickness, height):
    """
    A swept wing, from root to tip.

    `sections` is (x, leading y, trailing y), root first. Each one becomes a
    rectangle in the YZ plane and they are skinned along x, so the chord can
    taper and sweep back independently. A wing with thickness still reads when
    the camera is edge-on to it; a single quad disappears.
    """
    rings = []
    for across, leading, trailing in sections:
        rings.append([
            bm.verts.new((across, trailing, height - thickness / 2.0)),
            bm.verts.new((across, leading, height - thickness / 2.0)),
            bm.verts.new((across, leading, height + thickness / 2.0)),
            bm.verts.new((across, trailing, height + thickness / 2.0)),
        ])
    return loft(bm, rings)


def eyes(bm, slot, offset_across, y, z, sclera_half, pupil_half,
         white, dark_material, forward=0.014, lift=0.0):
    """
    Two big eyes: a pale block with a dark pupil standing proud of it.

    Large eyes are the single cue that turns a low-poly animal into a
    character, and this camera looks down, so they are set high on the face.
    The pupil is moved forward rather than merged, or the two z-fight.
    """
    for side in (-1, 1):
        paint(rounded_block(bm, (side * offset_across, y, z),
                            sclera_half, roundness=0.85), slot, white)
        paint(rounded_block(bm, (side * offset_across, y + forward, z + lift),
                            pupil_half, roundness=0.85), slot, dark_material)


def check_ready(names):
    """Fail before export if a posed node is missing or carries a scale.

    engine/render.js `applyPose` reports a missing node every frame, and a
    scaled object exports its scale into the node the pose then rotates.
    """
    for name in names:
        obj = bpy.data.objects.get(name)
        if obj is None:
            raise RuntimeError("no object named %s to pose" % name)
    for obj in bpy.data.objects:
        if tuple(round(value, 6) for value in obj.scale) != (1.0, 1.0, 1.0):
            raise RuntimeError("%s has an unapplied scale %s" % (obj.name, tuple(obj.scale)))


def export(path, posed=()):
    check_ready(posed)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB",
                              export_yup=True, export_apply=True)
    triangles = sum(len(mesh.polygons) * 2 for mesh in bpy.data.meshes)
    return {"path": path, "objects": len(bpy.data.objects), "faces~tris": triangles}
