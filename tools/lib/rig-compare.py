# Pose a model's bones from engine clip poses beside the capture, render front
# and side for each frame, and stitch one sheet. Written by tools/lib/rig-compare.mjs.
#
#   blender <model>.blend --background --python rig-compare.py -- poses.json out_dir
import bpy
import bmesh
import json
import math
import os
import sys

import numpy
from mathutils import Matrix, Quaternion, Vector

TILE = 520
GLTF_TO_BLENDER = Matrix.Rotation(math.radians(90), 4, "X")


def arguments():
    rest = sys.argv[sys.argv.index("--") + 1:]
    return json.load(open(rest[0])), rest[1]


def keep_collections(names):
    """Remove objects outside the collections the import kept, as the export did."""
    if not names:
        return
    names = names if isinstance(names, list) else [names]
    kept = set()
    for name in names:
        kept.update(obj.name for obj in bpy.data.collections[name].all_objects)
    for obj in list(bpy.data.objects):
        if obj.name not in kept:
            bpy.data.objects.remove(obj, do_unlink=True)


def prepare_rig():
    """The armature, with nothing but the clip moving it: no constraints, no actions, no B-bone curves."""
    meshes = [obj for obj in bpy.data.objects if obj.type == "MESH"]
    rig = next((modifier.object for obj in meshes for modifier in obj.modifiers
                if modifier.type == "ARMATURE" and modifier.object), None)
    if rig is None:
        raise SystemExit("no mesh in this file is deformed by an armature")
    if rig.animation_data:
        rig.animation_data_clear()
    for pose_bone in rig.pose.bones:
        for constraint in pose_bone.constraints:
            constraint.mute = True
        pose_bone.matrix_basis = Matrix.Identity(4)
    for bone in rig.data.bones:
        bone.bbone_segments = 1
    for obj in meshes:
        obj.hide_render = False
        obj.hide_viewport = False
        for modifier in obj.modifiers:
            if modifier.type == "ARMATURE":
                modifier.use_deform_preserve_volume = False
    return rig, meshes


def depth(bone):
    count = 0
    while bone.parent:
        bone, count = bone.parent, count + 1
    return count


def to_blender_matrix(place, scale):
    x, y, z, w = place["rotation"]
    matrix = GLTF_TO_BLENDER @ Quaternion((w, x, y, z)).to_matrix().to_4x4()
    matrix.translation = GLTF_TO_BLENDER @ Vector([value / scale for value in place["position"]])
    return matrix


def pose(rig, nodes, model, scale):
    """Set each clip bone's armature-space matrix, parents first, updating between depths."""
    for pose_bone in rig.pose.bones:
        pose_bone.matrix_basis = Matrix.Identity(4)
    bones = sorted((rig.pose.bones[name] for name in nodes if name in rig.pose.bones), key=lambda one: depth(one.bone))
    inverse_rig = rig.matrix_world.inverted()
    current = None
    for pose_bone in bones:
        if depth(pose_bone.bone) != current:
            bpy.context.view_layer.update()
            current = depth(pose_bone.bone)
        pose_bone.matrix = inverse_rig @ to_blender_matrix(model[pose_bone.name], scale)
    bpy.context.view_layer.update()


def stick_figure(capture, height, offset, material):
    """The capture as cylinders between joints and a ball at each joint, as tall as the model."""
    builder = bmesh.new()
    raw = [GLTF_TO_BLENDER @ Vector(point) for point in capture["positions"]]
    low = min(p.z for p in raw)
    fit = height / max(max(p.z for p in raw) - low, 1e-6)
    points = [Vector((p.x * fit, p.y * fit, (p.z - low) * fit)) + offset for p in raw]
    thickness = height / 120
    for joint, parent in enumerate(capture["parents"]):
        if parent < 0:
            continue
        start, end = points[parent], points[joint]
        length = (end - start).length
        if length < 1e-6:
            continue
        made = bmesh.ops.create_cone(builder, cap_ends=True, segments=8, radius1=thickness, radius2=thickness, depth=length)
        turn = (end - start).to_track_quat("Z", "Y").to_matrix().to_4x4()
        bmesh.ops.transform(builder, matrix=Matrix.Translation((start + end) / 2) @ turn, verts=made["verts"])
    for point in points:
        made = bmesh.ops.create_uvsphere(builder, u_segments=8, v_segments=6, radius=thickness * 1.8)
        bmesh.ops.translate(builder, vec=point, verts=made["verts"])
    mesh = bpy.data.meshes.new("capture")
    builder.to_mesh(mesh)
    obj = bpy.data.objects.new("capture", mesh)
    obj.data.materials.append(material)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def bounds(meshes):
    corners = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
    low = Vector((min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners)))
    high = Vector((max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners)))
    return (low + high) / 2, max(high.z - low.z, 1e-3)


