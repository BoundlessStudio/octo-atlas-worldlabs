// atlasGenerate — walk into the picture. One posed RGBD view is the context;
// we choose new cameras and Atlas renders (and invents) what they would see.
// returnDepth: true makes every new view a posed RGBD view too, so it can be
// context for later requests and input for the splat.
import * as THREE from "three";
import { runTask, download, writeData, asInput } from "../lib/atlas.mjs";
import { place, unproject, quaternion, position } from "../lib/cameras.mjs";
import { decodeDepth, depthStats, depthToImage, rawRgb, toWebp } from "../lib/media.mjs";

export const contextFrame = (f) => ({
  imageAsset: asInput(f.imageAsset),
  camera: f.camera,
  depth: { depthAsset: asInput(f.depth.depthAsset) },
});

export function findPivot(cfg, posed) {
  const { width, height, depth } = posed.depth;
  const x = Math.round(cfg.pivot.u * width), y = Math.round(cfg.pivot.v * height);
  return unproject(posed.frame.camera, x, y, depth[y * width + x] || posed.stats.median);
}

export default async function explore(cfg, posed) {
  const base = posed.frame.camera;
  const pivot = findPivot(cfg, posed);
  const res = await runTask("03-explore", "atlasGenerate", {
    contextFrames: [contextFrame(posed.frame)],
    targetCameras: cfg.explore.map((move) => place(base, pivot, move)),
    prompt: cfg.prompt,
    returnDepth: true, // needs translated cameras + centred principal points
  }, { timeoutMin: 20 });

  // Download every view and fuse source + generated depth into one coloured point
  // cloud: the quickest honest check that the views agree in 3D.
  const frames = [posed.frame, ...res.frames];
  const views = [], chunks = [];
  for (const [i, frame] of frames.entries()) {
    const id = String(i).padStart(2, "0");
    const dir = i === 0 ? "02" : "03";
    const rgb = i === 0 ? await download(frame.imageAsset, "02/view.img") : await download(frame.imageAsset, `03/view-${id}.img`);
    const exrFile = i === 0 ? "02/depth.exr" : `03/depth-${id}.exr`;
    const depth = decodeDepth(await download(frame.depth.depthAsset, exrFile));
    const view = { image: i === 0 ? "02/view.webp" : `03/view-${id}.webp`, depth: i === 0 ? "02/depth.webp" : `03/depth-${id}.webp`, camera: frame.camera };
    if (i > 0) {
      await writeData(view.image, await toWebp(rgb));
      await writeData(view.depth, await depthToImage(depth, posed.stats));
    }
    chunks.push(await pointCloud(frame.camera, depth, rgb, posed.stats.far * 1.5));
    view.points = chunks.at(-1).length / 16;
    view.validDepth = depthStats(depth).validFraction;
    views.push(view);
  }
  await writeData("03/points.bin", Buffer.concat(chunks));

  return { frames, promptUsed: res.promptUsed, pivot: pivot.toArray(), views, points: "03/points.bin" };
}

/** Unproject every 3rd pixel → 16-byte records: float32 x, y, z + uint8 r, g, b, a. */
async function pointCloud(camera, { width, height, depth }, rgbBytes, maxDepth, stride = 3) {
  const rgb = await rawRgb(rgbBytes, width, height);
  const { fx, fy, cx, cy } = camera.intrinsics;
  const q = quaternion(camera), t = position(camera), p = new THREE.Vector3();
  const out = Buffer.alloc(Math.ceil(width / stride) * Math.ceil(height / stride) * 16);
  let n = 0;
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const z = depth[y * width + x]; // NaN = no reliable geometry: skip, never treat as 0
      if (!Number.isFinite(z) || z <= 0 || z > maxDepth) continue;
      p.set(((x - cx) / fx) * z, -((y - cy) / fy) * z, -z).applyQuaternion(q).add(t);
      out.writeFloatLE(p.x, n); out.writeFloatLE(p.y, n + 4); out.writeFloatLE(p.z, n + 8);
      rgb.copy(out, n + 12, (y * width + x) * 3, (y * width + x) * 3 + 3);
      out[n + 15] = 255;
      n += 16;
    }
  }
  return out.subarray(0, n);
}
