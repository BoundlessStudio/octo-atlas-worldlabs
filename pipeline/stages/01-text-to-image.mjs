// atlasTextToImage — a written description becomes the first view of the world.
import { runTask, download, writeData } from "../lib/atlas.mjs";
import { toWebp } from "../lib/media.mjs";

export default async function textToImage(cfg) {
  const res = await runTask("01-text-to-image", "atlasTextToImage", {
    prompt: cfg.prompt,
    aspectRatio: cfg.aspectRatio,
    seed: cfg.seed, // without a seed the image can never be reproduced
    numSamples: 1, // samples are variations, not views of one scene — one is right
  });
  const image = res.frames[0].imageAsset;
  const png = await download(image, "01/source.png");
  await writeData("01/source.webp", await toWebp(png, 1920));
  return { image, promptUsed: res.promptsUsed?.[0] ?? res.promptUsed, view: { image: "01/source.webp" } };
}
