// atlasChisel — depth-guided generation. Send only cameras + depth (no RGB at all)
// and a new prompt: the room keeps its exact geometry and gets a completely new look.
// The same task turns grey-box blockouts from Blender/Unity into finished scenes.
import { runTask, download, writeData, asInput } from "../lib/atlas.mjs";
import { toWebp } from "../lib/media.mjs";

export default async function restyle(cfg, posed, explore) {
  // The original view plus the three generated views with the most complete depth
  // (NaN depth means "no surface here", which Chisel is free to reinvent).
  const best = explore.views.map((v, i) => ({ i, valid: v.validDepth })).slice(1)
    .sort((a, b) => b.valid - a.valid).slice(0, 3).map((v) => v.i).sort((a, b) => a - b);
  const picks = [0, ...best];

  const res = await runTask("06-restyle", "atlasChisel", {
    targetFrames: picks.map((i) => ({
      camera: explore.frames[i].camera, // must be 1280 × 720
      depth: { depthAsset: asInput(explore.frames[i].depth.depthAsset) }, // no confidenceAsset: Chisel rejects it
    })),
    // No imageAsset and no contextFrames — either would pull the result back to the old look.
    prompt: cfg.restyle.prompt,
    modelParameters: { seed: cfg.seed },
    returnDepth: false,
  });

  const pairs = [];
  for (const [n, frame] of res.frames.entries()) {
    const id = String(picks[n]).padStart(2, "0");
    await writeData(`06/restyle-${id}.webp`, await toWebp(await download(frame.imageAsset, `06/raw-${n}.img`)));
    pairs.push({ before: explore.views[picks[n]].image, depth: explore.views[picks[n]].depth, after: `06/restyle-${id}.webp` });
  }
  return { prompt: cfg.restyle.prompt, promptUsed: res.promptUsed, pairs };
}
