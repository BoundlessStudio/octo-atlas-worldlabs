// splats2Mesh — turn the splat into a textured GLB mesh plus box colliders,
// ready for a game engine, physics, or a DCC tool.
import { runTask, download, asInput } from "../lib/atlas.mjs";

export default async function mesh(cfg, splat) {
  const { textureMode, textureSize, targetFaces, colliders } = cfg.mesh;
  const res = await runTask("08-mesh", "splats2Mesh", {
    splatAsset: asInput(splat.asset),
    textureMode, // image_texture | vertex_color | none
    textureSize,
    targetFaces,
    colliderBoxes: { targetBoxes: colliders }, // second GLB: one upright box per node
  }, { timeoutMin: 45 });

  const glb = await download(res.mesh, "08/mesh.glb");
  if (res.colliderBoxes) await download(res.colliderBoxes, "08/colliders.glb");
  return {
    file: "08/mesh.glb",
    colliders: res.colliderBoxes ? "08/colliders.glb" : null,
    megabytes: +(glb.length / 1e6).toFixed(1),
    anchors: res.anchorPositions?.length ?? 0,
    metadata: res.metadata,
  };
}
