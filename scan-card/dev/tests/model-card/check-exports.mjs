// Open the STL files the app exported and measure them independently of the app.
import * as N from '../../../shared/core.js';
import fs from 'fs';
const O = '/home/claude/suite/dev/out/model-card/';
for (const pos of ['print', 'scan']) {
  const z = fs.readFileSync(O + `models-${pos}.zip`), files = await N.unzip(z.buffer.slice(z.byteOffset, z.byteOffset + z.byteLength));
  for (const f of files) {
    const m = N.parseMesh(f.data.buffer.slice(f.data.byteOffset, f.data.byteOffset + f.data.byteLength), 'stl', f.name), b = N.meshBounds(m);
    console.log(pos, f.name, 'tris', m.indices.length / 3, 'edges', JSON.stringify(N.edgeReport(m)), 'volume', (N.meshVolume(m) / 1000).toFixed(2), 'mL', 'z', b.min[2].toFixed(3), '…', b.max[2].toFixed(2), 'centre xy', b.center[0].toFixed(2), b.center[1].toFixed(2));
    fs.writeFileSync(O + `${pos}-${f.name}`, Buffer.from(f.data));
  }
}
