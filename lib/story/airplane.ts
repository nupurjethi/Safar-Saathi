import * as THREE from "three";

/**
 * Procedural narrow-body airliner. No model files: every surface is generated.
 *  - fuselage: lathe profile (rounded nose, constant section, up-swept tail cone) with a painted livery texture
 *  - wings / tailplane / fin: lofted NACA-style sections with sweep, dihedral and twist
 *  - engines: nacelle lathe + fan disc + spinner, hung on pylons
 *  - landing gear that retracts
 * Units: metres. Nose points +X, up is +Y, wings run along ±Z.
 */
export const PLANE_L = 40;
const L = PLANE_L;
const R = 2.05;
const GREEN = 0xd8fd34;

export type Airplane = {
  group: THREE.Group;
  /** gear: 0 = down, 1 = retracted. spin: fan rotation (radians). */
  update(time: number, o: { gear: number; spin: number; strobe?: boolean }): void;
  dispose(): void;
};

/* ----------------------------- helpers ----------------------------- */

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Fuselage radius at axial position a (0 = tail tip, L = nose tip). */
function fusRadius(a: number) {
  const s = L - a; // distance from nose
  const noseLen = 5.6;
  const tailLen = 12;
  if (s < noseLen) {
    const k = (noseLen - s) / noseLen;
    return R * Math.pow(Math.max(0, 1 - Math.pow(k, 2.25)), 1 / 2.25);
  }
  if (a < tailLen) {
    const u = 1 - a / tailLen;
    return R * (1 - 0.9 * Math.pow(u, 1.55));
  }
  return R;
}
/** Tail cone sweeps upward, nose droops a touch. */
function fusLift(a: number) {
  const tailLen = 12;
  const tail = a < tailLen ? Math.pow(1 - a / tailLen, 2.4) * 1.55 : 0;
  const nose = a > L - 6 ? -Math.pow((a - (L - 6)) / 6, 2.2) * 0.34 : 0;
  return tail + nose;
}

function nacaThickness(x: number, tc: number) {
  // NACA 4-digit half-thickness distribution
  return 5 * tc * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
}

type Section = { le: THREE.Vector3; dir: THREE.Vector3; up: THREE.Vector3; chord: number; tc: number; camber?: number };

/** Loft airfoil sections into a closed, smoothly-shaded solid with a capped tip. */
function loft(secs: Section[], nPts = 44, capRoot = false): THREE.BufferGeometry {
  const ring: number[] = [];
  const pos: number[] = [];
  const ringSize = nPts * 2;
  for (const s of secs) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < nPts; i++) {
      const x = 0.5 - 0.5 * Math.cos((i / (nPts - 1)) * Math.PI);
      const yt = nacaThickness(x, s.tc);
      const yc = (s.camber ?? 0.02) * Math.sin(Math.PI * Math.pow(x, 0.85));
      pts.push(s.le.clone().addScaledVector(s.dir, x * s.chord).addScaledVector(s.up, (yc + yt) * s.chord));
    }
    for (let i = nPts - 2; i >= 1; i--) {
      const x = 0.5 - 0.5 * Math.cos((i / (nPts - 1)) * Math.PI);
      const yt = nacaThickness(x, s.tc);
      const yc = (s.camber ?? 0.02) * Math.sin(Math.PI * Math.pow(x, 0.85));
      pts.push(s.le.clone().addScaledVector(s.dir, x * s.chord).addScaledVector(s.up, (yc - yt) * s.chord));
    }
    // pts: upper LE->TE, lower TE->LE  (ringSize - 2 points)
    for (const p of pts) pos.push(p.x, p.y, p.z);
    ring.push(pts.length);
  }
  const n = ring[0];
  const idx: number[] = [];
  for (let j = 0; j < secs.length - 1; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * n + i, b = j * n + ((i + 1) % n), c = (j + 1) * n + i, d = (j + 1) * n + ((i + 1) % n);
      idx.push(a, c, b, b, c, d);
    }
  }
  const addCap = (base: number, flip: boolean) => {
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) { cx += pos[(base + i) * 3]; cy += pos[(base + i) * 3 + 1]; cz += pos[(base + i) * 3 + 2]; }
    const ci = pos.length / 3;
    pos.push(cx / n, cy / n, cz / n);
    for (let i = 0; i < n; i++) {
      const a = base + i, b = base + ((i + 1) % n);
      if (flip) idx.push(ci, b, a); else idx.push(ci, a, b);
    }
  };
  addCap((secs.length - 1) * n, false);
  if (capRoot) addCap(0, true);
  void ringSize;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ----------------------------- textures ----------------------------- */

