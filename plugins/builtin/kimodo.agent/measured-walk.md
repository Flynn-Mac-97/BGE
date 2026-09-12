# Measured, from a soma-rp-v1.1 walk

The source states none of this. It was read off the output of "a person walks
forward", 60 frames, on 2026-09-01. Re-measure if the model changes.

- **Y is up, already.** The root holds Y at 0.95–0.99 while Z runs 0 to 3.13 —
  pelvis height and forward travel. The engine draws Y-up, so **do not pass
  `--up z`**. That flag is for a capture from somewhere else.
- **Positions are metres.** A pelvis at 0.97 is a person.
- **30 frames a second** puts that walk at 1.57 m/s. The default is right.
- 60 frames of 30 joints is a 53 KB clip file.
- SMPL-X weights carry NVIDIA's Open Model License and restrict commercial use.
  The C++ port itself is Apache-2.0.
