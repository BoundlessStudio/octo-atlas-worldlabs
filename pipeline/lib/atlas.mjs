// Thin, resumable wrapper around the official client.
//
// Every stage is one durable job: the request, its idempotency key and the
// operation id are written to runs/state.json *before* we wait, so a crash,
// Ctrl-C or timeout never submits (or bills) the same work twice.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assetRef, createClient } from "@worldlabsai/client";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const RUNS = path.join(ROOT, "runs");
export const DATA = path.join(ROOT, "viewer", "data");
const STATE_FILE = path.join(RUNS, "state.json");
const API = "https://api.atlas.worldlabs.ai/api/v2";

const apiKey = process.env.WLT_API_KEY;
if (!apiKey) {
  console.error("Set WLT_API_KEY (copy .env.example to .env, then use `npm run pipeline`).");
  process.exit(1);
}
export const wl = createClient({ apiKey, userAgent: "octo-atlas-demo/1.0" });
export { assetRef };

// ---------------------------------------------------------------- state ----
// Always re-read before writing, so two pipeline processes (say, a 15-minute
// splat and a re-run of the edit) can share runs/state.json safely.
const readState = async () => (existsSync(STATE_FILE) ? JSON.parse(await readFile(STATE_FILE, "utf8")) : {});
let state = await readState();
export const getState = () => state;
async function patchState(mutate) {
  state = await readState();
  mutate(state);
  await mkdir(RUNS, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}
export const forget = (...stages) =>
  patchState((s) => {
    for (const name of stages) {
      delete s[name];
      for (const key of Object.keys(s.uploads ?? {})) if (key.startsWith(`${name}/`)) delete s.uploads[key];
    }
  });

// ----------------------------------------------------------------- tasks ----
/** `--only` support: stages outside the allow-list may read their cache but never submit. */
export class SkipStage extends Error {}
export const policy = { allow: null };
const assertAllowed = (stage) => {
  if (policy.allow && !policy.allow.has(stage)) throw new SkipStage(stage);
};

const fmt = (ms) => (ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${(ms / 60_000).toFixed(1)}min`);
export const log = (stage, ...msg) => console.log(`\x1b[36m[${stage}]\x1b[0m`, ...msg);

/**
 * Submit `task` once and wait for it. Re-running resumes instead of resubmitting.
 * Returns operation.response.
 */
export async function runTask(stage, task, request, { timeoutMin = 15 } = {}) {
  let job = state[stage];
  if (job?.response) {
    log(stage, `cached (${task}, op ${job.operationId})`);
    return job.response;
  }
  assertAllowed(stage);
  const save = () => patchState((s) => (s[stage] = job));
  if (!job?.operationId) {
    job = { task, request, idempotencyKey: `atlas-demo-${stage}-${randomUUID()}`, submittedAt: Date.now() };
    await save(); // persist the key before the network call
    const op = await wl.tasks[task](request, { idempotencyKey: job.idempotencyKey });
    job.operationId = op.id;
    await save();
    log(stage, `submitted ${task} → operation ${op.id}`);
  } else {
    log(stage, `resuming operation ${job.operationId}`);
  }

  // Long-poll with :wait (bounded server-side), fall back to plain polling on hiccups.
  const deadline = Date.now() + timeoutMin * 60_000;
  let op, lastLine = "", lastLog = Date.now();
  for (;;) {
    try {
      op = await api("POST", `/operations/${job.operationId}:wait`, { timeoutSecs: 30 });
    } catch (err) {
      if (err.status && ![404, 408, 429, 500, 502, 503, 504].includes(err.status)) throw err;
      await new Promise((r) => setTimeout(r, 3000 + Math.random() * 2000));
      op = await wl.operations.get(job.operationId).catch(() => ({ done: false }));
    }
    if (op.done) break;
    const m = op.metadata ?? {};
    const line = [m.state, m.phase, m.progressPercent != null && `${m.progressPercent}%`].filter(Boolean).join(" · ");
    if (line && (line !== lastLine || Date.now() - lastLog > 120_000)) {
      log(stage, `  ${line}  (${fmt(Date.now() - job.submittedAt)})`);
      lastLog = Date.now();
    }
    lastLine = line;
    if (Date.now() > deadline) {
      throw new Error(`${stage}: still running after ${timeoutMin} min — rerun to resume operation ${job.operationId}`);
    }
  }
  if (op.error) {
    await forget(stage); // failed runs are free; allow a clean retry
    throw new Error(`${stage} (${task}) failed: ${JSON.stringify(op.error)}`);
  }
  job.response = op.response;
  job.durationMs = Date.now() - job.submittedAt;
  await save();
  log(stage, `done in ${fmt(job.durationMs)}`);
  return job.response;
}

/** Raw Developer API call for routes the typed client does not wrap (list, trace, :wait…). */
export async function api(method, route, body) {
  const res = await fetch(API + route, {
    method,
    headers: { "WLT-Api-Key": apiKey, ...(body && { "Content-Type": "application/json" }) },
    body: body && JSON.stringify(body),
  });
  if (!res.ok) throw Object.assign(new Error(`${method} ${route} → HTTP ${res.status}: ${await res.text()}`), { status: res.status });
  return res.json();
}

// ---------------------------------------------------------------- assets ----
/** Download a task output. Signed URLs expire, so fall back to a fresh read URL. */
export async function download(asset, file) {
  const dest = path.join(DATA, file);
  if (existsSync(dest)) return readFile(dest);
  await mkdir(path.dirname(dest), { recursive: true });
  let res = asset.url ? await fetch(asset.url).catch(() => null) : null;
  if (!res?.ok && asset.assetId) {
    const { readUrl } = await wl.assets.createReadUrl(asset.assetId);
    res = await fetch(readUrl);
  }
  if (!res?.ok) throw new Error(`Could not download ${file} (HTTP ${res?.status})`);
  const bytes = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, bytes);
  return bytes;
}

export async function writeData(file, bytes) {
  const dest = path.join(DATA, file);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, bytes);
}

/** Upload local bytes as a project asset and return a `{ assetId }` task input. */
export async function upload(stage, name, bytes, mimeType) {
  const cached = state.uploads?.[`${stage}/${name}`];
  if (cached) return cached;
  if (!state[stage]?.response) assertAllowed(stage);
  const asset = await wl.assets.upload(bytes, { displayName: name, mimeType });
  const ref = assetRef(asset);
  await patchState((s) => (s.uploads = { ...s.uploads, [`${stage}/${name}`]: ref }));
  return ref;
}

/** Strip a response frame down to what the next task accepts as input. */
export const asInput = ({ assetId }) => ({ assetId });
