// Sanity check without a GPU: project SPZ splat centres through an Atlas camera.
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import * as THREE from "three";
const [spz, manifestFile, out, viewIdx = "0"] = process.argv.slice(2);
const b = gunzipSync(readFileSync(spz));
const version = b.readUInt32LE(4), n = b.readUInt32LE(8), shDeg = b[12], frac = b[13], flags = b[14];
console.log({ version, n, shDeg, frac, flags, bytes: b.length });
const pos = 16, alpha = pos + n * 9, col = alpha + n;
const m = JSON.parse(readFileSync(manifestFile));
const cam = m.explore.views[+viewIdx].camera, { fx, fy, cx, cy, width: W, height: H } = cam.intrinsics;
const q = new THREE.Quaternion(...cam.extrinsics.quaternion).invert(), t = new THREE.Vector3(...cam.extrinsics.position);
const img = Buffer.alloc(W * H * 3), zb = new Float32Array(W * H).fill(Infinity), p = new THREE.Vector3();
const min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9], scale = 1 / (1 << frac);
const i24 = (o) => { let v = b[o] | (b[o + 1] << 8) | (b[o + 2] << 16); return v & 0x800000 ? v - 0x1000000 : v; };
for (let i = 0; i < n; i++) {
  const x = i24(pos + i * 9) * scale, y = i24(pos + i * 9 + 3) * scale, z = i24(pos + i * 9 + 6) * scale;
  [x, y, z].forEach((v, k) => { min[k] = Math.min(min[k], v); max[k] = Math.max(max[k], v); });
  if (b[alpha + i] < 128) continue;
  p.set(x, y, z).sub(t).applyQuaternion(q);
  const d = -p.z; if (d < 0.1) continue;
  const u = Math.round(cx + (fx * p.x) / d), v = Math.round(cy - (fy * p.y) / d);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const uu = u + dx, vv = v + dy; if (uu < 0 || vv < 0 || uu >= W || vv >= H) continue;
    const k = vv * W + uu; if (d >= zb[k]) continue; zb[k] = d;
    for (let c = 0; c < 3; c++) img[k * 3 + c] = Math.max(0, Math.min(255, ((b[col + i * 3 + c] / 255 - 0.5) / 0.15) * 0.2820948 * 255 + 127.5));
  }
}
console.log("bounds", min.map((v) => v.toFixed(2)), max.map((v) => v.toFixed(2)));
await sharp(img, { raw: { width: W, height: H, channels: 3 } }).resize(900).jpeg().toFile(out);
