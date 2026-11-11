// Builds the page from viewer/data/manifest.json (written by `npm run pipeline`).
import { Stage, fov } from "./stage.js";

const $ = (sel, root = document) => root.querySelector(sel);
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, "");
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  el.append(...kids.flat().filter((k) => k != null && k !== false));
  return el;
};
const data = (file) => `data/${file}`;
const img = (file, alt = "", lazy = true) => h("img", { src: data(file), alt, loading: lazy ? "lazy" : null });

let m;
try {
  m = await (await fetch("data/manifest.json")).json();
} catch {
  $("#steps").append(h("p", {}, "No data yet — run ", h("code", {}, "npm run pipeline"), " first."));
  throw new Error("manifest missing");
}
document.title = `${m.title} — Atlas World Tour`;
$("#title").textContent = m.title;
const op = (stage) => m.operations.find((o) => o.stage === stage);

// ------------------------------------------------------------- 3D stage ----
const loading = $("#loading"), note = $("#stage-note");
const stage = new Stage($("#gl"), m, {
  loading: (text) => { loading.hidden = !text; loading.textContent = text ?? ""; },
  onPath: (on) => { $("#fly").textContent = on ? "■ Stop" : "▶ Fly the camera path"; },
});
const MODES = [
  ["splat", "Gaussian splat", m.splat && `${(m.splat.splats / 1e6).toFixed(1)}M splats from posedImages2Splats, rendered live with Spark.`],
  ["points", "RGBD point cloud", m.explore && `${m.explore.views.reduce((n, v) => n + v.points, 0).toLocaleString()} points un-projected from ${m.explore.views.length} depth maps — raw API output, no fitting.`],
  ["mesh", "Mesh", m.mesh && `GLB from splats2Mesh (${m.mesh.megabytes} MB) — ready for engines and physics.`],
];
const modes = $("#modes");
const setMode = (name) => {
  for (const b of modes.children) b.setAttribute("aria-selected", b.dataset.mode === name);
  note.textContent = MODES.find((x) => x[0] === name)[2];
  stage.show(name);
};
for (const [name, label, available] of MODES) {
  modes.append(h("button", { role: "tab", "data-mode": name, disabled: !available, onclick: () => setMode(name) }, label));
}
// ?mode=points|mesh picks the first layer (handy on machines without a GPU).
const wanted = new URLSearchParams(location.search).get("mode");
setMode((MODES.find((x) => x[0] === wanted && x[2]) ?? MODES.find((x) => x[2]))[0]);

const toggle = (btn, fn) => btn.addEventListener("click", () => {
  const on = btn.getAttribute("aria-pressed") !== "true";
  btn.setAttribute("aria-pressed", on);
  fn(on);
});
toggle($("#tog-cams"), (on) => (stage.cams.visible = on));
toggle($("#tog-coll"), (on) => stage.toggleColliders(on));
$("#tog-coll").disabled = !m.mesh?.colliders;
$("#home").onclick = () => stage.goTo(stage.home);
$("#fly").disabled = !m.flythrough;
$("#fly").onclick = () => (stage.path ? stage.stopPath() : stage.playPath(m.flythrough.cameras, m.flythrough.fps));
const standAt = (camera) => { stage.goTo(camera); $("#world").scrollIntoView({ block: "center" }); };

// ---------------------------------------------------------------- steps ----
const steps = $("#steps"), chain = $("#chain");
function step(n, id, title, task, blurb, body, stageName) {
  const o = op(stageName);
  chain.append(h("li", {}, h("a", { href: `#${id}` }, task, o?.seconds ? h("small", {}, `${o.seconds}s`) : null)));
  steps.append(h("section", { class: "step", id },
    h("header", {},
      h("div", { class: "num" }, `STEP ${String(n).padStart(2, "0")}`),
      h("h2", {}, title),
      h("p", { class: "task" }, `tasks:${task}`),
      ...blurb,
      o && h("div", { class: "meta" }, h("b", {}, "operation "), o.operationId, h("br"), h("b", {}, "took "), o.seconds ? `${o.seconds}s` : "—"),
      o?.request && h("details", {}, h("summary", {}, "Request body"), h("pre", {}, JSON.stringify(o.request, null, 2))),
    ),
    h("div", { class: "body" }, ...body),
  ));
}
const p = (text) => h("p", {}, text);
const quote = (text) => h("blockquote", {}, text);

