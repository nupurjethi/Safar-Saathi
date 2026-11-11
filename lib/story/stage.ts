import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { buildAirplane, PLANE_L, type Airplane } from "./airplane";
import { clamp01, heroPose, kf, smooth } from "./path";
import { cardLife, cardOpacity, cubicBezier, fillBannerGrid, fillCardGrid, unroll, type BannerOpts } from "./cloth";

/* cloth sizes / grids */
const BANNER_L = 34, BANNER_H = 11, BNU = 40, BNV = 14; // banner: plane-local units, grid segments
const CARD_NU = 24, CARD_NV = 16;
const CARD_LIFE = 1.9; // scroll units one card lives (cards are one unit apart): slide+unroll, hold flat, leave
const ROOF_X = 3; // plane-local x of the cabin roof where cards start wrapped (the constant-section part of the fuselage)
const FUS_R = 2.05; // fuselage radius (airplane.ts)

export type CardData = { title: string; sub: string; price: string; palette: [string, string]; cities: string[]; image?: { src: string; credit: string } };

export type StageState = {
  active: "hero" | "services" | "work" | "cta" | "none";
  hero: number;
  services: number; // 0..1 across the pinned section
  serviceIndex: number; // float 0..3 (which capability is open)
  work: number;
  cta: number;
  pointer: { x: number; y: number };
  /** Smoothed scroll speed in px per frame (more cloth flutter while scrolling fast). */
  scrollVel: number;
};

const IDENTITY = new THREE.Quaternion();
/** Card frame -> plane frame on the roof: card x along the fuselage (nose), card y across the roof away from the viewer, card z up. */
const ROOF_FRAME = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0)));

