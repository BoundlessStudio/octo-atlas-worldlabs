// images2PosedRGBD — estimate the camera and a metric depth map for the image.
// The result (colour + camera + depth) is a "posed RGBD view", the unit every
// other Atlas task trades in.
import { runTask, download, writeData, asInput } from "../lib/atlas.mjs";
import { decodeDepth, depthStats, depthToImage, toWebp } from "../lib/media.mjs";

export default async function pose(cfg, { image }) {
  const res = await runTask("02-pose", "images2PosedRGBD", {
    frames: [{ imageAsset: asInput(image) }],
    // Put RGB, depth and intrinsics on the one grid atlasGenerate / atlasMasked /
    // atlasChisel / posedImages2Splats all accept.
    targetResolution: [1280, 720],
  });
  const frame = res.frames[0];
  const rgb = await download(frame.imageAsset, "02/view.img"); // PNG or JPEG, depending on the serving path
  const exr = await download(frame.depth.depthAsset, "02/depth.exr");
  if (frame.depth.confidenceAsset) {
    await writeData("02/confidence.webp", await toWebp(await download(frame.depth.confidenceAsset, "02/confidence.png")));
  }
  const depth = decodeDepth(exr);
  const stats = depthStats(depth);
  await writeData("02/view.webp", await toWebp(rgb));
  await writeData("02/depth.webp", await depthToImage(depth, stats));
  return {
    frame, // { imageAsset, camera, depth } — pass it on untouched
    depth,
    stats,
    view: { image: "02/view.webp", depth: "02/depth.webp", exr: "02/depth.exr", camera: frame.camera },
  };
}
