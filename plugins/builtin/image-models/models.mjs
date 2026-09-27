/**
 * Image Models' node half: the image models it knows, whether each is
 * installed, and running one on an image. Node only: a model is a program in
 * its own Python environment, outside this checkout.
 *
 * A model is one entry in MODELS and one adapter script in adapters/. The
 * adapter is called as
 *
 *   <python> adapters/<adapter> --repo <home> --image <file> --out <json> [--weights <folder in home>]
 *
 * and writes `{ people: [{ points: [[x, y, z], ...] }] }`: camera-space points
 * in the order the entry's `points` names them (pose-record.js). The record
 * is written to `assets/poses/<image name>.<model id>.json`.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { poseRecordOf } from './pose-record.js'

const ADAPTERS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'adapters')

/** SAM 3D Body's 70 keypoints (MHR70), in its own order: sam_3d_body/metadata/mhr70.py. */
const MHR70 = [
  'nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear', 'left_shoulder', 'right_shoulder', 'left_elbow',
  'right_elbow', 'left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle', 'left_big_toe',
  'left_small_toe', 'left_heel', 'right_big_toe', 'right_small_toe', 'right_heel',
  ...['thumb', 'forefinger', 'middle_finger', 'ring_finger', 'pinky_finger'].flatMap(finger =>
    ['4', '3', '2', '_third_joint'].map(part => `right_${finger}${part}`)),
  'right_wrist',
  ...['thumb', 'forefinger', 'middle_finger', 'ring_finger', 'pinky_finger'].flatMap(finger =>
    ['4', '3', '2', '_third_joint'].map(part => `left_${finger}${part}`)),
  'left_wrist', 'left_olecranon', 'right_olecranon', 'left_cubital_fossa', 'right_cubital_fossa', 'left_acromion',
  'right_acromion', 'neck'
]

/**
 * Every image model: what it makes, where its repository and Python are
 * (an environment variable, else beside the checkout), how to tell it is
 * installed, and how to install it.
 */
const MODELS = [
  {
    id: 'sam-3d-body',
    about: 'SAM 3D Body (Meta): the 3D pose of each person in a photo',
    makes: 'pose',
    adapter: 'sam_3d_body.py',
    points: MHR70,
    weights: 'checkpoints/sam-3d-body-dinov3',
    homeVariable: 'SAM_3D_BODY_HOME',
    folder: 'sam-3d-body',
    pythonVariable: 'SAM_3D_BODY_PYTHON',
    installedWhen: 'checkpoints/sam-3d-body-dinov3/model.ckpt',
    install: [
      'git clone https://github.com/facebookresearch/sam-3d-body.git  (beside the checkout, or set SAM_3D_BODY_HOME)',
      'download model.ckpt and assets/mhr_model.pt from modelscope.cn/models/facebook/sam-3d-body-dinov3 (open, no login) into checkpoints/sam-3d-body-dinov3/',
      'optional: the person detector, dl.fbaipublicfiles.com/detectron2/ViTDet/COCO/cascade_mask_rcnn_vitdet_h/f328730692/model_final_f05665.pkl, into checkpoints/vitdet/ (else it downloads on the first run)',
      'a Python 3.10 or 3.11 environment with PyTorch for your GPU (pytorch.org), the packages in its INSTALL.md, and setuptools<80 (detectron2 needs pkg_resources)',
      'detectron2, built from a Visual Studio x64 prompt; with a CUDA older than the compiler, set NVCC_APPEND_FLAGS=-allow-unsupported-compiler',
      "make it the repository's .venv, or set SAM_3D_BODY_PYTHON to its python"
    ]
  }
]

/**
 * The Python a model runs with: its environment variable, else a `.venv` in
 * its repository, else `python` on the path.
 */
function pythonOf(home, entry) {
  const venv = path.join(home, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
  return process.env[entry.pythonVariable] || (fs.existsSync(venv) ? venv : 'python')
}

/** Where a model's repository is. */
const homeOf = (checkout, entry) => process.env[entry.homeVariable] || path.resolve(checkout, '..', entry.folder)

/** Every model, whether it is installed, and how to install it. */
export function imageModels(checkout) {
  return MODELS.map(entry => ({
    id: entry.id,
    about: entry.about,
    makes: entry.makes,
    isInstalled: fs.existsSync(path.join(homeOf(checkout, entry), entry.installedWhen)),
    install: entry.install
  }))
}

/**
 * Run `model` on `image` (a project path) and write its pose record. Answers
 * `{ file, people }`: the record as a project path and how many people it has.
 */
export async function runImageModel(host, { model, image }) {
  const entry = MODELS.find(one => one.id === model)
  if (!entry) throw new Error(`no image model ${model}; one of ${MODELS.map(one => one.id).join(', ')}`)
  const home = homeOf(host.checkout, entry)
  if (!fs.existsSync(path.join(home, entry.installedWhen))) throw new Error(`${model} is not installed at ${home}: ${entry.install.join('; ')}`)
  const source = path.join(host.project, image ?? '')
  if (!image || !fs.existsSync(source)) throw new Error(`no image ${image} in the project`)
  const answer = path.join(os.tmpdir(), `image-model-${model}-${path.basename(image)}.json`)
  const python = pythonOf(home, entry)
  const ran = await host.run(python, [
    path.join(ADAPTERS, entry.adapter), '--repo', home, '--image', source, '--out', answer, '--weights', entry.weights
  ], { cwd: home })
  if (ran.code !== 0) throw new Error(`${model} failed: ${(ran.error || ran.out).slice(-1500)}`)
  const raw = JSON.parse(fs.readFileSync(answer, 'utf8'))
  const record = poseRecordOf({ model, image, names: entry.points, people: raw.people })
  const file = `assets/poses/${path.basename(image, path.extname(image))}.${model}.json`
  fs.mkdirSync(path.join(host.project, 'assets', 'poses'), { recursive: true })
  fs.writeFileSync(path.join(host.project, file), JSON.stringify(record, null, 2) + '\n')
  return { file, people: record.people.length }
}
