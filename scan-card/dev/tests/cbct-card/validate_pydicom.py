# validate_pydicom.py — an independent check of the test scans written by mkcbct.mjs: pydicom (and pylibjpeg for JPEG
# Lossless) reads every variant, the volume is put together from the files' own positions, and sample voxels are compared
# with truth.json. Run: python3 -I dev/tests/cbct-card/validate_pydicom.py
import json, os, sys, zipfile, io
import numpy as np
import pydicom

D = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'data', 'cbct')
truth = json.load(open(os.path.join(D, 'truth.json')))
fails = 0

def frames_of(ds):
    """→ list of (ipp, iop, pixel array (values), pixel spacing)"""
    arr = ds.pixel_array.astype(np.int32)
    if ds.get('BitsStored', 16) < 16 and ds.PixelRepresentation == 0:
        arr = arr & ((1 << ds.BitsStored) - 1)
    if ds.PhotometricInterpretation == 'MONOCHROME1':
        arr = ((1 << ds.BitsStored) - 1) - arr
    out = []
    if 'PerFrameFunctionalGroupsSequence' in ds:
        sh = ds.SharedFunctionalGroupsSequence[0]
        iop = [float(v) for v in sh.PlaneOrientationSequence[0].ImageOrientationPatient]
        ps = [float(v) for v in sh.PixelMeasuresSequence[0].PixelSpacing]
        pv = sh.PixelValueTransformationSequence[0]
        slope, icpt = float(pv.RescaleSlope), float(pv.RescaleIntercept)
        for f, pf in enumerate(ds.PerFrameFunctionalGroupsSequence):
            ipp = [float(v) for v in pf.PlanePositionSequence[0].ImagePositionPatient]
            out.append((ipp, iop, arr[f] * slope + icpt, ps))
        return out
    iop = [float(v) for v in ds.ImageOrientationPatient]; ps = [float(v) for v in ds.PixelSpacing]
    slope, icpt = float(ds.get('RescaleSlope', 1)), float(ds.get('RescaleIntercept', 0))
    ipp0 = [float(v) for v in ds.ImagePositionPatient]
    n = int(ds.get('NumberOfFrames', 1))
    if n > 1:
        step = float(ds.SpacingBetweenSlices); nrm = np.cross(iop[:3], iop[3:])
        for f in range(n): out.append(((np.array(ipp0) + nrm * step * f).tolist(), iop, arr[f] * slope + icpt, ps))
    else: out.append((ipp0, iop, arr * slope + icpt, ps))
    return out

def volume(frames):
    """the volume in patient axes (+x left, +y posterior, +z up): value lookup by patient position"""
    iop = frames[0][1]; R = np.array(iop[:3]); C = np.array(iop[3:]); Nn = np.cross(R, C)
    frames = sorted(frames, key=lambda f: float(np.dot(f[0], Nn)))
    return frames, R, C, Nn

def check(name, frames):
    global fails
    t = truth['variants'][name]
    frames, R, C, Nn = volume(frames)
    origin = np.array(t['origin']); sp = t['spacing']; bad = 0
    rows, cols = frames[0][2].shape
    ps = frames[0][3]
    d = [float(np.dot(f[0], Nn)) for f in frames]
    for i, j, k, v in t['samples']:
        p = origin + np.array([i * sp[0], j * sp[1], k * sp[2]])       # where truth says the voxel is
        dn = float(np.dot(p, Nn)); s = int(np.argmin([abs(x - dn) for x in d]))
        rel = p - np.array(frames[s][0]); c = int(round(np.dot(rel, R) / ps[1])); r = int(round(np.dot(rel, C) / ps[0]))
        if not (0 <= r < rows and 0 <= c < cols) or abs(d[s] - dn) > 1e-3 or abs(int(round(frames[s][2][r, c])) - v) > t.get('tol', 0): bad += 1
    print(('  ok  ' if bad == 0 else '  BAD ') + f'{name}: {len(frames)} slices of {rows}x{cols}, {bad} of {len(t["samples"])} samples wrong')
    if bad: fails += 1

def series_dir(name):
    fr = []
    for f in sorted(os.listdir(os.path.join(D, name))):
        p = os.path.join(D, name, f)
        try: ds = pydicom.dcmread(p)
        except Exception: continue
        if 'PixelData' not in ds or 'Rows' not in ds: continue
        fr += frames_of(ds)
    return fr

for n in ['a-explicit', 'b-implicit-flip', 'c-rle', 'd-jpegll', 'g-bigendian', 'h-deflated', 'i-jpegll57', 'j-coronal', 'm-u16', 'n-jpeg8']:
    check(n, series_dir(n))
check('e-enhanced', frames_of(pydicom.dcmread(os.path.join(D, 'e-enhanced.dcm'))))
check('k-legacymf', frames_of(pydicom.dcmread(os.path.join(D, 'k-legacymf.dcm'))))
z = zipfile.ZipFile(os.path.join(D, 'f-zip.zip')); fr = []
for n in z.namelist():
    if n.endswith('.dcm'): fr += frames_of(pydicom.dcmread(io.BytesIO(z.read(n))))
check('f-zip', fr)
ds = pydicom.dcmread(os.path.join(D, 'e-enhanced.dcm'))
print('  ' + ('ok  ' if ds.PatientName == truth['fake']['name'] else 'BAD ') + 'the fake name is in the files (so the privacy tests mean something):', ds.PatientName)
sys.exit(1 if fails else 0)
