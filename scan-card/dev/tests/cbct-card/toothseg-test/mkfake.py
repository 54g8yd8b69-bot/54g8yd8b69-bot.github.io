#!/usr/bin/env python3
"""fake.onnx — a stand-in for the tooth network, for the browser tests (a few hundred bytes; needs the onnx package to remake).

It takes the same input and gives the same kind of answer as the real one (x: 1×1×D×H×W on the network's grey scale →
y: 1×3×D×H×W scores for background, centre, border), but by a rule that is only right on the scan the test makes up for it
(solid teeth of grey 1700 in air, the edge half way at 350): a voxel brighter than 350 is tooth; a tooth voxel with
nothing but tooth for 0.6 mm (3 voxels) each way is "centre", any other "border" — the same meaning the real network's
answer has. So the tests can drive the page's whole model path — the worker, ONNX Runtime, the download and the device's
store, the teeth made from the answer — without the 62 MB of real weights.

    python3 mkfake.py        (writes fake.onnx beside this file)
"""
import numpy as np, onnx
from onnx import helper, TensorProto, numpy_helper
from pathlib import Path
MEAN, STD = 1907.0513121865397, 670.6687916924831
c = lambda name, v: numpy_helper.from_array(np.array(v, dtype=np.float32), name)
nodes = [
    helper.make_node('Sub', ['x', 'x0'], ['d']), helper.make_node('Mul', ['d', 'k'], ['dk']), helper.make_node('Clip', ['dk', 'zero', 'one'], ['b']),            # 1 where tooth
    helper.make_node('Neg', ['b'], ['nb']), helper.make_node('MaxPool', ['nb'], ['mnb'], kernel_shape=[7, 7, 7], pads=[3, 3, 3, 3, 3, 3]), helper.make_node('Neg', ['mnb'], ['e']),   # 1 where all is tooth for 3 voxels each way
    helper.make_node('Mul', ['b', 'm2'], ['bm']), helper.make_node('Add', ['bm', 'one'], ['l0']),                                                              # background: 1 − 2b
    helper.make_node('Mul', ['b', 'two'], ['b2']), helper.make_node('Sub', ['b2', 'one'], ['l2']),                                                             # border: 2b − 1
    helper.make_node('Mul', ['e', 'four'], ['e4']), helper.make_node('Sub', ['e4', 'two'], ['e42']), helper.make_node('Add', ['l2', 'e42'], ['l1']),           # centre: border + 4e − 2
    helper.make_node('Concat', ['l0', 'l1', 'l2'], ['y'], axis=1),
]
g = helper.make_graph(nodes, 'fake-toothseg',
                      [helper.make_tensor_value_info('x', TensorProto.FLOAT, [1, 1, 'd', 'h', 'w'])], [helper.make_tensor_value_info('y', TensorProto.FLOAT, [1, 3, 'd', 'h', 'w'])],
                      [c('x0', (350 - MEAN) / STD - 0.025), c('k', 20.0), c('zero', 0.0), c('one', 1.0), c('m2', -2.0), c('two', 2.0), c('four', 4.0)])
m = helper.make_model(g, opset_imports=[helper.make_opsetid('', 17)], producer_name='notile-tests'); m.ir_version = 8
onnx.checker.check_model(m)
out = Path(__file__).with_name('fake.onnx'); onnx.save(m, out); print('wrote', out, out.stat().st_size, 'bytes')
