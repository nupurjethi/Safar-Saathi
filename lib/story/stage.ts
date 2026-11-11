import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { buildAirplane, PLANE_L, type Airplane } from "./airplane";
import { clamp01, heroPose, kf, smooth } from "./path";

export type CardData = { title: string; sub: string; price: string; palette: [string, string]; cities: string[]; image?: { src: string; credit: string } };

export type StageState = {
  active: "hero" | "services" | "work" | "cta" | "none";
  hero: number;
  services: number; // 0..1 across the pinned section
  serviceIndex: number; // float 0..3 (which capability is open)
  work: number;
  cta: number;
  pointer: { x: number; y: number };
};

export const initialState = (): StageState => ({ active: "hero", hero: 0, services: 0, serviceIndex: 0, work: 0, cta: 0, pointer: { x: 0, y: 0 } });

/* keyframe interpolator + flight paths live in ./path (pure, unit-tested) */

/* ------------------------------ canvases ------------------------------ */

function fontFamily() {
  return getComputedStyle(document.body).fontFamily || "Arial, sans-serif";
}

function makeBannerTexture(labels: string[]) {
  const W = 2048, H = 740;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, "#0c0e02"); grad.addColorStop(0.45, "#6f8a10"); grad.addColorStop(1, "#d8fd34");
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  // woven texture
  g.globalAlpha = 0.07; g.fillStyle = "#fff";
  for (let y = 0; y < H; y += 6) g.fillRect(0, y, W, 1);
  for (let x = 0; x < W; x += 6) g.fillRect(x, 0, 1, H);
  g.globalAlpha = 1;
  // vignette
  const v = g.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, W * 0.62);
  v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,0.5)");
  g.fillStyle = v; g.fillRect(0, 0, W, H);
  const ff = fontFamily();
  g.fillStyle = "rgba(246,255,200,0.8)"; g.font = `500 30px ${ff}`; g.textAlign = "center";
  g.fillText("WE'VE GOT THESE COVERED", W / 2, 150);
  const styles = ["700 76px", "500 66px", "600 82px", "500 70px", "700 64px", "600 74px"];
  labels.slice(0, 9).forEach((l, i) => {
    const row = Math.floor(i / 3), col = i % 3;
    g.font = `${styles[i % styles.length]} ${ff}`; g.fillStyle = `rgba(250,255,225,${0.72 + (i % 3) * 0.08})`;
    g.textAlign = "center";
    g.fillText(l.toUpperCase(), W * (0.2 + col * 0.3), 290 + row * 150);
  });
  g.font = `500 26px ${ff}`; g.fillStyle = "rgba(246,255,200,0.6)"; g.fillText("SAMPLE DATA · NO LIVE INVENTORY · NO WRINKLES IN YOUR PLAN", W / 2, H - 70);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

