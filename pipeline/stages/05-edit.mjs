// atlasMasked — change one thing, in several views at once, and keep everything else.
// Each view is sent with its camera and a keep-mask (white = keep, black = redo).
// Because every view is posed, one 3D region can be projected into all of them.
import * as THREE from "three";
import { runTask, download, upload, writeData, asInput } from "../lib/atlas.mjs";
import { project, unproject } from "../lib/cameras.mjs";
import { keepMask, maskOverlay, toWebp } from "../lib/media.mjs";

export default async function edit(cfg, posed, explore) {
  const { anchor, width, depth, heights, views, prompt } = cfg.edit;
  const W = 1280, H = 720; // atlasMasked serves exactly this grid

  // Centre of the region: the surface seen at the anchor pixel of the first view.
  const src = posed.depth;
  const ax = Math.round(anchor.u * src.width), ay = Math.round(anchor.v * src.height);
  const centre = unproject(posed.frame.camera, ax, ay, src.depth[ay * src.width + ax]);

  // Fill the box with sample points; each one becomes a small disc in every view.
  const samples = [];
  for (let i = 0; i < 6000; i++) {
    samples.push(new THREE.Vector3(
      centre.x + (Math.random() - 0.5) * width,
      heights[0] + Math.random() * (heights[1] - heights[0]),
      centre.z + (Math.random() - 0.5) * depth,
    ));
  }

  const frames = views.map((i) => explore.frames[i]);
  const contextFrames = [], pairs = [];
  for (const [n, frame] of frames.entries()) {
    const id = String(views[n]).padStart(2, "0");
    const discs = samples.map((p) => project(frame.camera, p)).filter((p) => p.z > 0.05)
      .map((p) => ({ x: p.x, y: p.y, r: (frame.camera.intrinsics.fx * 0.05) / p.z }));
    const mask = await keepMask(W, H, discs);
    const rgb = await download(frame.imageAsset, views[n] === 0 ? "02/view.img" : `03/view-${id}.img`);
    await writeData(`05/mask-${id}.webp`, await maskOverlay(rgb, mask));
    contextFrames.push({
      imageAsset: asInput(frame.imageAsset), // never pre-mask the RGB: the model needs the context
      maskAsset: await upload("05-edit", `mask-${id}.png`, mask, "image/png"), // Assets API upload
      camera: frame.camera,
    });
    pairs.push({ before: views[n] === 0 ? "02/view.webp" : `03/view-${id}.webp`, mask: `05/mask-${id}.webp`, after: `05/after-${id}.webp` });
  }

  const res = await runTask("05-edit", "atlasMasked", {
    contextFrames,
    targetCameras: frames.map((f) => f.camera), // complete each view at its own camera
    prompt, // an *instruction*: the enhancer rewrites it into a description of the finished scene
    returnDepth: false,
  });
  for (const [n, frame] of res.frames.entries()) {
    await writeData(pairs[n].after, await toWebp(await download(frame.imageAsset, `05/raw-${n}.img`)));
  }
  return { prompt, promptUsed: res.promptUsed, pairs };
}
