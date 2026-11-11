#!/usr/bin/env node
// Zero-dependency static server for the viewer. Serves viewer/ at / and the
// project's node_modules at /node_modules so the page can import three + Spark
// straight from the installed packages (no bundler, no CDN).
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VIEWER = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(VIEWER, "..");
const PORT = Number(process.env.PORT ?? 5173);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".mp4": "video/mp4", ".glb": "model/gltf-binary",
  ".wasm": "application/wasm", ".exr": "image/x-exr", ".spz": "application/octet-stream", ".bin": "application/octet-stream" };

createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const base = url.startsWith("/node_modules/") ? ROOT : VIEWER;
  const file = path.join(base, url.endsWith("/") ? url + "index.html" : url);
  let stat;
  try {
    if (!file.startsWith(base)) throw new Error("outside root");
    stat = statSync(file);
    if (!stat.isFile()) throw new Error("not a file");
  } catch {
    res.writeHead(404).end("Not found");
    return;
  }
  const headers = { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream", "Accept-Ranges": "bytes", "Cache-Control": "no-cache" };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (range) { // video seeking
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
    res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${stat.size}`, "Content-Length": end - start + 1 });
    createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { ...headers, "Content-Length": stat.size });
    createReadStream(file).pipe(res);
  }
}).listen(PORT, () => console.log(`Atlas demo viewer → http://localhost:${PORT}`));
