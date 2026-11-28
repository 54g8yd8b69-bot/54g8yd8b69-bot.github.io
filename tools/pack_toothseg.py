#!/usr/bin/env python3
"""Write the tooth-model pack the CBCT tab downloads on request: scan-card/cbct/toothseg/ (beside the CBCT page).

    python3 tools/pack_toothseg.py --onnx <toothseg-inst-f16.onnx> --ort <node_modules/onnxruntime-web/dist> [--out scan-card/cbct/toothseg]

The pack is binary and is committed as it is; this script is run by hand when the network or the runtime changes
(tools/toothseg/ says how the .onnx file is made from the published checkpoint). It writes

    ort-wasm-simd-threaded.wasm     ONNX Runtime Web's WebAssembly build (MIT)
    toothseg-inst-f16.partN.bin     the network's weights, cut into parts of 16 MiB (GitHub takes no file over 100 MB)
    manifest.json                   sizes and SHA-256 of both, which the worker checks before use
    NOTICE.txt                      credits and licences

worker.js in the same folder is not written here: tools/build_scan_card.py bundles it from scan-card/src/toothseg-worker.js.
"""
import argparse, hashlib, json
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument('--onnx', required=True)
ap.add_argument('--ort', required=True, help='the dist folder of the onnxruntime-web package')
ap.add_argument('--out', default=str(Path(__file__).resolve().parents[1] / 'scan-card' / 'cbct' / 'toothseg'))
ap.add_argument('--ort-version', default='1.31.1')
a = ap.parse_args()
out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
PART = 16 * 1024 * 1024
sha = lambda b: hashlib.sha256(b).hexdigest()

for old in out.glob('toothseg-inst-f16.part*.bin'):
    old.unlink()
wasm = (Path(a.ort) / 'ort-wasm-simd-threaded.wasm').read_bytes()
(out / 'ort-wasm-simd-threaded.wasm').write_bytes(wasm)
model = Path(a.onnx).read_bytes()
parts = []
for i in range(0, len(model), PART):
    name = f'toothseg-inst-f16.part{i // PART}.bin'
    (out / name).write_bytes(model[i:i + PART])
    parts.append({'file': name, 'bytes': len(model[i:i + PART])})
manifest = {
    'name': 'ToothSeg instance network (ToothFairy2, fold 5, final checkpoint), ONNX, weights stored as 16-bit floats',
    'version': '2025-02-19-f16-1',
    'input': 'x', 'output': 'y', 'spacing': 0.2, 'classes': ['background', 'centre', 'border'],
    'wasm': {'file': 'ort-wasm-simd-threaded.wasm', 'bytes': len(wasm), 'sha256': sha(wasm), 'package': 'onnxruntime-web ' + a.ort_version},
    'model': {'bytes': len(model), 'sha256': sha(model), 'parts': parts},
    'licence': 'weights CC BY 4.0; runtime MIT — see NOTICE.txt',
    'source': 'https://zenodo.org/records/14893540',
}
(out / 'manifest.json').write_text(json.dumps(manifest, indent=1) + '\n')
(out / 'NOTICE.txt').write_text(f"""Tooth model pack for the CBCT tab of Scan Card (notile.co.uk)

1. The network (toothseg-inst-f16.part*.bin)

   "Model Checkpoints for ToothSeg: A Self-Correcting Deep Learning Approach for Robust Tooth Instance Segmentation and
   Numbering in CBCT" — Fabian Isensee, Niels van Nistelrooij, Lars Krämer, Shankeeth Vinayahalingam. Zenodo, 19 February 2025.
   https://zenodo.org/records/14893540        Code: https://github.com/MIC-DKFZ/ToothSeg (Apache-2.0)
   Licence of the checkpoints: Creative Commons Attribution 4.0 International (CC BY 4.0),
   https://creativecommons.org/licenses/by/4.0/

   What is used here: the instance branch only (Dataset123_ToothFairy2fixed_teeth_spacing02_brd3px,
   nnUNetTrainer__nnUNetPlans__3d_fullres_resample_torch_192_bs8_ctnorm, fold_5/checkpoint_final.pth).
   Changes made: converted from PyTorch to ONNX (opset 17) with the network unchanged; the large weight tables are stored as
   16-bit floats and turned back into 32-bit floats when the model loads; the file is cut into parts of 16 MiB.
   The network is run on a cube of 0.2 mm voxels round one tooth, not over the whole scan, and its answer is turned into
   teeth by Scan Card's own code (scan-card/src/dicom.js), not by ToothSeg's scripts.

   The checkpoints were trained on the ToothFairy2 dataset (University of Modena and Reggio Emilia with Radboud University;
   MICCAI 2024 ToothFairy2 challenge), which is released under CC BY-SA: https://ditto.ing.unimore.it/toothfairy2

2. The runtime (ort-wasm-simd-threaded.wasm, and the code bundled into worker.js)

   ONNX Runtime Web {a.ort_version} — Copyright (c) Microsoft Corporation. MIT License.
   https://github.com/microsoft/onnxruntime

Neither is certified medical-device software. The outline the network gives is a planning aid: check it against the scan.
""", encoding='utf-8')
print('wrote', out, '| wasm', len(wasm), '| model', len(model), 'in', len(parts), 'parts | sha', manifest['model']['sha256'][:16])
