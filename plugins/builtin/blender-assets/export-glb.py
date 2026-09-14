# Exports the open .blend to a glTF binary.
#
# Blender runs this with:
#
#   blender <file.blend> --background --python export-glb.py -- <out.glb> <settings json>
#
# The settings are the plugin's, already filled in with defaults, so this file
# holds no policy about what a good export is.

import bpy
import json
import os
import sys

from mathutils import Matrix


def arguments():
    """Everything after the `--` Blender stops reading at."""
    if "--" not in sys.argv:
        return []
    return sys.argv[sys.argv.index("--") + 1:]


def supported(operator, wanted):
    """Split options into ones this exporter has and ones it does not.

    Option names change between Blender versions, and an unknown keyword is a
    hard error naming none of them. Dropped names are printed, because an
    option that is quietly ignored is an export that does not match what was
    asked for.
    """
    known = set(operator.get_rna_type().properties.keys())
    kept = {key: value for key, value in wanted.items() if key in known}
    dropped = sorted(key for key in wanted if key not in known)
    return kept, dropped


def apply_scale(factor):
    """Resize the scene before export, leaving the .blend on disk untouched.

    Done here rather than through an exporter option: Blender 5 has no
    `export_global_scale`, so asking the exporter to scale works on some
    versions and silently does nothing on others.
    """
    if factor == 1.0:
        return
    for obj in bpy.context.scene.objects:
        if obj.parent is None:
            obj.matrix_world = Matrix.Scale(factor, 4) @ obj.matrix_world


def select_collection(name):
    """Select only the objects in one collection. True when it was found."""
    collection = bpy.data.collections.get(name)
    if collection is None:
        return False
    bpy.ops.object.select_all(action="DESELECT")
    for obj in collection.all_objects:
        obj.select_set(True)
    return True


def limit_textures(largest):
    """Scale every image wider or taller than `largest` down, keeping its shape.

    Scaled in memory only; the .blend on disk keeps full size. Answers the
    names of the images that were scaled.
    """
    if not largest:
        return []
    scaled = []
    for image in bpy.data.images:
        width, height = image.size
        if max(width, height) <= largest:
            continue
        factor = largest / max(width, height)
        image.scale(max(1, round(width * factor)), max(1, round(height * factor)))
        scaled.append(image.name)
    return scaled


IMAGE_FORMATS = {"auto": "AUTO", "jpeg": "JPEG", "webp": "WEBP"}


def mark_alpha_method(material):
    """Store how Blender draws this material's alpha, as a glTF extra.

    glTF has blend and mask, not dither. Blender's dithered method exports as
    blend, and blended cards such as hair then sort wrongly and mostly vanish.
    The engine reads `blenderAlpha` and draws a cutout instead.
    """
    method = getattr(material, "surface_render_method", None) or getattr(material, "blend_method", None)
    if method in ("DITHERED", "HASHED"):
        material["blenderAlpha"] = "dithered"


def mark_alpha_methods():
    for material in bpy.data.materials:
        principled = principled_of(material) if material.use_nodes and material.node_tree else None
        alpha = principled.inputs.get("Alpha") if principled else None
        if alpha is not None and (alpha.is_linked or alpha.default_value < 1):
            mark_alpha_method(material)
            material.update_tag()
    # A mesh with modifiers exports through its evaluated copy, which keeps the
    # custom properties it had when it was made.
    bpy.context.view_layer.update()


# --------------------------------------------------------------- occlusion

OCCLUSION = "_occlusion"


def use_gpu(scene):
    """Render Cycles on a GPU when this machine has one Blender can use."""
    preferences = bpy.context.preferences.addons["cycles"].preferences
    for kind in ("OPTIX", "CUDA", "HIP", "METAL", "ONEAPI"):
        try:
            preferences.compute_device_type = kind
        except TypeError:
            continue
        preferences.get_devices()
        if any(device.type == kind for device in preferences.devices):
            for device in preferences.devices:
                device.use = device.type == kind
            scene.cycles.device = "GPU"
            return kind
    scene.cycles.device = "CPU"
    return "CPU"


