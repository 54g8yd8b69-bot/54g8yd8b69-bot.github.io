# The tooth model's pack

The CBCT tab's "Outline by: Model" runs ToothSeg's instance network in the browser. The pack it downloads
(`scan-card/cbct/toothseg/`, about 76 MB, committed as it is) is made in two steps, by hand, when the network or the
runtime changes:

1. `python3 tools/toothseg/export_onnx.py <unpacked ToothSeg.zip>/ToothSeg <out>` — the published PyTorch checkpoint
   (Zenodo record 14893540, CC BY 4.0) to ONNX, and to the half-size file with 16-bit weight tables. It needs PyTorch
   and friends; it reads the checkpoint as data only.
2. `python3 tools/pack_toothseg.py --onnx <out>/toothseg-inst-f16.onnx --ort <node_modules/onnxruntime-web/dist>` —
   cuts the file into parts of 16 MiB (GitHub takes no file over 100 MB), copies ONNX Runtime Web's `.wasm`, and
   writes `manifest.json` (sizes and SHA-256, which the worker checks) and `NOTICE.txt` (credits and licences).

`worker.js` in the pack is built by `tools/build_scan_card.py` from `scan-card/src/toothseg-worker.js`.

What the network expects and gives, and everything done round it (the cube of scan, the teeth made from its answer,
parting two teeth it joined), is in `scan-card/src/dicom.js` under "the trained tooth model". The numbers in
`TOOTH_MODEL` there (0.2 mm voxels; grey values clipped to −58.3 … 4021, less 1907.05, over 670.67) are the ones
`export_onnx.py` prints from the checkpoint's `plans.json`.

Checked when this was made (November 2026): on a random cube the ONNX file gives the same label as PyTorch for every
voxel, and with the 16-bit weight tables for all but one voxel in a million; in Chrome (ONNX Runtime Web 1.31.1, WebAssembly, one thread) 55 voxels of
2.6 million differed from the desktop runtime on a real cube.
