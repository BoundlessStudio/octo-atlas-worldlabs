// posedImages2Splats — fuse the posed RGBD views into one explorable 3D scene:
// a Gaussian splat (.spz) you can fly through in real time.
// Refined runs take 10–20 minutes, so this stage is built to be resumed.
import { runTask, download } from "../lib/atlas.mjs";
import { contextFrame } from "./03-explore.mjs";

export default async function splat(cfg, posed, explore) {
  const res = await runTask("07-splat", "posedImages2Splats", {
    // Original view + all generated views; every frame is { imageAsset, camera, depth }.
    posedFrames: explore.frames.map(contextFrame),
    prompt: explore.promptUsed,
    enhancePrompt: false,
    ...(cfg.splat.refine ? {} : { refine: false }), // draft: 10× cheaper, lower fidelity
  }, { timeoutMin: 60 });

  // refinedSplats maps splat count → SPZ asset. Take the densest.
  const [count, asset] = Object.entries(res.refinedSplats).sort((a, b) => Number(b[0]) - Number(a[0]))[0];
  const bytes = await download(asset, "07/scene.spz");
  return { asset, file: "07/scene.spz", splats: Number(count), megabytes: +(bytes.length / 1e6).toFixed(1), views: explore.frames.length };
}