def bake_occlusion(samples):
    """Store, per vertex, how much sky light reaches it, as the attribute `_occlusion`.

    Baked as diffuse light from a plain white sky, with the surface colour left
    out: 1 is a point open to the whole sky, 0 a point nothing reaches. That is
    ambient occlusion with the path tracer's rules, so alpha counts and hair
    cards block only as much as they cover. Other lights are hidden for the bake.

    Per vertex, not a texture: it needs no free UV space, and one model's
    meshes often share or overlap UVs. Answers the meshes baked.
    """
    scene = bpy.context.scene
    meshes = [o for o in scene.objects if o.type == "MESH" and len(o.data.polygons) and not o.hide_render]
    if not meshes:
        return []

    world = scene.world
    sky = bpy.data.worlds.new("engine-occlusion-sky")
    sky.use_nodes = True
    sky.node_tree.nodes["Background"].inputs["Color"].default_value = (1, 1, 1, 1)
    sky.node_tree.nodes["Background"].inputs["Strength"].default_value = 1
    scene.world = sky
    lights = [o for o in scene.objects if o.type == "LIGHT" and not o.hide_render]
    for light in lights:
        light.hide_render = True

    scene.render.engine = "CYCLES"
    use_gpu(scene)
    scene.cycles.samples = samples
    bake = scene.render.bake
    bake.target = "VERTEX_COLORS"
    bake.use_pass_direct = True
    bake.use_pass_indirect = True
    bake.use_pass_color = False

    for mesh in meshes:
        colours = mesh.data.color_attributes
        if "engine-occlusion" not in colours:
            colours.new("engine-occlusion", "FLOAT_COLOR", "POINT")
        colours.active_color = colours["engine-occlusion"]
    bpy.ops.object.select_all(action="DESELECT")
    for mesh in meshes:
        mesh.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]

    materials = {slot.material for mesh in meshes for slot in mesh.material_slots if slot.material and slot.material.use_nodes}
    swapped = [white_matte(material) for material in materials]
    try:
        bpy.ops.object.bake(type="DIFFUSE")
    finally:
        for restore in swapped:
            restore()

    for mesh in meshes:
        store_occlusion(mesh.data)

    scene.world = world
    for light in lights:
        light.hide_render = False
    bpy.data.worlds.remove(sky)
    bpy.context.view_layer.update()
    return sorted(mesh.name for mesh in meshes)


def white_matte(material):
    """Draw a material as white matte with its own alpha, for the occlusion bake.

    Only what blocks light may count. Subsurface leaves the diffuse pass, so
    skin bakes dark, and a normal map makes neighbouring vertices differ, so
    surfaces bake blotchy. Alpha stays, so hair blocks only as much as it
    covers. Answers a function that puts the material back.
    """
    tree = material.node_tree
    outputs = [node for node in tree.nodes if node.type == "OUTPUT_MATERIAL" and node.is_active_output]
    if not outputs:
        return lambda: None
    surface = outputs[0].inputs["Surface"]
    original = surface.links[0].from_socket if surface.is_linked else None

    matte = tree.nodes.new("ShaderNodeBsdfDiffuse")
    matte.inputs["Color"].default_value = (1, 1, 1, 1)
    clear = tree.nodes.new("ShaderNodeBsdfTransparent")
    mix = tree.nodes.new("ShaderNodeMixShader")
    added = [matte, clear, mix]
    tree.links.new(clear.outputs[0], mix.inputs[1])
    tree.links.new(matte.outputs[0], mix.inputs[2])
    principled = principled_of(material)
    alpha = principled.inputs.get("Alpha") if principled else None
    if alpha is not None and alpha.is_linked:
        tree.links.new(alpha.links[0].from_socket, mix.inputs[0])
    else:
        mix.inputs[0].default_value = alpha.default_value if alpha is not None else 1.0
    tree.links.new(mix.outputs[0], surface)

    def restore():
        for node in added:
            tree.nodes.remove(node)
        if original is not None:
            tree.links.new(original, surface)
    return restore


def store_occlusion(data):
    """Move the baked colour into a one-number point attribute the exporter writes.

    glTF viewers multiply a vertex colour into the base colour, so the bake must
    not leave as COLOR_0. An attribute whose name starts with an underscore is
    exported as a custom attribute instead.
    """
    # Adding an attribute moves the attribute storage, so every attribute is
    # looked up by name again after one is added or removed.
    if OCCLUSION not in data.attributes:
        data.attributes.new(OCCLUSION, "FLOAT", "POINT")
    count = len(data.vertices)
    colours = [0.0] * (count * 4)
    data.color_attributes["engine-occlusion"].data.foreach_get("color", colours)
    occlusion = [min(1.0, (colours[i * 4] + colours[i * 4 + 1] + colours[i * 4 + 2]) / 3) for i in range(count)]
    data.attributes[OCCLUSION].data.foreach_set("value", occlusion)
    data.color_attributes.remove(data.color_attributes["engine-occlusion"])


# --------------------------------------------------------------- materials

