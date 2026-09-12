# Making a clip

`node tools/make-rig-clip.mjs --prompt "a person walks forward" --name walk`
writes `project/assets/motion/walk.json`. It needs kimodo.cpp — see the
**Kimodo** guide. `--from <directory>` builds a clip from buffers that already
exist and needs no generator at all.

Clip file: `nodes` are target model node names, `rotations` is one array per
frame of four numbers per node, `root` is one `[x, y, z]` per frame.
