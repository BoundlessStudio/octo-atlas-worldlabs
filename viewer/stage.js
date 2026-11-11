// The 3D stage: one Three.js scene that can show the Gaussian splat (Spark),
// the fused RGBD point cloud, the extracted mesh, its colliders and every
// camera Atlas rendered from — all in the same world frame, straight from the API.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";

const BRASS = 0xe0a94a, TEAL = 0x62d6c6, ROSE = 0xff5fa8;

export class Stage {
  constructor(canvas, manifest, ui) {
    this.m = manifest;
    this.ui = ui;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05070b);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 2.2));
    this.scene.add(new SparkRenderer({ renderer: this.renderer }));

    this.home = manifest.pose.view.camera;
    this.pivot = new THREE.Vector3(...(manifest.explore?.pivot ?? [0, 1, -3]));
    this.camera = new THREE.PerspectiveCamera(fov(this.home), 16 / 9, 0.05, 200);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.pose(this.home);

    this.layers = {}; // name → Object3D (lazy)
    this.cams = this.buildCameras();
    this.scene.add(this.cams);

    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.renderer.domElement;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  frame() {
    const now = performance.now();
    if (this.tween) {
      const t = Math.min(1, (now - this.tween.t0) / this.tween.ms), e = t * t * (3 - 2 * t);
      this.camera.position.lerpVectors(this.tween.p0, this.tween.p1, e);
      this.camera.quaternion.slerpQuaternions(this.tween.q0, this.tween.q1, e);
      if (t === 1) { this.retarget(); this.tween = null; }
    } else if (this.path) {
      const f = ((now - this.path.t0) / 1000) * this.path.fps;
      const cams = this.path.cameras, i = Math.floor(f) % cams.length, j = (i + 1) % cams.length;
      if (f >= cams.length * this.path.loops) { this.stopPath(); }
      else {
        const a = cams[i].extrinsics, b = cams[j].extrinsics, u = f % 1;
        this.camera.position.fromArray(a.position).lerp(new THREE.Vector3(...b.position), u);
        this.camera.quaternion.fromArray(a.quaternion).slerp(new THREE.Quaternion(...b.quaternion), u);
      }
    } else {
      this.controls.update();
    }
    this.renderer.render(this.scene, this.camera);
  }

  // ---- cameras -----------------------------------------------------------
  /** Atlas cameras are camera-to-world, RUB, XYZW — exactly Three.js. No conversion. */
  pose(cam) {
    this.camera.position.fromArray(cam.extrinsics.position);
    this.camera.quaternion.fromArray(cam.extrinsics.quaternion);
    this.retarget();
  }
  retarget() {
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const dist = Math.max(0.6, this.pivot.clone().sub(this.camera.position).dot(dir));
    this.controls.target.copy(this.camera.position).addScaledVector(dir, dist);
  }
  goTo(cam, ms = 900) {
    this.stopPath();
    this.tween = { t0: performance.now(), ms, p0: this.camera.position.clone(), q0: this.camera.quaternion.clone(),
      p1: new THREE.Vector3(...cam.extrinsics.position), q1: new THREE.Quaternion(...cam.extrinsics.quaternion) };
  }
  playPath(cameras, fps, loops = 2) {
    this.tween = null;
    this.controls.enabled = false;
    this.path = { cameras, fps, loops, t0: performance.now() };
    this.ui.onPath?.(true);
  }
  stopPath() {
    if (!this.path) return;
    this.path = null;
    this.controls.enabled = true;
    this.retarget();
    this.ui.onPath?.(false);
  }

  buildCameras() {
    const group = new THREE.Group();
    const frustum = (cam, color, size) => {
      const { fx, fy, width, height } = cam.intrinsics, x = (width / 2 / fx) * size, y = (height / 2 / fy) * size;
      const c = [[-x, y, -size], [x, y, -size], [x, -y, -size], [-x, -y, -size]], o = [0, 0, 0];
      const pts = [o, c[0], o, c[1], o, c[2], o, c[3], c[0], c[1], c[1], c[2], c[2], c[3], c[3], c[0]].flat();
      const g = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      const line = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false }));
      line.position.fromArray(cam.extrinsics.position);
      line.quaternion.fromArray(cam.extrinsics.quaternion);
      line.renderOrder = 10;
      return line;
    };
    (this.m.explore?.views ?? [this.m.pose.view]).forEach((v, i) => group.add(frustum(v.camera, i ? TEAL : BRASS, i ? 0.16 : 0.24)));
    const path = this.m.flythrough?.cameras;
    if (path) {
      const pts = path.map((c) => new THREE.Vector3(...c.extrinsics.position));
      group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: ROSE, depthTest: false, transparent: true, opacity: 0.9 })));
    }
    return group;
  }

  // ---- layers ------------------------------------------------------------
  async show(mode) {
    this.mode = mode;
    for (const [name, obj] of Object.entries(this.layers)) if (name !== "colliders") obj.visible = name === mode;
    if (!this.layers[mode]) {
      this.ui.loading(`loading ${mode}…`);
      try {
        const obj = await this[`load_${mode}`]();
        this.layers[mode] = obj;
        obj.visible = this.mode === mode;
        this.scene.add(obj);
      } catch (err) {
        console.error(err);
        this.ui.loading(`could not load ${mode}: ${err.message}`);
        return;
      }
      this.ui.loading(null);
    }
  }

  async load_splat() {
    const mesh = new SplatMesh({ url: `data/${this.m.splat.file}` });
    await mesh.initialized;
    return mesh;
  }

  async load_points() {
    // 16-byte records written by pipeline/stages/03-explore.mjs: float32 xyz + uint8 rgba.
    const buf = await (await fetch(`data/${this.m.explore.points}`)).arrayBuffer();
    const n = buf.byteLength / 16, f = new Float32Array(buf), u = new Uint8Array(buf);
    const pos = new Float32Array(n * 3), col = new Uint8Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos.set(f.subarray(i * 4, i * 4 + 3), i * 3);
      col.set(u.subarray(i * 16 + 12, i * 16 + 15), i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3, true));
    return new THREE.Points(g, new THREE.PointsMaterial({ size: 0.016, vertexColors: true, sizeAttenuation: true }));
  }

  async load_mesh() {
    const gltf = await new GLTFLoader().loadAsync(`data/${this.m.mesh.file}`);
    gltf.scene.traverse((o) => { if (o.material) o.material.side = THREE.DoubleSide; });
    return gltf.scene;
  }

  async toggleColliders(on) {
    if (on && !this.layers.colliders && this.m.mesh?.colliders) {
      const gltf = await new GLTFLoader().loadAsync(`data/${this.m.mesh.colliders}`);
      gltf.scene.traverse((o) => {
        if (o.isMesh) o.material = new THREE.MeshBasicMaterial({ color: ROSE, wireframe: true, transparent: true, opacity: 0.55 });
      });
      this.layers.colliders = gltf.scene;
      this.scene.add(gltf.scene);
    }
    if (this.layers.colliders) this.layers.colliders.visible = on;
  }
}

export const fov = (cam) => THREE.MathUtils.radToDeg(2 * Math.atan(cam.intrinsics.height / (2 * cam.intrinsics.fy)));
