// Camera maths for Atlas. Everything is camera-to-world, RUB (right, up, back —
// the camera looks down its local -Z, exactly like Three.js), XYZW quaternions.
import * as THREE from "three";

const UP = new THREE.Vector3(0, 1, 0);

export const position = (cam) => new THREE.Vector3(...cam.extrinsics.position);
export const quaternion = (cam) => new THREE.Quaternion(...cam.extrinsics.quaternion);
export const forward = (cam) => new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion(cam));
export const right = (cam) => new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion(cam));

/** A new camera with the same lens as `base`, standing at `eye` and looking at `target`. */
export function lookAt(base, eye, target) {
  const m = new THREE.Matrix4().lookAt(eye, target, UP); // Three's lookAt is RUB already
  const q = new THREE.Quaternion().setFromRotationMatrix(m);
  return {
    intrinsics: { ...base.intrinsics },
    extrinsics: { position: eye.toArray(), quaternion: [q.x, q.y, q.z, q.w], coordinateSystem: "rub" },
  };
}

/**
 * Orbit `base` around `pivot` by `degrees` about the world up axis, optionally
 * walking toward the pivot (`dolly`, 0..1 of the horizontal distance) and
 * changing eye height (`lift`, world units). The camera keeps looking at the pivot.
 */
export function orbit(base, pivot, degrees, { dolly = 0, lift = 0 } = {}) {
  const offset = position(base).sub(pivot);
  const height = offset.y;
  offset.setY(0).multiplyScalar(1 - dolly).applyAxisAngle(UP, THREE.MathUtils.degToRad(degrees));
  const eye = pivot.clone().add(offset).add(new THREE.Vector3(0, height + lift, 0));
  return lookAt(base, eye, pivot);
}

/** Pixel (x, y from the top-left) + planar depth z → world point. */
export function unproject(cam, x, y, z) {
  const { fx, fy, cx, cy } = cam.intrinsics;
  // RUB camera space: +x right, +y up, the camera looks along -z.
  const p = new THREE.Vector3(((x - cx) / fx) * z, -((y - cy) / fy) * z, -z);
  return p.applyQuaternion(quaternion(cam)).add(position(cam));
}

/** World point → { x, y, z } in pixels and planar depth; z <= 0 is behind the camera. */
export function project(cam, world) {
  const { fx, fy, cx, cy } = cam.intrinsics;
  const p = world.clone().sub(position(cam)).applyQuaternion(quaternion(cam).invert());
  const z = -p.z;
  return { x: cx + (fx * p.x) / z, y: cy - (fy * p.y) / z, z };
}

export const fovDegrees = (cam) =>
  THREE.MathUtils.radToDeg(2 * Math.atan(cam.intrinsics.height / (2 * cam.intrinsics.fy)));

/** One of the `explore` entries from scene.config.mjs → a camera. */
export function place(base, pivot, { orbit: deg = 0, dolly = 0, lift = 0, pan = 0 }) {
  const cam = orbit(base, pivot, deg, { dolly, lift });
  if (!pan) return cam;
  const eye = position(cam);
  const target = pivot.clone().sub(eye).applyAxisAngle(UP, THREE.MathUtils.degToRad(-pan)).add(eye);
  return lookAt(base, eye, target);
}
