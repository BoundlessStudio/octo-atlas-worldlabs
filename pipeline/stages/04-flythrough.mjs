// atlasGenerate, again — this time as a camera path. The complete, ordered
// trajectory goes in ONE request so Atlas can keyframe it and keep the frames
// temporally consistent. (Splitting a path into batches causes flicker.)
import { spawnSync } from "node:child_process";
import path from "node:path";
import { DATA, runTask, download, writeData, log } from "../lib/atlas.mjs";
import { place } from "../lib/cameras.mjs";
import { toWebp } from "../lib/media.mjs";
import { contextFrame } from "./03-explore.mjs";
import * as THREE from "three";

export default async function flythrough(cfg, posed, explore) {
  const { frames: n, fps, swing, dolly: [d0, d1], lift } = cfg.flythrough;
  const pivot = new THREE.Vector3(...explore.pivot);
  // A closed loop: swing left/right while walking in and back out.
  const path3d = Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    return place(posed.frame.camera, pivot, {
      orbit: swing * Math.sin(t),
      dolly: d0 + ((d1 - d0) * (1 - Math.cos(t))) / 2,
      lift: lift * Math.sin(t * 2),
    });
  });

  const res = await runTask("04-flythrough", "atlasGenerate", {
    // The source view plus the four widest generated views cover the whole loop.
    contextFrames: [0, 3, 4, 7, 8].map((i) => contextFrame(explore.frames[i])),
    targetCameras: path3d,
    // Reusing promptUsed skips re-captioning the context images: faster, and the
    // scene description cannot drift between requests.
    prompt: explore.promptUsed,
    enhancePrompt: false,
    returnDepth: false, // video only
  }, { timeoutMin: 30 });

  const files = [];
  for (const [i, frame] of res.frames.entries()) {
    const id = String(i).padStart(3, "0");
    await writeData(`04/frame-${id}.webp`, await toWebp(await download(frame.imageAsset, `04/raw/frame-${id}.img`)));
    files.push(`04/frame-${id}.webp`);
  }

  // Optional: an mp4 if ffmpeg is installed. The viewer plays the frames either way.
  const mp4 = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(fps), "-i", path.join(DATA, "04/frame-%03d.webp"),
    "-vf", "scale=1280:720:flags=lanczos", "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", path.join(DATA, "04/flythrough.mp4")]);
  if (mp4.status !== 0) log("04-flythrough", "ffmpeg not found — skipping mp4 (the viewer plays the frame sequence)");

  return { fps, files, video: mp4.status === 0 ? "04/flythrough.mp4" : null, cameras: path3d };
}
