#!/usr/bin/env node
// The whole Atlas tour, end to end. Safe to interrupt and re-run: finished
// stages are read from runs/state.json, running ones are resumed by operation id.
//
//   npm run pipeline                 run / resume everything
//   npm run pipeline -- --until 4    stop after stage 4
//   npm run pipeline -- --only 5,6   submit just these stages (the rest only read their cache)
//   npm run pipeline -- --redo 5     forget stage 5 and run it again
//   npm run pipeline -- --fresh      forget everything and start over
import { rm } from "node:fs/promises";
import cfg from "../scene.config.mjs";
import { DATA, RUNS, SkipStage, forget, getState, log, policy, writeData } from "./lib/atlas.mjs";

const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const until = Number(flag("--until") ?? 99);
const only = flag("--only")?.split(",").map(Number);
const STAGES = ["01-text-to-image", "02-pose", "03-explore", "04-flythrough", "05-edit", "06-restyle", "07-splat", "08-mesh"];
if (args.includes("--fresh")) {
  await rm(DATA, { recursive: true, force: true });
  await rm(RUNS, { recursive: true, force: true });
}
// --redo 5 forgets a stage (and its uploads/outputs) so it is submitted again.
for (const n of flag("--redo")?.split(",").map(Number) ?? []) {
  await forget(STAGES[n - 1]);
  await rm(`${DATA}/${String(n).padStart(2, "0")}`, { recursive: true, force: true });
}

if (only) policy.allow = new Set(only.map((n) => STAGES[n - 1]));

async function stage(n, file, ...input) {
  if (n > until || !input.every(Boolean)) return null;
  try {
    return await (await import(`./stages/${file}.mjs`)).default(cfg, ...input);
  } catch (err) {
    if (err instanceof SkipStage) return null; // not selected and not cached yet
    throw err;
  }
}

const t2i = await stage(1, "01-text-to-image");
const posed = await stage(2, "02-pose", t2i);
const explore = await stage(3, "03-explore", posed);
const fly = await stage(4, "04-flythrough", posed, explore);
const edit = await stage(5, "05-edit", posed, explore);
const restyle = await stage(6, "06-restyle", posed, explore);
const splat = await stage(7, "07-splat", posed, explore);
const mesh = await stage(8, "08-mesh", splat);
const audit = await stage(9, "09-audit");

// Everything the viewer needs, in one file.
const state = getState();
const ops = Object.entries(state)
  .filter(([, job]) => job?.operationId)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([name, job]) => ({ stage: name, task: job.task, operationId: job.operationId, request: job.request, seconds: job.durationMs && Math.round(job.durationMs / 100) / 10 }));
const pick = (s) => (s ? Object.fromEntries(Object.entries(s).filter(([k]) => !["frame", "frames", "depth", "image"].includes(k))) : null);
await writeData(
  "manifest.json",
  JSON.stringify({ title: cfg.title, generatedAt: new Date().toISOString(), config: cfg, operations: ops,
    textToImage: pick(t2i), pose: pick(posed), explore: pick(explore), flythrough: pick(fly),
    edit: pick(edit), restyle: pick(restyle), splat: pick(splat), mesh: pick(mesh), audit }, null, 2),
);
log("done", `manifest written — \`npm run viewer\` to explore ${cfg.title}`);