export const initialState = (): StageState => ({ active: "hero", hero: 0, services: 0, serviceIndex: 0, work: 0, cta: 0, pointer: { x: 0, y: 0 }, scrollVel: 0 });

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
  private bannerPos!: Float32Array;
  private bannerShade!: Float32Array;
  private windVel = 0; // smoothed |scroll velocity| 0..1
  private lagY = 0;
  private lagZ = 0;
  private prevPos = new THREE.Vector3();
  private cardW = 3;
  private cardH = 1.875;
  private front = new THREE.Vector3(-0.6, -0.35, 4.2);
  private cardBuf = new Float32Array((CARD_NU + 1) * (CARD_NV + 1) * 3);
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

    // banner trailing the tail: a pennant pinned at the tail edge. Every frame it is re-shaped as cloth (lib/story/cloth.ts)
    const bt = makeBannerTexture(bannerLabels); this.disposables.push(bt);
    const bg = new THREE.PlaneGeometry(BANNER_L, BANNER_H, BNU, BNV);
    this.disposables.push(bg);
    const bn = bg.attributes.position.count;
    bg.setAttribute("color", new THREE.BufferAttribute(new Float32Array(bn * 3).fill(1), 3)); // brightness per vertex: darker in the folds
    this.bannerPos = new Float32Array(bn * 3); this.bannerShade = new Float32Array(bn);
    this.banner = new THREE.Mesh(bg, new THREE.MeshStandardMaterial({ map: bt, emissiveMap: bt, emissive: 0xffffff, emissiveIntensity: 0.3, vertexColors: true, roughness: 0.62, metalness: 0.05, side: THREE.DoubleSide, transparent: true, opacity: 1 }));
    this.banner.position.set(-PLANE_L / 2 - 1.2, 1.9, 0);
    this.banner.frustumCulled = false; // vertices are rewritten every frame
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

    // trip cards: cloth that starts wrapped over the cabin roof, slides off along a curve while unrolling, then lies flat and still in front
    cards.forEach((d) => {
      const tex = makeCardTexture(d);
      const geo = new THREE.PlaneGeometry(3, 1.875, CARD_NU, CARD_NV);
      geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3).fill(1), 3));
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.42, vertexColors: true, roughness: 0.6, metalness: 0.04, side: THREE.DoubleSide, transparent: true }));
      m.visible = false; m.frustumCulled = false; m.renderOrder = this.cards.length + 1;
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
    // where a finished card lies: in front of the plane, clear of the text columns; sized to the visible width at that depth
    this.front.set(aspect > 1.1 ? 0.3 : 0, aspect > 1.1 ? -0.35 : -0.2, 4.2);
    const visW = 2 * Math.tan((15 * Math.PI) / 180) * (this.camera.position.z - this.front.z) * aspect;
    this.cardW = aspect > 1.1 ? Math.min(2.7, visW * 0.4) : visW * 0.66; this.cardH = this.cardW / 1.6;
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
    // wind inputs: how fast you are scrolling, and how the plane itself is moving (the cloth lags behind it)
    s.scrollVel *= Math.pow(0.03, Math.max(0, dt)); // lenis only reports while moving: let the value die away when you stop
    this.windVel += (clamp01(Math.abs(s.scrollVel) / 45) - this.windVel) * Math.min(1, dt * 6);
    if (dt > 0) {
      const inv = P.quaternion.clone().invert();
      const vloc = P.position.clone().sub(this.prevPos).divideScalar(Math.max(dt, 1 / 120)).applyQuaternion(inv);
      const k = Math.min(1, dt * 4);
      this.lagY += (Math.max(-4, Math.min(4, -vloc.y * 1.2)) - this.lagY) * k;
      this.lagZ += (Math.max(-4, Math.min(4, -vloc.z * 1.2)) - this.lagZ) * k;
    }
    this.prevPos.copy(P.position);
    let visible = false;
    let gear = 0, bannerVis = 0;
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
      bannerVis = kf(p, [[0, 1], [0.36, 1], [0.47, 0]]);
      this.green.intensity = 55 + 60 * smooth(0.55, 0.9, p);
    } else if (s.active === "work") {
      const p = s.work;
      visible = p > 0.03 && p < 0.985;
      const topView = smooth(0.8, 0.9, p);
      P.position.set(kf(p, [[0, 0], [0.82, 0], [0.9, 0.2], [0.985, 0]]), kf(p, [[0, -6.4], [0.07, -6.4], [0.22, -0.2], [0.78, -0.05], [0.9, -0.25]]), kf(p, [[0, 0], [0.9, -1.2]]));
      P.rotation.set(
        kf(p, [[0, 0], [0.07, 0], [0.2, 0.42], [0.74, 0.42], [0.82, 0.1], [0.9, 1.5707]]) + py * 0.03, // banks toward the viewer: the cabin roof shows while the cloth cards wrap over it
        kf(p, [[0, -0.95], [0.22, -0.62], [0.8, -0.34], [0.9, -1.2]]) + px * 0.09,
        kf(p, [[0, 0.08], [0.22, 0.02], [0.8, 0.03], [0.9, 0]]) + py * 0.02,
      );
      P.scale.setScalar(0.165 * (1.02 - topView * 0.12));
      gear = 1;
      bannerVis = 0;
      // Cards are cloth. Each one starts WRAPPED over the cabin roof (it follows the plane), slides off along a curve while it
      // unrolls and ripples, lands flat in front of the plane and then lies perfectly still until the next card replaces it.
      const n = this.cards.length;
      const x = kf(p, [[0.2, 0], [0.76, 1]]) * ((n - 1) + CARD_LIFE * 0.79);
      this.rig.updateMatrixWorld(true); P.updateMatrixWorld(true);
      const sc = P.scale.x;
      const roofPos = P.localToWorld(new THREE.Vector3(ROOF_X, FUS_R + 0.03, 0));
      const roofQuat = P.quaternion.clone().multiply(ROOF_FRAME);
      const roofUp = new THREE.Vector3(0, 0, 1).applyQuaternion(roofQuat);
      const wrapR = (FUS_R + 0.03) * sc; // radius of the fuselage cylinder in world units
      const flutter = 1 + 2.2 * this.windVel;
      const end = 1 - smooth(0.74, 0.8, p);
      let best = 0, bestV = 9;
      this.cards.forEach((c, i) => {
        const q = cardLife(x, i, CARD_LIFE);
        const m = c.mesh;
        const live = q > 0.002 && q < 0.998;
        m.visible = live && p > 0.15 && p < 0.83;
        if (!live) return;
        const e = unroll(q); // 0 wrapped .. 1 flat (exactly 1 once settled)
        // curved path: lifts off the roof, arcs out toward the viewer and settles at `front`
        const c1 = { x: roofPos.x + roofUp.x * 0.9, y: roofPos.y + roofUp.y * 0.9, z: roofPos.z + roofUp.z * 0.9 + 0.7 };
        const c2 = { x: this.front.x + 0.5, y: this.front.y + 0.9, z: this.front.z - 1.6 };
        const o = cubicBezier(roofPos, c1, c2, this.front, e);
        const quat = new THREE.Quaternion().slerpQuaternions(roofQuat, IDENTITY, e); // from lying on the roof to facing the viewer
        fillCardGrid(this.cardBuf, CARD_NU, CARD_NV, q, t, { width: this.cardW, height: this.cardH, radius: wrapR, seed: i * 0.37, flutter });
        const pa = m.geometry.attributes.position as THREE.BufferAttribute, ca = m.geometry.attributes.color as THREE.BufferAttribute;
        const v3 = new THREE.Vector3();
        for (let k = 0; k < pa.count; k++) {
          v3.set(this.cardBuf[k * 3], this.cardBuf[k * 3 + 1], this.cardBuf[k * 3 + 2]).applyQuaternion(quat);
          pa.setXYZ(k, v3.x + o.x, v3.y + o.y, v3.z + o.z);
          const z = this.cardBuf[k * 3 + 2]; // folds a touch darker where the cloth dips
          const sh = e >= 1 ? 1 : 0.86 + 0.14 * clamp01(0.5 + z / (this.cardH * 0.5));
          ca.setXYZ(k, sh, sh, sh);
        }
        pa.needsUpdate = true; ca.needsUpdate = true; m.geometry.computeVertexNormals();
        (m.material as THREE.MeshStandardMaterial).opacity = cardOpacity(q) * end;
        const d = Math.abs(q - 0.6); if (d < bestV) { bestV = d; best = i; }
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
      // Cloth: a pennant pinned at the tail. Travelling waves grow toward the free end, a slow swell rides underneath and the tip
      // flutters (faster while you scroll fast). It never goes rigid: the wind only changes strength with the beat.
      const hp = s.active === "hero" ? s.hero : 0;
      const gust = 1 + 0.16 * Math.sin(t * 0.7) + 0.08 * Math.sin(t * 1.9 + 1);
      const opts: BannerOpts = {
        length: BANNER_L, height: BANNER_H,
        amp: (0.58 + 0.72 * smooth(0.12, 0.42, hp)) * gust,
        flutter: 1 + 2.2 * this.windVel,
        lagY: this.lagY, lagZ: this.lagZ,
        twist: 0.2 * Math.sin(t * 0.8) + 0.04 * this.lagZ,
      };
      fillBannerGrid(this.bannerPos, this.bannerShade, BNU, BNV, t, opts);
      const g = this.banner.geometry as THREE.BufferGeometry;
      const pa = g.attributes.position as THREE.BufferAttribute, ca = g.attributes.color as THREE.BufferAttribute;
      (pa.array as Float32Array).set(this.bannerPos);
      for (let k = 0; k < this.bannerShade.length; k++) ca.setXYZ(k, this.bannerShade[k], this.bannerShade[k], this.bannerShade[k]);
      pa.needsUpdate = true; ca.needsUpdate = true; g.computeVertexNormals();
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
