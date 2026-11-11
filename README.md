# octo-atlas-worldlabs

An end-to-end tour of the [World Labs Atlas Developer API](https://docs.atlas.worldlabs.ai/quickstart).
One sentence of text goes in; an explorable 3D world comes out, and every Atlas task is used on the way.

```
atlasTextToImage ─▶ images2PosedRGBD ─▶ atlasGenerate ─┬─▶ atlasGenerate (camera path)
   a sentence          camera + depth     12 new views  ├─▶ atlasMasked   (multi-view edit)
                                                        ├─▶ atlasChisel   (depth-only restyle)
                                                        └─▶ posedImages2Splats ─▶ splats2Mesh
                                                              Gaussian splat        GLB + colliders
```

The repository ships with a finished run — *The Cartographer's Study* — so the viewer works straight away.

## Run it

```bash
npm install
npm run viewer            # http://localhost:5173
```

The viewer is a single page: a live 3D scene (Gaussian splat, fused RGBD point cloud, mesh, colliders
and every camera Atlas rendered from) followed by one section per task with its inputs, outputs,
request body and operation id.

## Build your own world

```bash
cp .env.example .env      # paste your Atlas API key
# edit scene.config.mjs   # prompt, cameras, edit, restyle
npm run pipeline -- --fresh
```

| Flag | Effect |
| --- | --- |
| *(none)* | Run or resume everything. Finished stages are skipped. |
| `--until 4` | Stop after stage 4 (cheap way to check the look before the splat). |
| `--only 5,6` | Submit only these stages; the others just read their cache. |
| `--redo 5` | Forget stage 5 and run it again (e.g. after changing the edit prompt). |
| `--fresh` | Delete `runs/` and `viewer/data/` and start over. |

The API key needs `tasks.create`, `operations.read`, `assets.create` and `assets.read`.

**Cost.** A refined splat is 5,000 credits ($5) per successful run; set `splat.refine: false` in
`scene.config.mjs` for a 500-credit draft. Check the rate card in the Atlas platform for the other tasks.
`--until 6` runs everything except the splat and mesh.

## What each stage shows

| # | Task | File | Worth reading for |
| --- | --- | --- | --- |
| 1 | `atlasTextToImage` | `pipeline/stages/01-text-to-image.mjs` | Seeds, aspect ratios, world-style prompting |
| 2 | `images2PosedRGBD` | `02-pose.mjs` | `targetResolution`, linear-depth EXR decoding, confidence |
| 3 | `atlasGenerate` | `03-explore.mjs` | Placing target cameras, `returnDepth`, un-projecting depth to a point cloud |
| 4 | `atlasGenerate` | `04-flythrough.mjs` | A whole camera path in one request, reusing `promptUsed` |
| 5 | `atlasMasked` | `05-edit.mjs` | Asset uploads, keep-masks, projecting one 3D region into many views |
| 6 | `atlasChisel` | `06-restyle.mjs` | Depth-only target frames: same geometry, new look |
| 7 | `posedImages2Splats` | `07-splat.mjs` | Long-running operations, SPZ output |
| 8 | `splats2Mesh` | `08-mesh.mjs` | Textured GLB, face budget, collider boxes |
| 9 | operations & assets | `09-audit.mjs` | Listing operations, `:trace`, listing assets |

Shared code:

- `pipeline/lib/atlas.mjs` — the official `@worldlabsai/client` plus a resumable job runner. Each stage's
  idempotency key and operation id are saved to `runs/state.json` before waiting, so an interrupted run
  resumes instead of resubmitting (and re-billing).
- `pipeline/lib/cameras.mjs` — Atlas camera maths: camera-to-world, RUB, XYZW quaternions, orbit / look-at,
  project and un-project.
- `pipeline/lib/media.mjs` — EXR depth decoding (with the top-down row flip), depth visualisation, masks.
- `viewer/stage.js` — Three.js + [Spark](https://sparkjs.dev) scene. Atlas cameras drop straight into
  Three.js with no conversion.

## Notes from building it

- Outputs named `.png` by habit may be JPEG; the fast serving path returns JPEG frames. Sniff, don't assume.
- Depth from `atlasGenerate` contains `NaN` where the floater cleanup rejected a pixel. Skip those; never
  treat them as zero.
- `atlasMasked` wants a single-channel 8-bit PNG mask (white = keep). RGB masks are rejected.
- `atlasChisel` rejects `depth.confidenceAsset`; send `depthAsset` only.
- `atlasMasked` was by far the slowest image task (minutes, not seconds).
