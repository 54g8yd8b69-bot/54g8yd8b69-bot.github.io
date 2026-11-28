#!/usr/bin/env python3
"""ToothSeg's instance network: published PyTorch checkpoint → ONNX → the half-size file the pack is made from.

    python3 export_onnx.py <unpacked ToothSeg.zip>/ToothSeg <out folder>

Needs: torch (the CPU build will do), dynamic-network-architectures (comes with nnunetv2), onnx, onnxruntime, numpy.
ToothSeg.zip is from https://zenodo.org/records/14893540 (CC BY 4.0; md5 5d8dd061cce9529943567aeba3271143). It writes

    <out>/toothseg-inst.onnx        the network as published, opset 17, any input size (multiples of 32, 32, 16)
    <out>/toothseg-inst-f16.onnx    the same with its large weight tables stored as 16-bit floats (cast back to 32-bit on load)

and checks both against PyTorch on random input. Then: python3 tools/pack_toothseg.py --onnx <out>/toothseg-inst-f16.onnx …

The checkpoint is read as data only (torch.load(weights_only=True), with numpy's plain number types allowed for the
training log it also holds): nothing in it is run. The network is built from plans.json, not from the checkpoint.
"""
import json, sys, os, numpy as np, torch, onnx
from torch import nn
from onnx import numpy_helper, helper, TensorProto
from dynamic_network_architectures.architectures.unet import PlainConvUNet

root, out = sys.argv[1], sys.argv[2]; os.makedirs(out, exist_ok=True)
base = f'{root}/Dataset123_ToothFairy2fixed_teeth_spacing02_brd3px/nnUNetTrainer__nnUNetPlans__3d_fullres_resample_torch_192_bs8_ctnorm'
plans = json.load(open(base + '/plans.json')); labels = json.load(open(base + '/dataset.json'))['labels']
def cfg(name):
    c = dict(plans['configurations'][name])
    if 'inherits_from' in c: b = cfg(c['inherits_from']); b.update(c); return b
    return c
C = cfg('3d_fullres_resample_torch_192_bs8_ctnorm'); a = C['architecture']['arch_kwargs']
net = PlainConvUNet(1, a['n_stages'], a['features_per_stage'], nn.Conv3d, a['kernel_sizes'], a['strides'], a['n_conv_per_stage'], len(labels), a['n_conv_per_stage_decoder'],
                    a['conv_bias'], nn.InstanceNorm3d, a['norm_op_kwargs'], None, None, nn.LeakyReLU, a['nonlin_kwargs'], deep_supervision=False)
try: from numpy._core.multiarray import scalar as _sc
except Exception: from numpy.core.multiarray import scalar as _sc
safe = [(_sc, 'numpy.core.multiarray.scalar'), (_sc, 'numpy._core.multiarray.scalar'), np.dtype, np.float64, np.float32, np.int64, np.int32, np.bool_] + [type(np.dtype(t)) for t in ('f8', 'f4', 'i8', 'i4', '?')]
with torch.serialization.safe_globals(safe):
    ck = torch.load(base + '/fold_5/checkpoint_final.pth', map_location='cpu', weights_only=True)
sd = {k[7:] if k.startswith('module.') else k: v for k, v in ck['network_weights'].items()}
missing, unexpected = net.load_state_dict(sd, strict=False); assert not missing and not [k for k in unexpected if 'seg_layers' not in k]
net.eval(); ip = plans['foreground_intensity_properties_per_channel']['0']
print('labels', labels, '| spacing', C['spacing'], '| grey scale: clip', ip['percentile_00_5'], ip['percentile_99_5'], 'mean', ip['mean'], 'std', ip['std'], '(TOOTH_MODEL in scan-card/src/dicom.js)')

f32 = f'{out}/toothseg-inst.onnx'
torch.onnx.export(net, torch.randn(1, 1, 64, 64, 64), f32, opset_version=17, input_names=['x'], output_names=['y'], dynamic_axes={'x': {2: 'd', 3: 'h', 4: 'w'}, 'y': {2: 'd', 3: 'h', 4: 'w'}}, dynamo=False)
# the half-size copy: every float table of 2048 values or more as 16-bit floats, with a Cast back to 32-bit at the head of the graph
m = onnx.load(f32); g = m.graph; casts = []
for t in list(g.initializer):
    if t.data_type != TensorProto.FLOAT: continue
    arr = numpy_helper.to_array(t)
    if arr.size < 2048: continue
    g.initializer.remove(t); g.initializer.append(numpy_helper.from_array(arr.astype(np.float16), t.name + '_f16'))
    casts.append(helper.make_node('Cast', [t.name + '_f16'], [t.name], to=TensorProto.FLOAT, name='cast_' + t.name))
for c in reversed(casts): g.node.insert(0, c)
onnx.checker.check_model(m); f16 = f'{out}/toothseg-inst-f16.onnx'; onnx.save(m, f16)

import onnxruntime as ort
x = torch.randn(1, 1, 96, 96, 96)
with torch.inference_mode(): yt = net(x).numpy()
for f in (f32, f16):
    yo = ort.InferenceSession(f, providers=['CPUExecutionProvider']).run(None, {'x': x.numpy()})[0]
    print(os.path.basename(f), round(os.path.getsize(f) / 1e6, 1), 'MB · largest difference from PyTorch', float(np.abs(yt - yo).max()), '· same label for', float((yt.argmax(1) == yo.argmax(1)).mean()), 'of the voxels')