function makeCardTexture(d: CardData) {
  const W = 1024, H = 640;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  const ff = fontFamily();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  const paint = (img: HTMLImageElement | null) => {
    const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, d.palette[0]); gr.addColorStop(1, d.palette[1]);
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    if (img) {
      // real photo of the destination, cover-fitted into the area above the caption bar
      const ah = H - 210, s = Math.max(W / img.naturalWidth, ah / img.naturalHeight), w = img.naturalWidth * s, h = img.naturalHeight * s;
      g.save(); g.beginPath(); g.rect(0, 0, W, ah); g.clip(); g.drawImage(img, (W - w) / 2, (ah - h) / 2, w, h); g.restore();
      const sh = g.createLinearGradient(0, ah - 140, 0, ah); sh.addColorStop(0, "rgba(0,0,0,0)"); sh.addColorStop(1, "rgba(0,0,0,0.45)"); g.fillStyle = sh; g.fillRect(0, ah - 140, W, 140);
    } else {
      g.fillStyle = "rgba(0,0,0,0.38)"; g.fillRect(0, 0, W, H);
      // route art: dotted path + two pins (fallback when a destination has no openly licensed photo)
      g.strokeStyle = "#d8fd34"; g.lineWidth = 7; g.lineCap = "round"; g.setLineDash([2, 22]);
      g.beginPath(); g.moveTo(-20, 410); g.bezierCurveTo(240, 180, 380, 520, 600, 330); g.bezierCurveTo(780, 190, 900, 260, 1060, 200); g.stroke();
      g.setLineDash([]);
      for (const [x, y] of [[190, 285], [830, 245]]) { g.fillStyle = "#d8fd34"; g.beginPath(); g.arc(x, y, 18, 0, 7); g.fill(); g.fillStyle = "#050505"; g.beginPath(); g.arc(x, y, 7, 0, 7); g.fill(); }
    }
    g.fillStyle = "rgba(10,12,16,0.82)"; g.fillRect(0, H - 210, W, 210);
    g.fillStyle = "#f4f4ee"; g.font = `600 58px ${ff}`; g.textAlign = "left"; g.fillText(d.title, 48, H - 128, W - 96);
    g.fillStyle = "#d8fd34"; g.font = `500 28px ${ff}`; g.fillText(d.sub.toUpperCase(), 48, H - 76, W - 96);
    g.fillStyle = "rgba(233,236,235,0.7)"; g.font = `500 28px ${ff}`; g.fillText(d.price, 48, H - 30);
    g.fillStyle = "rgba(10,12,16,0.7)"; g.beginPath(); g.roundRect(W - 168, 32, 130, 46, 23); g.fill();
    g.fillStyle = "#d8fd34"; g.font = `600 22px ${ff}`; g.textAlign = "center"; g.fillText("SAMPLE", W - 103, 63);
    if (img && d.image) { g.fillStyle = "rgba(255,255,255,0.82)"; g.font = `500 21px ${ff}`; g.textAlign = "right"; g.fillText(d.image.credit, W - 24, H - 224, W - 48); }
    t.needsUpdate = true;
  };
  paint(null);
  if (d.image) {
    const img = new Image(); img.decoding = "async";
    img.onload = () => paint(img);
    img.src = d.image.src; // same-origin file from public/places (Wikimedia Commons, openly licensed); never hotlinked
  }
  return t;
}