function makeLivery() {
  const W = 2048, H = 4096; // W = around the fuselage (u), H = along it (v, top = nose)
  const mk = (w: number, h: number) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
  const col = mk(W, H), emi = mk(W / 2, H / 2), rgh = mk(W / 2, H / 2);
  const c = col.getContext("2d")!, e = emi.getContext("2d")!, r = rgh.getContext("2d")!;
  const circ = 2 * Math.PI * R; // metres around
  // meter space: x = around (u * circ), y = along (a, tail 0 -> nose L), y-up
  const setup = (ctx: CanvasRenderingContext2D, w: number, h: number) => ctx.setTransform(w / circ, 0, 0, -h / L, 0, h);

  // base: gunmetal with a soft vertical sheen; roughness map: glossy everywhere, slightly rougher lower belly
  const base = c.createLinearGradient(0, 0, W, 0);
  base.addColorStop(0, "#0d1015"); base.addColorStop(0.25, "#07090c"); base.addColorStop(0.5, "#0d1015"); base.addColorStop(0.75, "#161a21"); base.addColorStop(1, "#0d1015");
  c.fillStyle = base; c.fillRect(0, 0, W, H);
  r.fillStyle = "#2a2a2a"; r.fillRect(0, 0, W / 2, H / 2);
  e.fillStyle = "#000"; e.fillRect(0, 0, W / 2, H / 2);

  // panel lines
  setup(c, W, H);
  c.strokeStyle = "rgba(255,255,255,0.055)"; c.lineWidth = 0.012;
  for (let a = 2; a < L; a += 2.6) { c.beginPath(); c.moveTo(0, a); c.lineTo(circ, a); c.stroke(); }
  for (let u = 0; u < circ; u += 1.6) { c.beginPath(); c.moveTo(u, 0); c.lineTo(u, L); c.stroke(); }
  // rivet rows
  c.fillStyle = "rgba(255,255,255,0.05)";
  for (let a = 3; a < L - 3; a += 0.55) for (const u of [0.2, 3.1, 6.2, 9.4, 12.5]) { c.beginPath(); c.arc(u, a, 0.018, 0, 7); c.fill(); }

  const U = (uu: number) => uu * circ; // 0..1 -> metres around
  const sides = [U(0.955), U(0.545)]; // window row, just above the equator on +Z and -Z

  // cheatline: thin green line + wide dark swoosh toward the tail
  for (const uLine of [U(0.978), U(0.522)]) {
    const g = c.createLinearGradient(0, 4, 0, L - 6);
    g.addColorStop(0, "rgba(216,253,52,0.0)"); g.addColorStop(0.12, "rgba(216,253,52,0.95)"); g.addColorStop(0.85, "rgba(216,253,52,0.95)"); g.addColorStop(1, "rgba(216,253,52,0.0)");
    c.fillStyle = g; c.fillRect(uLine - 0.035, 4, 0.07, L - 10);
  }
  // tail swoosh (green wedge sweeping up the tail cone on both sides)
  for (const [u0, dir] of [[U(0.97), -1], [U(0.53), 1]] as const) {
    c.fillStyle = "rgba(216,253,52,0.9)";
    c.beginPath(); c.moveTo(u0, 6); c.quadraticCurveTo(u0 + dir * 0.55, 14, u0 + dir * 0.1, 22); c.lineTo(u0 + dir * 0.02, 22); c.quadraticCurveTo(u0 + dir * 0.4, 14, u0 - dir * 0.05, 6); c.fill();
  }
  // underbelly belly glow stripe (reads as underlighting)
  const belly = c.createLinearGradient(U(0.2), 0, U(0.3), 0);
  belly.addColorStop(0, "rgba(216,253,52,0)"); belly.addColorStop(0.5, "rgba(216,253,52,0.16)"); belly.addColorStop(1, "rgba(216,253,52,0)");
  c.fillStyle = belly; c.fillRect(U(0.2), 6, U(0.1), L - 14);

  // windows (cabin)
  const win = (u: number, a: number, w = 0.34, h = 0.46) => {
    c.fillStyle = "#04070a";
    c.strokeStyle = "rgba(190,210,230,0.28)"; c.lineWidth = 0.02;
    c.beginPath(); c.roundRect(u - w / 2, a - h / 2, w, h, 0.16); c.fill(); c.stroke();
    e.save(); setup(e, W / 2, H / 2);
    const g = e.createRadialGradient(u, a, 0, u, a, h);
    g.addColorStop(0, "rgba(232,255,140,0.95)"); g.addColorStop(1, "rgba(232,255,140,0)");
    e.fillStyle = g; e.beginPath(); e.roundRect(u - w / 2, a - h / 2, w, h, 0.16); e.fill(); e.restore();
  };
  for (const u of sides) for (let a = 8.6; a < 30.4; a += 0.86) { if (Math.abs(a - 14.4) < 0.55 || Math.abs(a - 31.6) < 0.7) continue; win(u, a); }
  // cockpit windows: two big panes + side panes, framed
  for (const u of sides) {
    for (const [a, w, h] of [[L - 4.25, 0.62, 0.5], [L - 3.35, 0.5, 0.46]] as const) {
      c.fillStyle = "#020305"; c.strokeStyle = "rgba(210,225,240,0.5)"; c.lineWidth = 0.035;
      c.beginPath(); c.roundRect(u - w / 2 + 0.02, a - h / 2, w, h, 0.1); c.fill(); c.stroke();
    }
  }
  // doors
  c.strokeStyle = "rgba(255,255,255,0.16)"; c.lineWidth = 0.03;
  for (const u of sides) for (const a of [14.4, L - 8.4]) { c.beginPath(); c.roundRect(u - 0.5, a - 0.9, 1.0, 1.8, 0.28); c.stroke(); }

  // wordmark
  const word = (u: number, side: 1 | -1) => {
    c.save(); c.translate(u, 24.2); c.scale(0.01, -0.01);
    c.rotate(side === 1 ? Math.PI / 2 : -Math.PI / 2);
    c.fillStyle = "rgba(235,245,240,0.95)"; c.font = "700 70px Outfit, 'Helvetica Neue', Arial, sans-serif";
    c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText("SAFAR SAATHI", 0, 0);
    c.restore();
  };
  word(U(0.935), -1); word(U(0.565), 1);

  // roughness: windows and cockpit glassy
  r.fillStyle = "#101010";
  setup(r, W / 2, H / 2);
  for (const u of sides) { for (let a = 8.6; a < 30.4; a += 0.86) r.fillRect(u - 0.17, a - 0.23, 0.34, 0.46); for (const a of [L - 4.25, L - 3.35]) r.fillRect(u - 0.31, a - 0.25, 0.62, 0.5); }

  const tex = (cv: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8; t.wrapS = THREE.RepeatWrapping; t.needsUpdate = true;
    return t;
  };
  return { map: tex(col, true), emissiveMap: tex(emi, true), roughnessMap: tex(rgh, false) };
}

function makeFanTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#050607"; g.fillRect(0, 0, 256, 256);
  g.translate(128, 128);
  for (let i = 0; i < 22; i++) {
    g.rotate((Math.PI * 2) / 22);
    const gr = g.createLinearGradient(0, 0, 0, -120);
    gr.addColorStop(0, "#3b4350"); gr.addColorStop(1, "#aab4c0");
    g.fillStyle = gr; g.beginPath(); g.moveTo(-3, -22); g.quadraticCurveTo(14, -70, 5, -122); g.lineTo(-10, -118); g.quadraticCurveTo(-4, -70, -9, -22); g.fill();
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function makeTailLogo() {
  const c = document.createElement("canvas"); c.width = 512; c.height = 512;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, 512, 512);
  g.strokeStyle = "#d8fd34"; g.lineWidth = 26; g.lineCap = "round"; g.lineJoin = "round";
  // the "X" wing mark: two crossing strokes ending in a swept tip
  g.beginPath(); g.moveTo(90, 90); g.lineTo(420, 420); g.stroke();
  g.beginPath(); g.moveTo(420, 90); g.lineTo(90, 420); g.stroke();
  g.lineWidth = 12; g.beginPath(); g.moveTo(60, 256); g.lineTo(450, 256); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/* ------------------------------- build ------------------------------- */

export function buildAirplane(): Airplane {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T) => { disposables.push(x); return x; };

  const liv = makeLivery();
  Object.values(liv).forEach(track);

  const skin = track(new THREE.MeshPhysicalMaterial({
    color: 0xffffff, map: liv.map, roughnessMap: liv.roughnessMap, roughness: 0.62, metalness: 0.28,
    clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.25,
    emissive: 0xffffff, emissiveMap: liv.emissiveMap, emissiveIntensity: 0.9,
  }));
  const dark = track(new THREE.MeshPhysicalMaterial({ color: 0x0b0d11, metalness: 0.4, roughness: 0.24, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.3 }));
  const metal = track(new THREE.MeshStandardMaterial({ color: 0x9aa5b2, metalness: 1, roughness: 0.22, envMapIntensity: 1.4 }));
  const rubber = track(new THREE.MeshStandardMaterial({ color: 0x0a0a0b, metalness: 0, roughness: 0.92 }));
  const glowGreen = track(new THREE.MeshBasicMaterial({ color: GREEN }));

  /* fuselage */
  const prof: THREE.Vector2[] = [];
  const N = 260;
  for (let i = 0; i <= N; i++) {
    const a = Math.pow(i / N, 1.0) * L;
    prof.push(new THREE.Vector2(Math.max(0.012, fusRadius(a)), a));
  }
  const fusGeo = track(new THREE.LatheGeometry(prof, 160));
  fusGeo.rotateZ(-Math.PI / 2);
  {
    const p = fusGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const a = p.getX(i); // axial coordinate (0 tail .. L nose)
      p.setY(i, p.getY(i) + fusLift(a));
      p.setX(i, a - L / 2);
    }
    fusGeo.computeVertexNormals();
  }
  const fuselage = new THREE.Mesh(fusGeo, skin);
  group.add(fuselage);

  /* wings */
  const halfSpan = 17.4;
  const wingSections = (side: 1 | -1): Section[] => {
    const out: Section[] = [];
    const n = 14;
    for (let i = 0; i <= n; i++) {
      const eta = i / n;
      const chord = THREE.MathUtils.lerp(6.6, 1.55, Math.pow(eta, 0.82));
      const sweep = Math.tan((27 * Math.PI) / 180) * eta * halfSpan;
      const z = side * (1.3 + eta * halfSpan);
      const y = -1.35 + eta * halfSpan * 0.085 + Math.pow(eta, 2.5) * 0.7;
      const tw = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(2.5, -2.6, eta));
      const le = new THREE.Vector3(3.2 - sweep - (eta > 0.001 ? 0 : 0), y, z);
      out.push({ le, dir: new THREE.Vector3(-Math.cos(tw), Math.sin(tw), 0), up: new THREE.Vector3(Math.sin(tw), Math.cos(tw), 0), chord, tc: THREE.MathUtils.lerp(0.145, 0.095, eta), camber: 0.025 });
    }
    return out;
  };
  for (const side of [1, -1] as const) {
    const g = track(loft(wingSections(side), 48));
    group.add(new THREE.Mesh(g, dark));
    // sharklet: sections climb in +Y from the tip
    const tip = wingSections(side).at(-1)!;
    const sl: Section[] = [];
    for (let i = 0; i <= 6; i++) {
      const k = i / 6;
      const chord = THREE.MathUtils.lerp(1.55, 0.55, k);
      const lean = THREE.MathUtils.degToRad(12) * k;
      sl.push({
        le: new THREE.Vector3(tip.le.x - k * 1.35, tip.le.y + k * 2.15, tip.le.z + side * (0.02 + k * 0.28)),
        dir: new THREE.Vector3(-1, 0, 0), up: new THREE.Vector3(0, Math.sin(lean) * 0, side * 1), chord, tc: 0.075, camber: 0.0,
      });
    }
    group.add(new THREE.Mesh(track(loft(sl, 30)), dark));
    // green wingtip nav light
    const tipLight = new THREE.Mesh(track(new THREE.SphereGeometry(0.1, 12, 12)), track(new THREE.MeshBasicMaterial({ color: side === 1 ? 0xd8fd34 : 0xff2d2d })));
    tipLight.position.set(tip.le.x - 0.9, tip.le.y + 0.12, tip.le.z + side * 0.05);
    group.add(tipLight);
  }
  // wing-body fairing
  const fair = new THREE.Mesh(track(new THREE.SphereGeometry(1, 40, 24)), skin);
  fair.scale.set(8.2, 1.25, 2.9); fair.position.set(-0.6, -1.25, 0);
  group.add(fair);

  /* tailplane + fin */
  const tailX = -L / 2 + 5.4, tailY = fusLift(5.2) + 0.55;
  for (const side of [1, -1] as const) {
    const secs: Section[] = [];
    for (let i = 0; i <= 8; i++) {
      const eta = i / 8;
      const chord = THREE.MathUtils.lerp(4.1, 1.35, eta);
      secs.push({ le: new THREE.Vector3(tailX + 1.4 - Math.tan(0.56) * eta * 7.1, tailY + eta * 0.55, side * (0.5 + eta * 7.1)), dir: new THREE.Vector3(-1, 0, 0), up: new THREE.Vector3(0, 1, 0), chord, tc: 0.095, camber: 0 });
    }
    group.add(new THREE.Mesh(track(loft(secs, 36)), dark));
  }
  {
    const secs: Section[] = [];
    for (let i = 0; i <= 12; i++) {
      const eta = i / 12;
      const chord = THREE.MathUtils.lerp(7.4, 2.7, eta);
      secs.push({ le: new THREE.Vector3(tailX + 2.6 - Math.tan(0.62) * eta * 8.6, tailY + 0.4 + eta * 8.6, 0), dir: new THREE.Vector3(-1, 0, 0), up: new THREE.Vector3(0, 0, 1), chord, tc: 0.1, camber: 0 });
    }
    const finGeo = track(loft(secs, 40));
    group.add(new THREE.Mesh(finGeo, skin.clone()));
    const logo = makeTailLogo(); track(logo);
    const decalMat = track(new THREE.MeshBasicMaterial({ map: logo, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    for (const side of [1, -1] as const) {
      const d = new THREE.Mesh(track(new THREE.PlaneGeometry(3.3, 3.3)), decalMat);
      d.position.set(tailX - 1.35, tailY + 5.1, side * 0.29);
      if (side === -1) d.rotation.y = Math.PI;
      group.add(d);
    }
    // strobe beacon
    const strobe = new THREE.Mesh(track(new THREE.SphereGeometry(0.11, 12, 12)), track(new THREE.MeshBasicMaterial({ color: 0xffffff })));
    strobe.position.set(tailX - 4.4, tailY + 9.1, 0);
    strobe.name = "strobe";
    group.add(strobe);
  }

  /* engines */
  const fanTex = makeFanTexture(); track(fanTex);
  const fanMat = track(new THREE.MeshStandardMaterial({ map: fanTex, metalness: 0.9, roughness: 0.35 }));
  const fans: THREE.Mesh[] = [];
  const nacProf: THREE.Vector2[] = [];
  const NL = 5.2;
  for (let i = 0; i <= 60; i++) {
    const a = (i / 60) * NL; // 0 = exhaust end, NL = inlet
    let r: number;
    if (a > NL - 0.9) r = 1.2 - Math.pow((a - (NL - 0.9)) / 0.9, 2.4) * 0.12; // lip rolls inward a little
    else if (a > 0.9) r = 1.2 + Math.sin(((a - 0.9) / (NL - 1.8)) * Math.PI) * 0.1 - 0.05;
    else r = 0.78 + (a / 0.9) * 0.4;
    nacProf.push(new THREE.Vector2(r, a));
  }
  const nacGeo = track(new THREE.LatheGeometry(nacProf, 64)); nacGeo.rotateZ(-Math.PI / 2); nacGeo.translate(-NL / 2, 0, 0);
  for (const side of [1, -1] as const) {
    const eng = new THREE.Group();
    eng.add(new THREE.Mesh(nacGeo, dark));
    const lip = new THREE.Mesh(track(new THREE.TorusGeometry(1.1, 0.045, 12, 64)), metal);
    lip.rotation.y = Math.PI / 2; lip.position.x = NL / 2 - 0.02; eng.add(lip);
    const fan = new THREE.Mesh(track(new THREE.CircleGeometry(1.06, 48)), fanMat);
    fan.rotation.y = Math.PI / 2; fan.position.x = NL / 2 - 0.55; fans.push(fan); eng.add(fan);
    const spinner = new THREE.Mesh(track(new THREE.ConeGeometry(0.3, 0.7, 32)), metal);
    spinner.rotation.z = -Math.PI / 2; spinner.position.x = NL / 2 - 0.22; eng.add(spinner);
    const plug = new THREE.Mesh(track(new THREE.ConeGeometry(0.62, 1.8, 32)), metal);
    plug.rotation.z = Math.PI / 2; plug.position.x = -NL / 2 - 0.55; eng.add(plug);
    const ring = new THREE.Mesh(track(new THREE.TorusGeometry(0.78, 0.035, 8, 48)), glowGreen);
    ring.rotation.y = Math.PI / 2; ring.position.x = -NL / 2 + 0.02; eng.add(ring);
    eng.position.set(2.4, -2.55, side * 6.1);
    group.add(eng);
    // pylon
    const pyl = new THREE.Mesh(track(new THREE.BoxGeometry(3.4, 1.15, 0.2)), dark);
    pyl.position.set(2.9, -1.95, side * 6.1);
    group.add(pyl);
  }

  /* landing gear (pivot groups so they can fold up) */
  const gear = new THREE.Group();
  const wheel = (x: number, y: number, z: number, g: THREE.Group, r = 0.55, w = 0.4) => {
    const t = new THREE.Mesh(track(new THREE.CylinderGeometry(r, r, w, 40)), rubber); t.rotation.x = Math.PI / 2; t.position.set(x, y, z); g.add(t);
    const hub = new THREE.Mesh(track(new THREE.CylinderGeometry(r * 0.5, r * 0.5, w + 0.02, 24)), metal); hub.rotation.x = Math.PI / 2; hub.position.set(x, y, z); g.add(hub);
  };
  const strut = (g: THREE.Group, len: number, rad: number, y0: number) => {
    const s = new THREE.Mesh(track(new THREE.CylinderGeometry(rad, rad * 1.18, len, 18)), metal); s.position.y = y0 - len / 2; g.add(s);
  };
  const nose = new THREE.Group(); nose.position.set(L / 2 - 8.4, -R * 0.85, 0);
  strut(nose, 2.1, 0.09, 0); wheel(0, -2.15, 0.22, nose, 0.5, 0.34); wheel(0, -2.15, -0.22, nose, 0.5, 0.34);
  gear.add(nose);
  const mains: THREE.Group[] = [];
  for (const side of [1, -1] as const) {
    const m = new THREE.Group(); m.position.set(-1.7, -R * 0.55 - 0.9, side * 3.9);
    strut(m, 2.5, 0.12, 0);
    for (const dx of [-0.55, 0.55]) for (const dz of [-0.3, 0.3]) wheel(dx, -2.6, dz, m, 0.56, 0.3);
    gear.add(m); mains.push(m);
  }
  group.add(gear);

  const strobe = group.getObjectByName("strobe") as THREE.Mesh;
  const baseGear = { nose: nose.position.clone(), mains: mains.map((m) => m.position.clone()) };

  return {
    group,
    update(time, o) {
      fans.forEach((f, i) => { f.rotation.x = o.spin * (i ? -1 : 1); });
      const k = smooth(0, 1, o.gear);
      gear.visible = k < 0.995;
      nose.rotation.z = k * (Math.PI / 2); // folds backward into the nose bay
      nose.position.y = baseGear.nose.y + k * 0.6;
      mains.forEach((m, i) => { const s = i === 0 ? 1 : -1; m.rotation.x = s * k * (Math.PI / 2) * -1; m.position.y = baseGear.mains[i].y + k * 0.9; });
      (strobe.material as THREE.MeshBasicMaterial).color.setScalar(Math.sin(time * 9) > 0.8 ? 1 : 0.08);
    },
    dispose() { disposables.forEach((d) => d.dispose()); },
  };
}
