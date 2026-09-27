---
skill: image-models
description: Run an image model, such as SAM 3D Body, on a picture in the project and keep what it makes, such as a body pose for a Kimodo key pose. Use to get a pose from a photo, to add another image model to the harness, or when a model reports not installed.
triggers: image model, pose from image, pose from photo, sam 3d body, sam-3d-body, photo to pose, reference pose, mhr70, keypoints from image
match: plugins/builtin/image-models.js, plugins/builtin/image-models/**
category: assets
---

# Image Models

A simple harness: a picture in the project goes in, a record comes out.
Each model is a program in its own Python environment, outside this
checkout, run through one adapter script. **IMAGES** in the top bar opens the
panel: pick an image, pick a model, **Run**.

- `image.models` — every model, whether it is installed, and its install steps.
- `image.run '{"model":"sam-3d-body","image":"assets/images/lunge.jpg"}'` — minutes on the first run.
- `image.poses` — the pose records made so far.

From a terminal, run it headless so the run is not cut off:
`node bin/engine.mjs --headless --project <project> run image.run '{...}'`.

## A pose record

`assets/poses/<image>.<model>.json` is
`{ model, image, kind: 'pose', people: [{ points: { left_wrist: [x, y, z], ... } }] }`,
in the space Kimodo keys use: metres, +Y up, the person facing +Z with their
left at +X, between the hips at x = z = 0, the lowest foot point at y = 0
(`image-models/pose-record.js`). On the Kimodo board, **photo pose** in
Keys turns a record into key poses. SAM 3D Body names 70 points (MHR70):
shoulders, elbows, wrists, hips, knees, ankles, heels, toes, fingers, neck.

## SAM 3D Body

Meta's model: the 3D pose of each person in one photo. Needs a GPU
(about 8 GB), Python 3.11, PyTorch and detectron2. The weights are open on
ModelScope (`facebook/sam-3d-body-dinov3`: model.ckpt, assets/mhr_model.pt);
Hugging Face gates the same files. The panel lists the install steps. It looks for the clone in `SAM_3D_BODY_HOME`, else
`sam-3d-body` beside the checkout, and runs `SAM_3D_BODY_PYTHON`, else
`python`.

## Adding a model

1. An entry in `MODELS` in `image-models/models.mjs`: id, about, what it
   makes, its adapter, its point names, where it is found and how to
   install it.
2. An adapter in `image-models/adapters/`, called as
   `<python> <adapter> --repo <home> --image <file> --out <json> --weights <folder>`,
   writing `{ people: [{ points: [[x, y, z], ...] }] }` in camera space
   (+X right, +Y down, +Z away), in the entry's point order.

A model that makes something other than a pose needs its own record shape
and reader beside `pose-record.js`.
