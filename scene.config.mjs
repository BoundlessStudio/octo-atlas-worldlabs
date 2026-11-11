// Everything creative about the demo lives here. Change it, delete `runs/`
// (or run `npm run pipeline -- --fresh`), and the whole world is rebuilt.
export default {
  title: "The Cartographer's Study",

  // 1. atlasTextToImage — describe one navigable place: layout, materials, light, viewpoint.
  prompt:
    "Interior of an old cartographer's study, wide eye-level view from the doorway. " +
    "Floor-to-ceiling walnut bookshelves line the left and right walls, a heavy oak desk " +
    "covered in rolled maps and brass instruments stands in the middle of the room on a " +
    "worn persian rug, a large antique globe on a stand to the right of the desk, a stone " +
    "fireplace with glowing embers on the back wall, herringbone wood floor, warm lamp " +
    "light with soft late-afternoon haze, richly detailed, photorealistic, no people",
  aspectRatio: "16:9",
  seed: 7,

  // 3. atlasGenerate — where to stand next. The pivot is the pixel (u, v) of the first
  //    view everything looks at; it is un-projected through the depth map into 3D.
  //    orbit = degrees around the pivot, dolly = fraction of the way toward it,
  //    lift = metres above eye height, pan = degrees to look away from the pivot.
  pivot: { u: 0.5, v: 0.58 },
  explore: [
    { orbit: -12, dolly: 0.12 },
    { orbit: 12, dolly: 0.12 },
    { orbit: -24, dolly: 0.22 },
    { orbit: 24, dolly: 0.22 },
    { orbit: 0, dolly: 0.25, lift: 0.4 },
    { orbit: 0, dolly: 0.2, lift: -0.4 },
    { orbit: -36, dolly: 0.3 },
    { orbit: 36, dolly: 0.3 },
    { orbit: -10, dolly: 0.3, pan: -32 },
    { orbit: 10, dolly: 0.3, pan: 32 },
    { orbit: -50, dolly: 0.38, lift: 0.2 },
    { orbit: 50, dolly: 0.38, lift: 0.2 },
  ],

  // 4. atlasGenerate camera path — one closed loop, submitted as a single request.
  flythrough: { frames: 96, fps: 24, swing: 20, dolly: [0.1, 0.4], lift: 0.12 },

  // 5. atlasMasked — the edit region is a box in world space, so the masks of every
  //    view agree in 3D. Its centre is found by un-projecting pixel (u, v) of the first
  //    view; sizes are metres. Posed scenes are gravity-levelled with the floor near y = 0.
  edit: {
    anchor: { u: 0.48, v: 0.58 },
    width: 1.9,
    depth: 1.25,
    heights: [0.06, 1.35],
    views: [0, 3, 4, 5], // 0 = the original image, 1.. = explore views
    prompt:
      "Replace the oak desk in the middle of the room with a glowing holographic " +
      "star-map table: a low round black glass plinth standing on the persian rug, " +
      "projecting a translucent blue 3D constellation of stars and orbit lines above it. " +
      "Remove the maps, lamp and brass instruments that were on the desk.",
  },

  // 6. atlasChisel — same geometry (depth only, no RGB), completely new look.
  restyle: {
    prompt:
      "The same room reclaimed by nature: an abandoned overgrown study, shelves and desk " +
      "wrapped in moss and ivy, ferns growing through the broken herringbone floor, shafts " +
      "of cool morning light through a collapsed ceiling, mist, emerald and teal palette, " +
      "photorealistic",
  },

  // 7/8. posedImages2Splats is the expensive step: refined = 5,000 credits, draft = 500.
  splat: { refine: true },
  mesh: { textureMode: "image_texture", textureSize: 2048, targetFaces: 400000, colliders: 200 },
};
