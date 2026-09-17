# Print what a .blend holds, as one JSON line: collections, armatures and the
# meshes each deforms, and the `collection` setting that exports one character.
#
#   blender <file>.blend --background --python inspect-blend.py
import bpy
import json


def collections_of(obj):
    return [collection.name for collection in obj.users_collection]


def armature_of(mesh):
    return next((modifier.object.name for modifier in mesh.modifiers
                 if modifier.type == "ARMATURE" and modifier.object), None)


def tallest(objects):
    """Height in the file's own units, over the objects' bounding boxes."""
    heights = [(obj.matrix_world @ __import__("mathutils").Vector(corner)).z for obj in objects for corner in obj.bound_box]
    return round(max(heights) - min(heights), 4) if heights else 0


meshes = [obj for obj in bpy.data.objects if obj.type == "MESH"]
characters = []
for rig in (obj for obj in bpy.data.objects if obj.type == "ARMATURE"):
    deformed = [mesh for mesh in meshes if armature_of(mesh) == rig.name]
    if not deformed:
        continue
    wanted = sorted({name for obj in [rig, *deformed] for name in collections_of(obj)})
    characters.append({
        "armature": rig.name,
        "bones": len(rig.data.bones),
        "deformBones": sum(bone.use_deform for bone in rig.data.bones),
        "meshes": [mesh.name for mesh in deformed],
        "height": tallest(deformed),
        # The import `scale` that makes it 1.75 m, for a person; a creature picks its own height.
        "scaleForPerson": round(1.75 / (tallest(deformed) * bpy.context.scene.unit_settings.scale_length), 5) if tallest(deformed) else None,
        "collection": wanted,
        "hidden": sorted(mesh.name for mesh in deformed if mesh.hide_get() or mesh.hide_viewport),
    })

report = {
    "units": bpy.context.scene.unit_settings.system,
    "unitScale": bpy.context.scene.unit_settings.scale_length,
    "collections": [{"name": collection.name, "objects": len(collection.all_objects)} for collection in bpy.data.collections],
    "characters": characters,
    "otherMeshes": len([mesh for mesh in meshes if not armature_of(mesh)]),
}
print("engine-inspect " + json.dumps(report))