function softSprite() {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.4, "rgba(255,255,255,0.35)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/* ------------------------------ banded ring ------------------------------ */

const RING_SEG = 180, RING_TUBE = 44;
function ringCenter(theta: number, shape: number): [number, number, number, number] {
  // returns [x, y, nx, ny]: point on the base curve and its outward unit normal
  let x = 0, y = 0;
  if (shape === 0) { x = 1.25 * Math.cos(theta); y = 1.25 * Math.sin(theta); }
  else if (shape === 1) { const n = 4; const c = Math.cos(theta), s = Math.sin(theta); const k = 1.3 / Math.pow(Math.pow(Math.abs(c), n) + Math.pow(Math.abs(s), n), 1 / n); x = k * c; y = k * s; }
  else if (shape === 2) { const a = ((theta + Math.PI / 2) % ((2 * Math.PI) / 3) + (2 * Math.PI) / 3) % ((2 * Math.PI) / 3); const k = 1.45 * Math.pow(Math.cos(Math.PI / 3) / Math.cos(a - Math.PI / 3), 0.78); x = k * Math.cos(theta); y = k * Math.sin(theta); }
  else { const k = 1.22 + 0.2 * Math.sin(3 * theta + 0.5) + 0.1 * Math.sin(5 * theta + 1.2); x = k * Math.cos(theta); y = k * Math.sin(theta); }
  const e = 0.002;
  const p2 = shape === 0 ? [1.25 * Math.cos(theta + e), 1.25 * Math.sin(theta + e)] : null;
  void p2;
  return [x, y, 0, 0];
}
function ringGeometryAt(shapeMix: number[]): Float32Array {
  const out = new Float32Array((RING_SEG + 1) * (RING_TUBE + 1) * 3);
  let idx = 0;
  for (let i = 0; i <= RING_SEG; i++) {
    const th = (i / RING_SEG) * Math.PI * 2;
    // blended base curve
    let cx = 0, cy = 0;
    for (let s = 0; s < 4; s++) { if (shapeMix[s] <= 0.0001) continue; const [x, y] = ringCenter(th, s); cx += x * shapeMix[s]; cy += y * shapeMix[s]; }
    // tangent by finite difference for a correct outward normal
    const e = 0.01;
    let tx = 0, ty = 0;
    for (let s = 0; s < 4; s++) { if (shapeMix[s] <= 0.0001) continue; const [x1, y1] = ringCenter(th + e, s); const [x0, y0] = ringCenter(th - e, s); tx += (x1 - x0) * shapeMix[s]; ty += (y1 - y0) * shapeMix[s]; }
    const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    const nx = ty, ny = -tx; // outward
    const twist = th * 1.0 + 0.55;
    for (let j = 0; j <= RING_TUBE; j++) {
      const ph = (j / RING_TUBE) * Math.PI * 2;
      const a = 0.5 * Math.cos(ph), b = 0.34 * Math.sin(ph);
      const ca = Math.cos(twist * 0.5), sa = Math.sin(twist * 0.5);
      const ra = a * ca - b * sa, rb = a * sa + b * ca; // rotating oval section => ribbon-like twist
      out[idx++] = cx + nx * ra; out[idx++] = cy + ny * ra; out[idx++] = rb;
    }
  }
  return out;
}

/* ================================== STAGE ================================== */

export class Stage {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  plane: Airplane;
  rig = new THREE.Group();
  banner!: THREE.Mesh;
  bannerBase!: Float32Array;
  ring!: THREE.Mesh;
  ringShapeKey = "";
  cards: { mesh: THREE.Mesh; tex: THREE.Texture }[] = [];
  puffs!: THREE.Points;
  puffData!: { pos: Float32Array; vel: Float32Array; age: Float32Array };
  green!: THREE.PointLight;
  state = initialState();
  smoothPointer = { x: 0, y: 0 };
  private disposables: { dispose(): void }[] = [];
  private spin = 0;
  private w = 1;
  private h = 1;
  workIndex = 0;
  private drawn = false;
  onWorkIndex?: (i: number) => void;

  constructor(public canvas: HTMLCanvasElement, cards: CardData[], bannerLabels: string[]) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    const pm = new THREE.PMREMGenerator(this.renderer);
    const env = new RoomEnvironment();
    this.scene.environment = pm.fromScene(env, 0.035).texture;
    this.scene.environmentIntensity = 0.62;
    env.dispose?.();
    pm.dispose();

    // light rig: cool key, soft fill, green rim from behind/below (the brand colour)
    const key = new THREE.DirectionalLight(0xdfe9ff, 2.4); key.position.set(-6, 8, 7); this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x6a7a99, 0.55); fill.position.set(7, 1, 5); this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0xd8fd34, 3.4); rim.position.set(3, -2, -9); this.scene.add(rim);
    const rim2 = new THREE.DirectionalLight(0xd8fd34, 1.6); rim2.position.set(-8, 2, -5); this.scene.add(rim2);
    this.green = new THREE.PointLight(0xd8fd34, 55, 16, 1.6); this.green.position.set(0, -3.2, 1); this.rig.add(this.green);
    this.scene.add(this.rig);

    this.plane = buildAirplane();
    this.plane.group.scale.setScalar(0.165);
    this.plane.group.rotation.order = "YZX";
    this.rig.add(this.plane.group);

    // banner trailing the tail (the "cloth": wrinkled at first, ironed flat as you scroll)
    const bt = makeBannerTexture(bannerLabels); this.disposables.push(bt);
    const bg = new THREE.PlaneGeometry(34, 12.4, 110, 40);
    this.disposables.push(bg);
    this.bannerBase = new Float32Array(bg.attributes.position.array as Float32Array);
    this.banner = new THREE.Mesh(bg, new THREE.MeshStandardMaterial({ map: bt, emissiveMap: bt, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.7, metalness: 0.1, side: THREE.DoubleSide, transparent: true, opacity: 1 }));
    this.banner.position.set(-PLANE_L / 2 - 1.2, 1.9, 0);
    this.banner.rotation.y = Math.PI / 2; // spans the Z axis behind the tail; we shear it in update()
    this.banner.rotation.y = 0;
    (this.banner.geometry as THREE.PlaneGeometry).translate(-17, 0, 0); // pivot at the tail edge, trailing toward -X
    this.bannerBase = new Float32Array(this.banner.geometry.attributes.position.array as Float32Array);
    this.plane.group.add(this.banner);

    // engine steam / vapour
    const spr = softSprite(); this.disposables.push(spr);
    const NP = 420;
    const pos = new Float32Array(NP * 3), vel = new Float32Array(NP * 3), age = new Float32Array(NP);
    for (let i = 0; i < NP; i++) { age[i] = Math.random(); }
    const pg = new THREE.BufferGeometry(); pg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.puffs = new THREE.Points(pg, new THREE.PointsMaterial({ map: spr, size: 0.2, transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xe8ff7a, sizeAttenuation: true }));
    this.puffs.frustumCulled = false;
    this.puffData = { pos, vel, age };
    this.plane.group.add(this.puffs);
    this.disposables.push(pg);

    // banded ring (services)
    const rg = new THREE.BufferGeometry();
    const arr = ringGeometryAt([1, 0, 0, 0]);
    rg.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    const uv = new Float32Array((RING_SEG + 1) * (RING_TUBE + 1) * 2);
    const index: number[] = [];
    for (let i = 0; i <= RING_SEG; i++) for (let j = 0; j <= RING_TUBE; j++) {
      const k = i * (RING_TUBE + 1) + j; uv[k * 2] = i / RING_SEG; uv[k * 2 + 1] = j / RING_TUBE;
      if (i < RING_SEG && j < RING_TUBE) { const a = k, b = k + RING_TUBE + 1; index.push(a, b, a + 1, a + 1, b, b + 1); }
    }
    rg.setAttribute("uv", new THREE.BufferAttribute(uv, 2)); rg.setIndex(index); rg.computeVertexNormals();
    this.disposables.push(rg);
    const rm = new THREE.ShaderMaterial({
      uniforms: { uPhase: { value: 0 }, uBands: { value: 9 } },
      vertexShader: `varying vec3 vN; varying vec3 vV; varying vec2 vUv; void main(){ vUv=uv; vN=normalize(normalMatrix*normal); vec4 mv=modelViewMatrix*vec4(position,1.0); vV=-mv.xyz; gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `varying vec3 vN; varying vec3 vV; varying vec2 vUv; uniform float uPhase; uniform float uBands;
        void main(){
          float s = sin(vUv.y*6.2831853*uBands + uPhase);
          float w = fwidth(s)*1.1;
          float m = smoothstep(-w, w, s);
          vec3 n = normalize(vN); vec3 v = normalize(vV);
          float l = 0.55 + 0.45*max(dot(n, normalize(vec3(-0.35,0.7,0.62))),0.0);
          float rim = pow(1.0-max(dot(n,v),0.0), 2.2);
          vec3 c = mix(vec3(0.025,0.03,0.035), vec3(0.96), m) * l;
          c += rim*0.18*vec3(0.847,0.992,0.204);
          gl_FragColor = vec4(c,1.0);
          #include <colorspace_fragment>
        }`,
      side: THREE.DoubleSide,
    });
    this.ring = new THREE.Mesh(rg, rm); this.ring.scale.setScalar(1.12); this.ring.visible = false;
    this.rig.add(this.ring);
    this.disposables.push(rm);

    // sliding trip cards (the "fabric" coming off the board, now boarding passes from the cabin door)
    cards.forEach((d) => {
      const tex = makeCardTexture(d);
      const geo = new THREE.PlaneGeometry(3.7, 2.31, 28, 14);
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide, transparent: true }));
      m.visible = false; m.userData.base = new Float32Array(geo.attributes.position.array as Float32Array);
      this.rig.add(m); this.cards.push({ mesh: m, tex }); this.disposables.push(tex, geo);
    });
  }

  resize(w: number, h: number, dpr: number) {
    this.w = w; this.h = h;
    this.renderer.setPixelRatio(Math.min(dpr, w < 700 ? 1.5 : 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // keep the plane the same visual size on narrow screens by pulling the camera back
    const aspect = w / h;
    // keep ~8.5 world units visible across, so the whole plane fits on a phone
    this.camera.position.set(0, 0.35, Math.max(13, 8.5 / (2 * Math.tan((15 * Math.PI) / 180) * aspect)));
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
  }

  setRingShape(idx: number) {
    // idx is a float 0..3: blend neighbouring shapes
    const lo = Math.floor(idx), hi = Math.min(3, lo + 1), f = idx - lo;
    const mix = [0, 0, 0, 0]; mix[lo] = 1 - f; mix[hi] += f;
    const key = mix.map((x) => x.toFixed(2)).join(",");
    if (key === this.ringShapeKey) return;
    this.ringShapeKey = key;
    const g = this.ring.geometry as THREE.BufferGeometry;
    (g.attributes.position.array as Float32Array).set(ringGeometryAt(mix));
    g.attributes.position.needsUpdate = true; g.computeVertexNormals();
  }

  /** Called every frame (GSAP ticker). `t` in seconds. */
  frame(t: number, dt: number) {
    const s = this.state;
    this.smoothPointer.x += (s.pointer.x - this.smoothPointer.x) * 0.06;
    this.smoothPointer.y += (s.pointer.y - this.smoothPointer.y) * 0.06;
    const px = this.smoothPointer.x, py = this.smoothPointer.y;

    const P = this.plane.group;
    let visible = false;
    let gear = 0, bannerCalm = 1, bannerVis = 0;
    this.ring.visible = false;
    this.cards.forEach((c) => (c.mesh.visible = false));
    this.green.intensity = 55;

    if (s.active === "hero") {
      const p = s.hero;
      visible = kf(p, [[0, 1], [0.545, 1], [0.555, 0], [0.605, 0], [0.615, 1], [0.92, 1], [0.95, 0]]) > 0.5;
      const hp = heroPose(p, t);
      P.position.set(hp.x, hp.y, hp.z);
      P.rotation.set(hp.rx + py * 0.04, hp.ry + px * 0.1, hp.rz + py * 0.03);
      P.scale.setScalar(0.165 * hp.scale);
      gear = kf(p, [[0, 0], [0.18, 0], [0.37, 1]]);
      bannerCalm = kf(p, [[0, 0], [0.32, 1]]);
      bannerVis = kf(p, [[0, 1], [0.36, 1], [0.47, 0]]);
      this.green.intensity = 55 + 60 * smooth(0.55, 0.9, p);
    } else if (s.active === "work") {
      const p = s.work;
      visible = p > 0.03 && p < 0.985;
      const topView = smooth(0.8, 0.9, p);
      P.position.set(kf(p, [[0, 0], [0.82, 0], [0.9, 0.2], [0.985, 0]]), kf(p, [[0, -6.4], [0.07, -6.4], [0.22, -0.2], [0.78, -0.05], [0.9, -0.25]]), kf(p, [[0, 0], [0.9, -1.2]]));
      P.rotation.set(
        kf(p, [[0, 0], [0.8, 0.1], [0.9, 1.5707]]) + py * 0.03,
        kf(p, [[0, -0.95], [0.22, -0.62], [0.8, -0.34], [0.9, -1.2]]) + px * 0.09,
        kf(p, [[0, 0.08], [0.22, 0.02], [0.8, 0.03], [0.9, 0]]) + py * 0.02,
      );
      P.scale.setScalar(0.165 * (1.02 - topView * 0.12));
      gear = 1;
      bannerVis = 0;
      // cards glide out of the cabin door, over the wing, toward the viewer
      const n = this.cards.length;
      const span = kf(p, [[0.2, 0], [0.8, 1]]);
      const x = span * (n + 0.5);
      let best = 0, bestV = 9;
      this.cards.forEach((c, i) => {
        const q = clamp01((x - i) / 1.55); // 0..1 life of this card
        const m = c.mesh;
        const live = q > 0.001 && q < 0.999;
        m.visible = live && s.work > 0.15 && s.work < 0.86;
        if (!live) return;
        const e = q;
        // path: from the fuselage belly slot -> toward camera, drooping like a ribbon
        const a = new THREE.Vector3(0.1, -0.3, -0.2), b = new THREE.Vector3(-0.9, -1.35, 1.6), c2 = new THREE.Vector3(-1.7, -3.5, 3.9);
        const pt = a.clone().multiplyScalar((1 - e) * (1 - e)).add(b.clone().multiplyScalar(2 * (1 - e) * e)).add(c2.clone().multiplyScalar(e * e));
        m.position.copy(pt);
        m.position.x += Math.sin(e * 2.6 + i) * 0.18;
        const sc = 0.42 + 0.4 * smooth(0, 0.45, e) + 0.14 * smooth(0.7, 1, e);
        m.scale.setScalar(sc);
        m.rotation.set(-0.5 + e * 0.35 + py * 0.05, -0.12 + px * 0.1, -0.06 * Math.sin(e * 3 + i));
        (m.material as THREE.MeshStandardMaterial).opacity = smooth(0, 0.12, e) * (1 - smooth(0.86, 1, e));
        // ribbon bend
        const base = m.userData.base as Float32Array; const pa = m.geometry.attributes.position;
        for (let v = 0; v < pa.count; v++) { const bx = base[v * 3], by = base[v * 3 + 1]; pa.setZ(v, Math.sin(by * 0.9 + t * 1.4 + i) * 0.1 * (1 - e * 0.5) + bx * bx * 0.045); }
        pa.needsUpdate = true; m.geometry.computeVertexNormals();
        const d = Math.abs(q - 0.42); if (d < bestV) { bestV = d; best = i; }
      });
      if (best !== this.workIndex && s.work > 0.18 && s.work < 0.82) { this.workIndex = best; this.onWorkIndex?.(best); }
    } else if (s.active === "cta") {
      const p = s.cta;
      visible = true;
      P.position.set(0.2, kf(p, [[0, -6.4], [1, -2.2]]), 0);
      P.rotation.set(0 + px * 0.05, -1.5707, 1.5707 + py * 0.03);
      P.scale.setScalar(0.165 * 1.55);
      gear = 1;
      this.green.intensity = 90;
    } else if (s.active === "services") {
      this.ring.visible = true;
      const p = s.services;
      this.setRingShape(clamp01(s.serviceIndex / 3) * 3);
      this.ring.rotation.set(0.95 + py * 0.15 + Math.sin(t * 0.3) * 0.05, -0.55 + px * 0.25 + t * 0.12, 0.25 + s.serviceIndex * 0.35);
      const asp = this.w / this.h;
      this.ring.position.set(asp > 1.1 ? -3.1 * Math.min(1, asp / 1.6) : 0, asp > 1.1 ? 0 : 1.9, 0);
      this.ring.scale.setScalar(1.3 * (0.9 + 0.1 * smooth(0, 0.05, p)) * (this.w / this.h < 1 ? 0.7 : 1));
      (this.ring.material as THREE.ShaderMaterial).uniforms.uPhase.value = t * 0.5 + s.serviceIndex;
    }

    if (!visible && !this.ring.visible && !this.cards.some((c) => c.mesh.visible)) {
      // nothing to draw: clear once, then skip all GPU work until a section needs the stage again
      if (this.drawn) { this.renderer.clear(); this.drawn = false; }
      return;
    }
    this.drawn = true;
    P.visible = visible;
    this.plane.update(t, { gear, spin: (this.spin += dt * (14 + 30 * (s.active === "hero" ? 1 : 0))), strobe: true });
    this.banner.visible = visible && bannerVis > 0.01;
    this.puffs.visible = visible;

    if (this.banner.visible) {
      // "wrinkled cloth" wave that calms down as you scroll (the cloth gets ironed flat)
      const pa = this.banner.geometry.attributes.position as THREE.BufferAttribute;
      const amp = 1.6 * (1 - bannerCalm) + 0.16;
      for (let i = 0; i < pa.count; i++) {
        const bx = this.bannerBase[i * 3], by = this.bannerBase[i * 3 + 1];
        const k = Math.min(1, -bx / 34);
        const w = Math.sin(bx * 0.55 - t * 3.0 + by * 0.4) * amp * k + Math.sin(by * 1.7 + bx * 0.3 + t * 1.7) * amp * 0.42 * k;
        pa.setXYZ(i, bx * (1 - 0.0), by * (0.78 + 0.22 * (1 - k * 0.4)), w + (bx < -1 ? Math.sin(bx * 0.09) * 1.2 * k : 0));
      }
      pa.needsUpdate = true; this.banner.geometry.computeVertexNormals();
      (this.banner.material as THREE.MeshStandardMaterial).opacity = bannerVis;
      this.banner.scale.x = 0.3 + 0.7 * bannerVis;
    }

    if (visible) this.stepPuffs(dt, t);
    this.renderer.render(this.scene, this.camera);
  }

  private stepPuffs(dt: number, t: number) {
    const { pos, vel, age } = this.puffData;
    const n = age.length;
    const spawn = (i: number) => {
      const side = i % 2 ? 1 : -1;
      pos[i * 3] = -2.6 - Math.random() * 0.4; pos[i * 3 + 1] = -2.55 + (Math.random() - 0.5) * 0.5; pos[i * 3 + 2] = side * 6.1 + (Math.random() - 0.5) * 0.5;
      vel[i * 3] = -(5 + Math.random() * 5); vel[i * 3 + 1] = (Math.random() - 0.3) * 0.6; vel[i * 3 + 2] = (Math.random() - 0.5) * 0.7 + side * 0.15;
      age[i] = 0;
    };
    for (let i = 0; i < n; i++) {
      age[i] += dt * 0.42;
      if (age[i] >= 1 || (pos[i * 3] === 0 && pos[i * 3 + 1] === 0)) spawn(i);
      pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt + Math.sin(t + i) * 0.002; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
    }
    (this.puffs.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.puffs.material as THREE.PointsMaterial).opacity = 0.08;
  }

  dispose() {
    this.plane.dispose();
    this.disposables.forEach((d) => d.dispose());
    this.renderer.dispose();
  }
}
