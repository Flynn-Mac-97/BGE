# Shared geometry helpers for the Kitten Survivors creature scripts.
#
# Lifted out of make-kitten-survivors-kitten.py once a second creature script
# wanted the same ring, loft, rounded block and cone builders. A creature
# script brings this in with:
#
#   exec(open(r"Z:/Code/browser game engine/tools/blender/lib.py").read())
#
# run inside Blender, before its own build() — the same way the kitten script
# is itself run. No import system: BlenderMCP executes a string of code, and
# exec-of-a-file is the form that works both from the Text Editor and from MCP.
#
# Ground is Blender z = 0. Nose is Blender +Y — the exporter maps that to
# glTF -Z, the direction the camera faces at yaw 0. A leg or wing object's
# origin is at the joint that swings it, buried inside the body mass, so a
# static or posed limb never opens a gap at the joint.

import bpy
import bmesh
import math
import os


def linear(hex_colour):
    """glTF stores linear colour; the art language writes sRGB."""
    value = int(hex_colour.lstrip("#"), 16)
    out = []
    for shift in (16, 8, 0):
        channel = ((value >> shift) & 255) / 255.0
        out.append(channel / 12.92 if channel <= 0.04045
                   else ((channel + 0.055) / 1.055) ** 2.4)
    return (out[0], out[1], out[2], 1.0)


def build_materials(colours, order):
    """One Principled BSDF per name in `order`, coloured from `colours`."""
    made = []
    for name in order:
        material = bpy.data.materials.new(name)
        material.use_nodes = True
        shader = material.node_tree.nodes["Principled BSDF"]
        shader.inputs["Base Color"].default_value = linear(colours[name])
        shader.inputs["Roughness"].default_value = 0.85
        shader.inputs["Metallic"].default_value = 0.0
        made.append(material)
    return made


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


def rings_along(bm, path, sides=6, squareness=0.4):
    """Rings for a tail hanging straight back: path is (y, z, radius) triples."""
    return [ring(bm, y, z, radius, radius, sides=sides, squareness=squareness)
            for y, z, radius in path]


def rings_at(bm, points, sides=6, squareness=0.4):
    """
    Rings translated along an arbitrary 3D path, for a tusk, horn or claw that
    curves in more than one axis. `points` is (x, y, z, radius). Each ring
    keeps its cross-section in the XZ plane rather than turning to face the
    path — the same simplification the legs already use — which is unnoticed
    on anything this short and saves the work of tracking a tangent.
    """
    made = []
    for x, y, z, radius in points:
        section = ring(bm, 0.0, 0.0, radius, radius, sides=sides, squareness=squareness)
        for vert in section:
            vert.co = (vert.co.x + x, y, vert.co.z + z)
        made.append(section)
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
    """A pyramid, used for ears, horns, tusks and noses."""
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


def wedge(bm, corners):
    """
    A flat blade of four corner points, front-face-only: one quad. Used for a
    wing or a fin, where only the top needs to draw and a solid slab would
    double the face count for a surface the camera sees from one side.

    `corners` runs root-near, root-far, tip-far, tip-near — the same winding
    `loft` uses, so the face points the right way for backface culling.
    """
    verts = [bm.verts.new(point) for point in corners]
    return [bm.faces.new(verts)]


def paint(faces, slot, material):
    for face in faces:
        face.material_index = slot[material]


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


def build_leg(name, hip_x, hip_y, hip_height, path, paw_forward, materials,
              slot, fur_material, paw_material,
              paw_half=(0.034, 0.042, 0.014), sides=6, squareness=0.35):
    """
    A leg as a lofted tube plus a paw block, its origin at the hip.

    `path` is (z, y_offset, radius) local to the hip, first ring ABOVE the hip
    and inside the body, so the leg never opens a gap at the joint. Matches
    build_leg in make-kitten-survivors-kitten.py; call it once per leg name.
    """
    bm = bmesh.new()
    rings = []
    for z, y_offset, radius in path:
        section = ring(bm, 0.0, 0.0, radius, radius, sides=sides, squareness=squareness)
        for vert in section:
            vert.co = (vert.co.x, y_offset + vert.co.z, z)
        rings.append(section)
    paint(loft(bm, rings), slot, fur_material)

    ankle_z, ankle_y, _ = path[-1]
    paint(rounded_block(bm, (0.0, ankle_y + paw_forward, ankle_z + paw_half[2]),
                        paw_half, roundness=0.5), slot, paw_material)

    return finish(bm, name, materials, origin=(hip_x, hip_y, hip_height))


def clear_scene():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for mesh in list(bpy.data.meshes):
        bpy.data.meshes.remove(mesh)
    for material in list(bpy.data.materials):
        bpy.data.materials.remove(material)
