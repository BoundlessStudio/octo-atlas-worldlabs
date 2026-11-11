// Pixels: EXR depth decoding, depth visualisation, masks, web-friendly copies.
import sharp from "sharp";
import { FloatType, RedFormat } from "three";
import { EXRLoader } from "three/examples/jsm/loaders/EXRLoader.js";

/**
 * Decode an Atlas linear-depth EXR to a top-down Float32Array.
 * Three's EXRLoader hands rows back bottom-up; Atlas cameras, RGB and confidence
 * maps are top-down, so flip once here and never think about it again.
 */
export function decodeDepth(bytes) {
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const exr = new EXRLoader().setDataType(FloatType).setOutputFormat(RedFormat).parse(ab);
  const { width, height, data } = exr;
  const depth = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    depth.set(data.subarray((height - 1 - y) * width, (height - y) * width), y * width);
  }
  return { width, height, depth };
}

/** Robust near / median / far of the valid (finite, positive) depth values. */
export function depthStats({ depth }) {
  const valid = Array.from(depth).filter((z) => Number.isFinite(z) && z > 0).sort((a, b) => a - b);
  const q = (t) => valid[Math.min(valid.length - 1, Math.floor(t * valid.length))];
  return { near: q(0.02), median: q(0.5), far: q(0.98), validFraction: valid.length / depth.length };
}

// Compact "turbo"-like ramp: near = warm, far = cool, missing = black.
const RAMP = [[255, 244, 196], [253, 186, 92], [240, 106, 74], [182, 54, 121], [103, 32, 141], [38, 22, 92], [8, 8, 30]];
export async function depthToImage({ width, height, depth }, { near, far }) {
  const rgb = Buffer.alloc(width * height * 3);
  const lo = Math.log(near), span = Math.log(far) - lo;
  for (let i = 0; i < depth.length; i++) {
    const z = depth[i];
    if (!Number.isFinite(z) || z <= 0) continue;
    const t = Math.min(0.9999, Math.max(0, (Math.log(z) - lo) / span)) * (RAMP.length - 1);
    const a = RAMP[Math.floor(t)], b = RAMP[Math.floor(t) + 1], f = t - Math.floor(t);
    for (let c = 0; c < 3; c++) rgb[i * 3 + c] = a[c] + (b[c] - a[c]) * f;
  }
  return sharp(rgb, { raw: { width, height, channels: 3 } }).webp({ quality: 88 }).toBuffer();
}

/**
 * atlasMasked keep-mask: 8-bit *single channel* PNG, white = keep, black = regenerate.
 * (RGB/RGBA masks are rejected even when they look grey.) `discs` are {x, y, r} in pixels.
 */
export async function keepMask(width, height, discs) {
  const gray = Buffer.alloc(width * height, 255);
  for (const { x, y, r } of discs) {
    for (let py = Math.max(0, Math.floor(y - r)); py <= Math.min(height - 1, y + r); py++) {
      for (let px = Math.max(0, Math.floor(x - r)); px <= Math.min(width - 1, x + r); px++) {
        if (Math.hypot(px - x, py - y) <= r) gray[py * width + px] = 0;
      }
    }
  }
  // A light blur gives the soft transition the model blends across.
  return sharp(gray, { raw: { width, height, channels: 1 } }).blur(4).toColourspace("b-w").png().toBuffer();
}

/** Tint the black (edited) area of a mask over its image, for humans to check. */
export async function maskOverlay(imageBytes, maskBytes) {
  const { data, info } = await sharp(maskBytes).extractChannel(0).negate().raw().toBuffer({ resolveWithObject: true });
  const rgba = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0; i < data.length; i++) rgba.set([255, 64, 160, data[i] * 0.55], i * 4);
  return sharp(imageBytes).resize(info.width, info.height)
    .composite([{ input: rgba, raw: { width: info.width, height: info.height, channels: 4 } }]).webp({ quality: 86 }).toBuffer();
}

/** Small copy for the web viewer. */
export const toWebp = (bytes, width = 1280) =>
  sharp(bytes).resize({ width, withoutEnlargement: true }).webp({ quality: 86 }).toBuffer();

export const rawRgb = async (bytes, width, height) =>
  sharp(bytes).resize(width, height, { fit: "fill" }).removeAlpha().raw().toBuffer();