def base_colour_link(material):
    """What is plugged into this material's Base Color, or None."""
    if not material or not material.use_nodes:
        return None
    for node in material.node_tree.nodes:
        if node.type != "BSDF_PRINCIPLED":
            continue
        socket = node.inputs.get("Base Color")
        if socket and socket.is_linked:
            return socket.links[0].from_node
    return None


def procedural_materials():
    """Materials whose colour glTF cannot carry.

    glTF holds fixed values and image textures, not a node graph. A material
    driving Base Color from anything but an image texture exports as flat grey,
    and the model looks untextured for no visible reason.
    """
    found = []
    for material in bpy.data.materials:
        source = base_colour_link(material)
        if source is not None and source.type != "TEX_IMAGE":
            found.append(material.name)
    return sorted(set(found))


def principled_of(material):
    for node in material.node_tree.nodes:
        if node.type == "BSDF_PRINCIPLED":
            return node
    return None


def ensure_uv(obj):
    """Bake targets need a UV layer. Unwrap only when the mesh has none."""
    if obj.data.uv_layers:
        return
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.uv.smart_project()
    bpy.ops.object.mode_set(mode="OBJECT")


def bake_base_colour(size, samples):
    """Bake every procedural material's colour to an image and wire it in.

    Cycles with the direct and indirect passes off bakes the colour alone, not
    the lighting, which is what a glTF base colour texture means. The image is
    packed, so the exporter embeds it and no file is left beside the .blend.
    """
    names = procedural_materials()
    if not names:
        return []

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = samples
    scene.render.bake.use_pass_direct = False
    scene.render.bake.use_pass_indirect = False
    scene.render.bake.use_pass_color = True

    baked = []
    for obj in [o for o in scene.objects if o.type == "MESH"]:
        materials = [slot.material for slot in obj.material_slots if slot.material]
        if not any(material.name in names for material in materials):
            continue
        ensure_uv(obj)

        targets = []
        for material in materials:
            image = bpy.data.images.new(
                "%s_baseColor" % material.name, width=size, height=size)
            node = material.node_tree.nodes.new("ShaderNodeTexImage")
            node.image = image
            material.node_tree.nodes.active = node
            targets.append((material, node, image))

        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.bake(type="DIFFUSE")

        for material, node, image in targets:
            principled = principled_of(material)
            socket = principled.inputs["Base Color"]
            for link in list(socket.links):
                material.node_tree.links.remove(link)
            material.node_tree.links.new(node.outputs["Color"], socket)
            image.pack()
            baked.append(material.name)

    return sorted(set(baked))


# ----------------------------------------------------------- shader graphs

# Property names read off a node, when it has them. Each one changes what the
# node computes, so a translator cannot work from the links alone.
NODE_PROPERTIES = (
    "operation", "blend_type", "data_type", "vector_type", "noise_dimensions",
    "feature", "distance", "wave_type", "wave_profile", "bands_direction",
    "rings_direction", "gradient_type", "use_clamp", "clamp_factor",
    "invert", "uv_map", "from_instancer", "convert_from", "convert_to",
    "voronoi_dimensions", "wave_dimensions", "attribute_name", "attribute_type",
    "offset", "offset_frequency", "squash", "squash_frequency", "normalize",
    "interpolation_type", "data_type", "domain", "space", "direction_type",
)


def socket_value(socket):
    """A socket's own value, for an input nothing is plugged into."""
    raw = getattr(socket, "default_value", None)
    if raw is None:
        return None
    try:
        return list(raw)
    except TypeError:
        return raw


def node_entry(node):
    # A list, not a map: a Math node's three inputs are all named "Value", and
    # keying by name keeps only the last of them.
    entry = {
        "type": node.type,
        "inputs": [{"name": socket.name, "value": socket_value(socket)} for socket in node.inputs],
        "outputs": [socket.name for socket in node.outputs],
        "properties": {},
    }
    for key in NODE_PROPERTIES:
        if hasattr(node, key):
            entry["properties"][key] = getattr(node, key)
    if hasattr(node, "color_ramp"):
        entry["properties"]["stops"] = [
            {"position": stop.position, "colour": list(stop.color)}
            for stop in node.color_ramp.elements
        ]
        entry["properties"]["interpolation"] = node.color_ramp.interpolation
    if getattr(node, "image", None) is not None:
        entry["properties"]["image"] = node.image.name
        entry["properties"]["colourspace"] = node.image.colorspace_settings.name
        entry["properties"]["extension"] = getattr(node, "extension", "REPEAT")
    # A curve is a list of points per channel, sampled in the engine the same
    # way Blender samples it: piecewise between the points it was drawn with.
    if getattr(node, "mapping", None) is not None and hasattr(node.mapping, "curves"):
        node.mapping.update()
        entry["properties"]["curves"] = [
            [{"x": point.location[0], "y": point.location[1]} for point in curve.points]
            for curve in node.mapping.curves
        ]
    # A Value or RGB node holds its number on its OUTPUT, not on an input.
    if node.type in ("VALUE", "RGB") and node.outputs:
        entry["properties"]["value"] = socket_value(node.outputs[0])
    return entry


