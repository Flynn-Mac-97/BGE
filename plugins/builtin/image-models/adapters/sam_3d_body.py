"""Image Models adapter for SAM 3D Body: one image in, each person's 70
keypoints out, in camera space, as the harness reads them (models.mjs).

Run with the Python of SAM 3D Body's own environment:

    python sam_3d_body.py --repo <sam-3d-body clone> --image photo.jpg --out answer.json --weights checkpoints/sam-3d-body-dinov3

`--weights` is the checkpoint folder, holding model.ckpt and
assets/mhr_model.pt (from Hugging Face or ModelScope). No field-of-view
estimator is loaded, so the model uses its default camera; a pose's shape
does not need the camera's true angle.
"""
import argparse
import json
import os
import sys

parser = argparse.ArgumentParser()
parser.add_argument("--repo", required=True)
parser.add_argument("--image", required=True)
parser.add_argument("--out", required=True)
parser.add_argument("--weights", default="checkpoints/sam-3d-body-dinov3")
arguments = parser.parse_args()

# Downloads made on the run (the detector's weights) stay in the clone, not
# on the system drive; a variable the user set still wins.
for variable in ("TORCH_HOME", "FVCORE_CACHE", "HF_HOME"):
    os.environ.setdefault(variable, os.path.join(arguments.repo, ".cache", variable.lower()))
# The repository is not a package; its own demo imports it from its folder.
sys.path.insert(0, arguments.repo)
import cv2  # noqa: E402
import torch  # noqa: E402
from sam_3d_body import SAM3DBodyEstimator, load_sam_3d_body  # noqa: E402
from tools.build_detector import HumanDetector  # noqa: E402

weights = os.path.join(arguments.repo, arguments.weights)
# The person detector's weights (2.8 GB) are read from here when present,
# else downloaded from Meta on the first run.
detector = os.path.join(arguments.repo, "checkpoints", "vitdet")
device = "cuda" if torch.cuda.is_available() else "cpu"
model, model_cfg = load_sam_3d_body(
    os.path.join(weights, "model.ckpt"), device=device, mhr_path=os.path.join(weights, "assets", "mhr_model.pt")
)
estimator = SAM3DBodyEstimator(
    sam_3d_body_model=model,
    model_cfg=model_cfg,
    human_detector=HumanDetector(name="vitdet", device=device, path=detector if os.path.exists(os.path.join(detector, "model_final_f05665.pkl")) else ""),
    human_segmentor=None,
    fov_estimator=None,
)
picture = cv2.imread(arguments.image)
if picture is None:
    sys.exit(f"cannot read {arguments.image}")
people = estimator.process_one_image(cv2.cvtColor(picture, cv2.COLOR_BGR2RGB))
answer = {"people": [{"points": person["pred_keypoints_3d"].tolist()} for person in people]}
with open(arguments.out, "w", encoding="utf8") as file:
    json.dump(answer, file)
print(f"{len(answer['people'])} people on {device}")
