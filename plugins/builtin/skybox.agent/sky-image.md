# The sky image

- Mapped over a sphere of radius 100 m centred on the camera, drawn first with
  depth testing off, so it can never occlude anything and never fogs.
- **It must be a full sky**: the image's top edge is the zenith, its vertical middle
  the horizon, its bottom edge the nadir. Hand it a zenith-to-horizon image and the
  horizon band lands under the floor.
- A panorama is wider than it is tall. `skybox.look` warns when the loaded image is
  not, and reports `skySize` and the mapping in force.
- It wraps horizontally and clamps vertically, so the poles do not ring.