# Nodes that compute nothing and only carry a value from one socket to another.
# They are removed from the graph and their links joined up, so the engine
# never has to know a node group, a reroute or a muted node existed.
PASS_THROUGH = ("GROUP", "GROUP_INPUT", "GROUP_OUTPUT", "REROUTE")

# Nodes that hold no maths at all: layout only.
LAYOUT = ("FRAME",)


def flat_parts(tree, prefix, group_name, parts):
    """Collect one tree's nodes and links, descending into every node group.

    A node inside a group is named `<group node>/<node>`, so two copies of one
    group used in one material stay two sets of nodes.

    `parts["through"]` maps an output socket that computes nothing to the input
    socket its value comes from:

      group node output j   <- that group's Group Output input j
      Group Input output i  <- the group node's own input i
      reroute output 0      <- its input 0
      muted node output     <- the input Blender's internal links name
    """
    through, defaults = parts["through"], parts["defaults"]
    for node in tree.nodes:
        name = prefix + node.name
        if node.type in LAYOUT:
            continue
        if node.type == "OUTPUT_MATERIAL" and not node.is_active_output:
            continue
        for index, socket in enumerate(node.inputs):
            defaults[(name, index)] = socket_value(socket)

        if node.type == "GROUP" and node.node_tree is not None:
            inner = name + "/"
            flat_parts(node.node_tree, inner, name, parts)
            outputs = [one for one in node.node_tree.nodes if one.type == "GROUP_OUTPUT"]
            active = [one for one in outputs if one.is_active_output] or outputs
            for index in range(len(node.outputs)):
                if active:
                    through[(name, index)] = (inner + active[0].name, index)
        elif node.type == "GROUP_INPUT":
            for index in range(len(node.outputs)):
                through[(name, index)] = (group_name, index)
        elif node.type in ("REROUTE", "GROUP_OUTPUT"):
            if node.type == "REROUTE":
                through[(name, 0)] = (name, 0)
        elif node.mute:
            # Blender's own record of which input a muted node passes to each
            # output. Input 0 is often a factor, not the value that flows on.
            inputs, outputs = list(node.inputs), list(node.outputs)
            for link in node.internal_links:
                through[(name, outputs.index(link.to_socket))] = (name, inputs.index(link.from_socket))
        else:
            parts["nodes"][name] = node_entry(node)

    for link in tree.links:
        if not link.is_valid or link.is_muted:
            continue
        parts["incoming"][(prefix + link.to_node.name,
                           list(link.to_node.inputs).index(link.to_socket))] = (
            prefix + link.from_node.name,
            list(link.from_node.outputs).index(link.from_socket))


def source_of(parts, name, index, depth=0):
    """Where a value really comes from, following every pass-through node.

    Answers ("node", name, index) for a node that computes, or ("value", raw)
    when the chain ends at an input nothing is plugged into — a group's own
    unlinked input, whose value is the one set on the group node.
    """
    if depth > 256:
        return ("value", None)
    if (name, index) not in parts["through"]:
        return ("node", name, index)
    feeding = parts["through"][(name, index)]
    if feeding in parts["incoming"]:
        return source_of(parts, *parts["incoming"][feeding], depth=depth + 1)
    return ("value", parts["defaults"].get(feeding))


def graph_of(material):
    """One material's node graph, with every group flattened into plain nodes."""
    parts = {"nodes": {}, "incoming": {}, "through": {}, "defaults": {}}
    flat_parts(material.node_tree, "", None, parts)

    graph = {"nodes": parts["nodes"], "links": []}
    for (to_name, to_index), (from_name, from_index) in parts["incoming"].items():
        consumer = graph["nodes"].get(to_name)
        if consumer is None:
            continue
        found = source_of(parts, from_name, from_index)
        if found[0] == "value":
            # An unlinked group input: its value moves onto the socket it fed.
            if found[1] is not None and to_index < len(consumer["inputs"]):
                consumer["inputs"][to_index]["value"] = found[1]
            continue
        producer = graph["nodes"].get(found[1])
        if producer is None:
            continue
        graph["links"].append({
            "fromNode": found[1],
            "fromSocket": producer["outputs"][found[2]] if found[2] < len(producer["outputs"]) else "",
            "fromIndex": found[2],
            "toNode": to_name,
            "toSocket": consumer["inputs"][to_index]["name"] if to_index < len(consumer["inputs"]) else "",
            "toIndex": to_index,
        })
    return graph