function compare(a, b, labelA, labelB) {
  const el = h("div", { class: "frame compare" }, img(a, labelA, false), h("div", { class: "top" }, img(b, labelB, false)),
    h("span", { class: "tag l" }, labelA), h("span", { class: "tag r" }, labelB));
  const move = (e) => {
    const r = el.getBoundingClientRect();
    el.style.setProperty("--x", `${Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100))}%`);
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerdown", move);
  el.swap = (na, nb) => { el.children[0].src = data(na); el.children[1].firstChild.src = data(nb); };
  return el;
}
function picker(pairs, cmp, key = "after") {
  const row = h("div", { class: "thumbs", role: "tablist" });
  pairs.forEach((pair, i) => row.append(h("button", { role: "tab", "aria-selected": i === 0, "aria-label": `View ${i + 1}`,
    onclick: (e) => { for (const b of row.children) b.setAttribute("aria-selected", b === e.currentTarget); cmp.swap(pair.before, pair[key]); } },
    img(pair[key], "", false))));
  return row;
}

// 1 — text to image
if (m.textToImage) {
  step(1, "text-to-image", "A sentence becomes a place", "atlasTextToImage",
    [p("Describe one navigable environment — layout, materials, light, viewpoint — and get a world-ready starting image."), quote(m.config.prompt)],
    [h("div", { class: "frame" }, img(m.textToImage.view.image, "Generated source image")),
     h("p", { class: "caption" }, `seed ${m.config.seed} · ${m.config.aspectRatio} · 2720 × 1536`)],
    "01-text-to-image");
}

// 2 — pose
if (m.pose) {
  const cam = m.pose.view.camera, s = m.pose.stats;
  const shots = [["Colour", m.pose.view.image], ["Depth", m.pose.view.depth], ["Confidence", "02/confidence.webp"]];
  const view = img(shots[0][1], "Posed view");
  const tabs = h("div", { class: "seg tabs", role: "tablist" }, shots.map(([label, file], i) =>
    h("button", { role: "tab", "aria-selected": i === 0, onclick: (e) => { for (const b of tabs.children) b.setAttribute("aria-selected", b === e.currentTarget); view.src = data(file); } }, label)));
  step(2, "pose", "The image gets a camera and depth", "images2PosedRGBD",
    [p("Atlas estimates where the picture was taken from and how far away every pixel is. Colour + camera + depth is a “posed RGBD view” — the currency of every other task."),
     p("The scene comes back gravity-levelled and in approximate metres, so the camera really is standing at eye height in a doorway.")],
    [tabs, h("div", { class: "frame" }, view),
     h("div", { class: "stats", style: "margin-top:12px" },
       h("div", {}, h("b", {}, `${cam.extrinsics.position[1].toFixed(2)} m`), h("span", {}, "eye height")),
       h("div", {}, h("b", {}, `${fov(cam).toFixed(0)}°`), h("span", {}, "vertical FOV")),
       h("div", {}, h("b", {}, `${s.near.toFixed(1)}–${s.far.toFixed(1)} m`), h("span", {}, "depth range")),
       h("div", {}, h("b", {}, `${cam.intrinsics.width}×${cam.intrinsics.height}`), h("span", {}, "pixel grid")))],
    "02-pose");
}

// 3 — explore
if (m.explore) {
  step(3, "explore", "Walk into the picture", "atlasGenerate",
    [p(`From that single view, ${m.explore.views.length - 1} new cameras were placed around the room. Atlas rendered each one — inventing what the original image never showed — and returned depth for every view.`),
     p("Hover a view for its depth map. Click one to stand at that exact camera in the 3D scene above.")],
    [h("div", { class: "grid" }, m.explore.views.map((v, i) =>
      h("button", { class: "tile", onclick: () => standAt(v.camera), "aria-label": `Go to view ${i}` },
        img(v.image, `View ${i}`), h("div", { class: "d" }, img(v.depth, "")), h("span", {}, i ? `view ${String(i).padStart(2, "0")}` : "original")))),
     h("p", { class: "caption" }, "One request · returnDepth: true · every result is a new posed RGBD view")],
    "03-explore");
}

// 4 — flythrough
if (m.flythrough) {
  const f = m.flythrough, canvas = h("canvas", { width: 1280, height: 720, style: "width:100%;display:block" }), ctx = canvas.getContext("2d");
  const frames = f.files.map((file) => Object.assign(new Image(), { src: data(file) }));
  const range = h("input", { type: "range", min: 0, max: frames.length - 1, value: 0, "aria-label": "Frame" });
  const out = h("output", {}, `1 / ${frames.length}`);
  const play = h("button", { "aria-pressed": "false" }, "▶ Play");
  let playing = false, t0 = 0, start = 0;
  const draw = (i) => { if (frames[i].complete) ctx.drawImage(frames[i], 0, 0, 1280, 720); range.value = i; out.textContent = `${i + 1} / ${frames.length}`; };
  frames[0].onload = () => draw(0);
  const tick = (now) => { if (!playing) return; draw((start + Math.floor(((now - t0) / 1000) * f.fps)) % frames.length); requestAnimationFrame(tick); };
  play.onclick = () => {
    playing = !playing;
    play.textContent = playing ? "❚❚ Pause" : "▶ Play";
    play.setAttribute("aria-pressed", playing);
    if (playing) { t0 = performance.now(); start = Number(range.value); requestAnimationFrame(tick); }
  };
  range.oninput = () => { playing && play.click(); draw(Number(range.value)); };
  step(4, "flythrough", "A camera move, frame by frame", "atlasGenerate",
    [p(`A ${frames.length}-camera loop was sent as one ordered path, so Atlas could keyframe it and keep every frame consistent with its neighbours. Nothing here is rendered from 3D — each frame is generated.`),
     p("Press “Fly the camera path” on the 3D scene to ride the same path through the splat.")],
    [h("div", { class: "frame" }, canvas), h("div", { class: "player" }, play, range, out),
     h("p", { class: "caption" }, `${frames.length} frames · ${f.fps} fps · prompt reused from step 3 with enhancePrompt: false`,
       f.video && [" · ", h("a", { href: data(f.video) }, "mp4")])],
    "04-flythrough");
}

// 5 — edit
if (m.edit) {
  const e = m.edit, cmp = compare(e.pairs[0].before, e.pairs[0].after, "before", "after");
  const row = picker(e.pairs, cmp);
  step(5, "edit", "Change one thing, in every view", "atlasMasked",
    [p("A box in world space marks what to replace. It is projected into each posed view to make the masks, so the edit lands in the same 3D spot from every angle."), quote(e.prompt)],
    [cmp, row,
     h("details", {}, h("summary", {}, "Masks sent to the API (pink = regenerate)"), h("div", { class: "grid", style: "margin-top:8px" }, e.pairs.map((x) => h("div", { class: "frame" }, img(x.mask, "Mask overlay")))))],
    "05-edit");
}

// 6 — restyle
if (m.restyle) {
  const r = m.restyle, cmp = compare(r.pairs[0].before, r.pairs[0].after, "original", "restyled");
  step(6, "restyle", "Same geometry, new world", "atlasChisel",
    [p("Chisel was given only cameras and depth maps — no colour at all — plus a new description. The room's shape is preserved; everything else is reimagined. The same task turns grey-box blockouts into finished scenes."), quote(r.prompt)],
    [cmp, picker(r.pairs, cmp),
     h("details", {}, h("summary", {}, "The only inputs: depth"), h("div", { class: "grid", style: "margin-top:8px" }, r.pairs.map((x) => h("div", { class: "frame" }, img(x.depth, "Depth input")))))],
    "06-restyle");
}

// 7 — splat
if (m.splat) {
  step(7, "splat", "Views fuse into a 3D scene", "posedImages2Splats",
    [p(`All ${m.splat.views} posed RGBD views were reconstructed and refined into a single Gaussian splat — the scene you were orbiting at the top of this page.`)],
    [h("div", { class: "stats" },
       h("div", {}, h("b", {}, `${(m.splat.splats / 1e6).toFixed(2)}M`), h("span", {}, "splats")),
       h("div", {}, h("b", {}, m.splat.views), h("span", {}, "input views")),
       h("div", {}, h("b", {}, `${m.splat.megabytes} MB`), h("span", {}, ".spz file"))),
     h("p", { class: "caption" }, h("a", { href: data(m.splat.file), download: true }, "Download scene.spz"), " · open it in Spark, Blender or any SPZ viewer")],
    "07-splat");
}

// 8 — mesh
if (m.mesh) {
  step(8, "mesh", "A mesh for engines and physics", "splats2Mesh",
    [p("The splat is converted to a textured GLB with upright box colliders. Switch the 3D scene to “Mesh” and turn on “Colliders” to see them.")],
    [h("div", { class: "stats" },
       h("div", {}, h("b", {}, `${m.mesh.megabytes} MB`), h("span", {}, "textured GLB")),
       h("div", {}, h("b", {}, m.config.mesh.targetFaces.toLocaleString()), h("span", {}, "face budget")),
       h("div", {}, h("b", {}, m.config.mesh.textureSize), h("span", {}, "texture px"))),
     h("p", { class: "caption" }, h("a", { href: data(m.mesh.file), download: true }, "Download mesh.glb"),
       m.mesh.colliders && [" · ", h("a", { href: data(m.mesh.colliders), download: true }, "colliders.glb")])],
    "08-mesh");
}

// 9 — operations
{
  const total = m.operations.reduce((s, o) => s + (o.seconds ?? 0), 0);
  steps.append(h("section", { class: "step", id: "operations" },
    h("header", {}, h("div", { class: "num" }, "LEDGER"), h("h2", {}, "Every job is an operation"),
      p("Each task returns a long-running operation. The pipeline stores its idempotency key and id before waiting, so it can crash, resume, and never bill the same work twice."),
      m.audit && p(`The project now holds ${m.audit.assetCount}${m.audit.assetsHaveMore ? "+" : ""} assets; any operation can be replayed with :trace.`)),
    h("div", { class: "body" },
      h("div", { class: "table" }, h("table", {},
        h("thead", {}, h("tr", {}, ["Stage", "Task", "Operation", "Seconds"].map((t) => h("th", {}, t)))),
        h("tbody", {}, m.operations.map((o) => h("tr", {}, h("td", {}, o.stage), h("td", {}, o.task), h("td", {}, o.operationId), h("td", { class: "n" }, o.seconds ?? "—"))),
          h("tr", {}, h("td", { colspan: 3 }, "Total model time"), h("td", { class: "n" }, `${(total / 60).toFixed(1)} min`))))))));
}