def setup_scene():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.background_type = "VIEWPORT"
    scene.display.shading.background_color = (0.55, 0.58, 0.62)
    scene.view_settings.view_transform = "Standard"
    scene.render.resolution_x = TILE
    scene.render.resolution_y = TILE
    for obj in list(bpy.data.objects):
        if obj.type in {"CAMERA", "LIGHT"}:
            bpy.data.objects.remove(obj, do_unlink=True)
    camera = bpy.data.objects.new("compare", bpy.data.cameras.new("compare"))
    camera.data.type = "ORTHO"
    scene.collection.objects.link(camera)
    scene.camera = camera
    return scene, camera


def aim(camera, centre, direction, height):
    """Put an orthographic camera out along `direction` from the centre, looking back at it."""
    camera.location = centre + direction.normalized() * height * 4
    camera.rotation_euler = (-direction).to_track_quat("-Z", "Y").to_euler()
    camera.data.ortho_scale = height * 1.9


def stitch(files, columns, path):
    """One PNG: rows in the order given, `columns` tiles each."""
    rows = [files[start:start + columns] for start in range(0, len(files), columns)]
    sheet = numpy.zeros((TILE * len(rows), TILE * columns, 4), dtype=numpy.float32)
    for row, row_files in enumerate(rows):
        for column, file in enumerate(row_files):
            image = bpy.data.images.load(file)
            # Read the stored bytes as they are, so the sheet is not decoded and re-encoded darker.
            image.colorspace_settings.name = "Non-Color"
            pixels = numpy.array(image.pixels[:], dtype=numpy.float32).reshape(image.size[1], image.size[0], 4)
            # Blender stores rows bottom first, so the first row of files goes at the top.
            top = (len(rows) - 1 - row) * TILE
            sheet[top:top + TILE, column * TILE:(column + 1) * TILE] = pixels[:TILE, :TILE]
    out = bpy.data.images.new("sheet", TILE * columns, TILE * len(rows), alpha=True)
    out.colorspace_settings.name = "Non-Color"
    out.pixels.foreach_set(sheet.ravel())
    out.filepath_raw = path
    out.file_format = "PNG"
    out.save()


def main():
    poses, out = arguments()
    keep_collections(poses.get("collection"))
    rig, meshes = prepare_rig()
    scene, camera = setup_scene()
    material = bpy.data.materials.new("capture")
    material.diffuse_color = (0.9, 0.35, 0.2, 1)

    scale = poses.get("scale", 1)
    centre, _ = bounds(meshes)
    # The stick figure matches the skeleton's height, not a hat or hair on top of it.
    heads = [rig.matrix_world @ point for bone in rig.data.bones if bone.use_deform for point in (bone.head_local, bone.tail_local)]
    floor = min(point.z for point in heads)
    height = max(point.z for point in heads) - floor
    facing = poses.get("facing", 0)
    # glTF +Z is Blender -Y; the model faces glTF +Z turned by `facing` about up.
    forward = Matrix.Rotation(facing, 3, "Z") @ Vector((0, -1, 0))
    left = Matrix.Rotation(facing, 3, "Z") @ Vector((1, 0, 0))
    views = [("front", forward), ("side", left)]

    files = {name: [] for name, _ in views}
    for entry in poses["frames"]:
        pose(rig, poses["nodes"], entry["model"], scale)
        for name, direction in views:
            looking = -direction
            right = looking.cross(Vector((0, 0, 1))).normalized()
            figure = stick_figure(entry["capture"], height, right * height * 0.6 + Vector((0, 0, floor)), material)
            aim(camera, centre + right * height * 0.3, direction, height)
            file = os.path.join(out, "%s-frame%03d.png" % (name, entry["clipFrame"]))
            scene.render.filepath = file
            bpy.ops.render.render(write_still=True)
            bpy.data.objects.remove(figure, do_unlink=True)
            files[name].append(file)

    sheet = os.path.join(out, "sheet.png")
    stitch(files["front"] + files["side"], len(poses["frames"]), sheet)
    print("engine-compare-sheet %s" % sheet)


main()