def save_images(directory, stem):
    """Write every image a material samples, beside the model.

    A `.glb` embeds only the textures its own material slots use. A translated
    node graph may sample an image from anywhere in the file, so each one is
    written out and named in the graph file.
    """
    written = {}
    if not bpy.data.images:
        return written
    folder = os.path.join(directory, "%s.textures" % stem)
    for image in bpy.data.images:
        if image.size[0] == 0 or image.size[1] == 0:
            continue
        if not any(image.name == node.image.name
                   for material in bpy.data.materials if material.use_nodes and material.node_tree
                   for node in material.node_tree.nodes
                   if getattr(node, "image", None) is not None):
            continue
        if not os.path.isdir(folder):
            os.makedirs(folder)
        safe = "".join(character if character.isalnum() or character in "-_." else "_"
                       for character in image.name)
        if not safe.lower().endswith(".png"):
            safe += ".png"
        path = os.path.join(folder, safe)
        copy = image.copy()
        copy.filepath_raw = path
        copy.file_format = "PNG"
        try:
            copy.save()
            written[image.name] = "%s.textures/%s" % (stem, safe)
        except RuntimeError:
            pass
        bpy.data.images.remove(copy)
    return written


def dump_graphs(path):
    """Write every material's graph beside the model.

    The .glb cannot hold a node graph, so it is written out whole and the
    engine rebuilds the material from it. Names match the glTF material names,
    which is how the two are joined up.
    """
    materials = {}
    for material in bpy.data.materials:
        if material.use_nodes and material.node_tree:
            materials[material.name] = graph_of(material)
    directory = os.path.dirname(path)
    stem = os.path.basename(path)
    for ending in (".shaders.json", ".json"):
        if stem.endswith(ending):
            stem = stem[:-len(ending)]
            break
    textures = save_images(directory, stem)
    with open(path, "w", encoding="utf8") as handle:
        json.dump({"materials": materials, "textures": textures}, handle, indent=1)
    return sorted(materials)


def main():
    argv = arguments()
    if not argv:
        raise SystemExit("no output path given")
    out = argv[0]
    settings = json.loads(argv[1]) if len(argv) > 1 else {}
    graphs_out = argv[2] if len(argv) > 2 else None

    apply_scale(float(settings.get("scale", 1)))
    scaled = limit_textures(int(settings.get("textureSize") or 0))
    mark_alpha_methods()
    occluded = bake_occlusion(int(settings.get("occlusionSamples", 64))) if settings.get("occlusion") else []

    procedural = procedural_materials()
    baked = []
    if settings.get("bake"):
        baked = bake_base_colour(int(settings.get("bakeSize", 1024)), int(settings.get("bakeSamples", 16)))
        procedural = procedural_materials()

    use_selection = False
    collection = settings.get("collection")
    if collection:
        if not select_collection(collection):
            raise SystemExit('no collection named "%s" in this file' % collection)
        use_selection = True

    wanted = {
        "filepath": out,
        "export_format": "GLB",
        "export_apply": bool(settings.get("applyModifiers", True)),
        "export_yup": True,
        "use_selection": use_selection,
        "export_cameras": False,
        "export_lights": False,
        "export_extras": True,
        "export_attributes": bool(occluded),
        "export_image_format": IMAGE_FORMATS.get(settings.get("imageFormat"), "AUTO"),
    }
    kept, dropped = supported(bpy.ops.export_scene.gltf, wanted)
    bpy.ops.export_scene.gltf(**kept)

    if graphs_out and settings.get("shaders", True):
        print("engine-export-graphs %s" % ",".join(dump_graphs(graphs_out)))
    if dropped:
        print("engine-export-dropped %s" % ",".join(dropped))
    if scaled:
        print("engine-export-scaled %s" % ",".join(scaled))
    if occluded:
        print("engine-export-occluded %s" % ",".join(occluded))
    if baked:
        print("engine-export-baked %s" % ",".join(baked))
    if procedural:
        print("engine-export-procedural %s" % ",".join(procedural))
    # Read by the importer to tell a real export from a Blender that started,
    # printed a warning and quit.
    print("engine-export-ok %s" % out)


main()
