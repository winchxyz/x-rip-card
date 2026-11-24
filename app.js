import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const gsap = window.gsap;
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ================================================================ data
// crop: [x, y, width] of the hero card (fractions) printed on the pack. art: holo window [top, side, bottom] in % of the card.
const SETS = [
  { id: 'swsh7', dex: 'swsh/swsh7', pad: 0, name: 'Evolving Skies', year: 2021, holoRare: false,
    hero: '218', crop: [.2, .135, .6], c: ['#39c7a0', '#136a72', '#06222c'], art: [12, 8, 52] },
  { id: 'sv3pt5', dex: 'sv/sv03.5', pad: 3, name: 'Scarlet & Violet 151', year: 2023, holoRare: true,
    hero: '199', crop: [.2, .105, .6], c: ['#ff7a3d', '#c22a2f', '#3b0a16'], art: [11, 7.5, 53] },
  { id: 'sv8pt5', dex: 'sv/sv08.5', pad: 3, name: 'Prismatic Evolutions', year: 2025, holoRare: true,
    hero: '161', crop: [.2, .165, .6], c: ['#5f6fe0', '#2c2578', '#0b0a24'], art: [11, 7.5, 53] },
  { id: 'base1', dex: 'base/base1', pad: 0, name: 'Base Set', year: 1999, holoRare: false,
    hero: '4', crop: [.25, .125, .5], c: ['#ffb347', '#cf4b1f', '#40100c'], art: [12.5, 10.5, 49.5] },
];
// Rarity name -> effect tier. 0 common, 1 uncommon, 2 rare, 3 holo rare, 4 V/ex, 5 ultra, 6 secret.
const TIER = {
  'Common': 0, 'Uncommon': 1, 'Rare': 2, 'Rare Holo': 3,
  'Double Rare': 4, 'Rare Holo V': 4, 'ACE SPEC Rare': 4,
  'Rare Holo VMAX': 5, 'Ultra Rare': 5, 'Rare Ultra': 5, 'Illustration Rare': 5,
  'Special Illustration Rare': 6, 'Rare Rainbow': 6, 'Rare Secret': 6, 'Hyper Rare': 6,
};
const AURA = [null, null, null, '#5fc4ff', '#a98bff', '#ff6fc8', '#ffd24a'];
const HIT_W = { 2: 30, 3: 36, 4: 20, 5: 10, 6: 4 };            // weights of the last slot, per tier
const FORCE = +new URLSearchParams(location.search).get('hit');  // ?hit=6 forces the last slot tier, for testing

for (const s of SETS) {
  s.cards = window.CARD_DATA[s.id].split(';').map(row => {
    const [n, name, r] = row.split('|');
    const rarity = window.RARITIES[+r];
    let t = TIER[rarity];
    if (t === 2 && s.holoRare) t = 3;      // every Rare is holo in Scarlet & Violet sets
    return { n, name, rarity, t, set: s };
  });
  s.by = [0, 1, 2, 3, 4, 5, 6].map(t => s.cards.filter(c => c.t === t));
}
const cardUrls = c => [
  `https://assets.tcgdex.net/en/${c.set.dex}/${c.set.pad ? c.n.padStart(c.set.pad, '0') : c.n}/high.webp`,
  `https://images.pokemontcg.io/${c.set.id}/${c.n}_hires.png`,
];
const pick = a => a[Math.floor(Math.random() * a.length)];
function rollHit(s) {
  const tiers = Object.keys(HIT_W).map(Number).filter(t => s.by[t].length);
  if (FORCE && tiers.includes(FORCE)) return FORCE;
  let x = Math.random() * tiers.reduce((sum, t) => sum + HIT_W[t], 0);
  for (const t of tiers) { if ((x -= HIT_W[t]) < 0) return t; }
  return tiers[0];
}
function rollPack(s) {
  const out = [];
  for (const t of [0, 0, 1, 1, rollHit(s)]) {
    let c; do { c = pick(s.by[t]); } while (out.includes(c));
    out.push(c);
  }
  return out;
}
function loadImage(urls) {
  return new Promise((res, rej) => {
    const list = [].concat(urls); let i = 0;
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => res(img);
    img.onerror = () => { if (++i < list.length) img.src = list[i]; else rej(new Error('image ' + list[0])); };
    img.src = list[0];
  });
}

// ================================================================ renderer
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.toneMapping = THREE.NoToneMapping;   // cards must keep their printed colours
const MAXA = renderer.capabilities.getMaxAnisotropy();

const scene = new THREE.Scene();
scene.background = new THREE.Color('#07080b');
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;

const FOV = 26;
const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 50);
const key = new THREE.DirectionalLight('#fff4e6', 1.0); key.position.set(1.4, 2.2, 3.2); scene.add(key);
const rim = new THREE.DirectionalLight('#9db8ff', 0.9); rim.position.set(-2.5, 1.0, -1.5); scene.add(rim);

const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), 0.3, 0.6, 1.08);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// layout in world units; the camera always shows L.h units vertically
const L = { h: 2, w: 2, u: 1 };
function resize() {
  const w = innerWidth, h = innerHeight, aspect = w / h;
  renderer.setSize(w, h, false); composer.setSize(w, h);
  L.h = Math.max(2.0, 1.34 / aspect); L.w = L.h * aspect; L.u = h / L.h;
  camera.aspect = aspect;
  camera.position.set(0, 0, L.h / (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2))));
  camera.updateProjectionMatrix();
  const D = camera.position.z;
  L.upZ = 0.3; L.mag = D / (D - L.upZ);     // the open card sits closer to the camera and so looks bigger
  L.compact = h < 520;                      // little room: fewer and larger things on screen
  document.body.classList.toggle('compact', L.compact);
  if (L.compact && aspect > 1.2) {          // short and wide: the tray goes to the side
    L.packS = 1.1; L.packY = 0.2; L.sealS = 1.24; L.sealY = 0.1;
    L.cardS = 1.4; L.cardY = 0.15; L.trayS = 0.3;
    L.tray = i => ({ x: L.w / 2 - 0.3, y: 0.62 - i * 0.31 });
  } else {                                  // square and tall frames: everything is sized from the frame itself
    const k = 1.03 * L.mag;
    L.packS = Math.min(0.6 * L.w / 0.7, (L.compact ? 0.68 : 0.56) * L.h / 1.25); L.packY = (L.compact ? 0.1 : 0.025) * L.h;
    L.sealS = Math.min(L.packS * 1.14, 0.8 * L.w / 0.7, 0.8 * L.h / 1.25); L.sealY = 0.03 * L.h;
    L.cardS = Math.min(0.8 * L.w / 0.63, 0.6 * L.h / 0.88) / k;
    L.cardY = L.h / 2 - (L.compact ? 0.04 : 0.075) * L.h - 0.44 * L.cardS * k;
    L.trayS = Math.min(0.24, (0.18 * L.w - 0.03) / 0.63);
    L.tray = i => ({ x: (i - 2) * (0.63 * L.trayS + 0.03), y: -L.h / 2 + 0.06 * L.h + 0.44 * L.trayS });
  }
  $('label').style.top = (h / 2 - (L.cardY - 0.44 * 1.03 * L.cardS) * L.mag * L.u + h * 0.022) + 'px';
}

// ================================================================ procedural textures
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = MAXA;
  return t;
}
const glowTex = canvasTex(256, 256, (g, w) => {
  const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(.25, 'rgba(255,255,255,.55)'); r.addColorStop(.6, 'rgba(255,255,255,.12)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, w, w);
});
const ringTex = canvasTex(256, 256, (g, w) => {
  const r = g.createRadialGradient(w / 2, w / 2, w * .3, w / 2, w / 2, w / 2);
  r.addColorStop(0, 'rgba(255,255,255,0)'); r.addColorStop(.72, 'rgba(255,255,255,.0)'); r.addColorStop(.86, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, w, w);
});
// glitter field: R = spark brightness, G = random phase so each spark twinkles on its own
const sparkTex = canvasTex(256, 256, (g, w) => {
  g.fillStyle = '#000'; g.fillRect(0, 0, w, w);
  for (let i = 0; i < 900; i++) {
    const b = 90 + Math.random() * 165 | 0, ph = Math.random() * 255 | 0;
    g.fillStyle = `rgb(${b},${ph},0)`;
    const s = Math.random() < .12 ? 2 : 1;
    g.fillRect(Math.random() * w | 0, Math.random() * w | 0, s, s);
  }
}, false);
sparkTex.wrapS = sparkTex.wrapT = THREE.RepeatWrapping;
sparkTex.magFilter = THREE.NearestFilter; sparkTex.minFilter = THREE.NearestFilter; sparkTex.generateMipmaps = false;

// ================================================================ pack
const PW = 0.70, PH = 1.25, CR_T = 0.085, CR_B = 0.075, BULGE = 0.036, VC = 1 - CR_T;

// foil relief: ribs in the crimped ends, soft creases across the body
const packNormal = (() => {
  const W = 256, H = 512, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), img = g.createImageData(W, H);
  const waves = Array.from({ length: 7 }, () => ({ a: Math.random() * Math.PI, f: 2 + Math.random() * 7, p: Math.random() * 6.28, k: .5 + Math.random() }));
  const hgt = (x, y) => {
    const u = x / W, v = 1 - y / H;
    let z = 0;
    for (const o of waves) z += Math.sin((u * Math.cos(o.a) + v * 1.8 * Math.sin(o.a)) * o.f * 6.28 + o.p) * 0.35 * o.k / o.f;
    const crimp = v > VC || v < CR_B ? 1 : 0;
    return z * (1 - crimp) * 1.6 + crimp * Math.sin(u * 6.28 * 44) * 0.9;
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = hgt(x + 1, y) - hgt(x - 1, y), dy = hgt(x, y + 1) - hgt(x, y - 1), i = (y * W + x) * 4;
    img.data[i] = clamp(128 - dx * 150, 0, 255); img.data[i + 1] = clamp(128 + dy * 150, 0, 255); img.data[i + 2] = 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.anisotropy = MAXA; return t;
})();
// pinked (zig-zag) top and bottom edges
const packAlpha = canvasTex(512, 1024, (g, w, h) => {
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#fff'; g.beginPath();
  const n = 26, t = 9;
  g.moveTo(0, t);
  for (let i = 0; i < n; i++) { g.lineTo((i + .5) * w / n, 0); g.lineTo((i + 1) * w / n, t); }
  g.lineTo(w, h - t);
  for (let i = n; i > 0; i--) { g.lineTo((i - .5) * w / n, h); g.lineTo((i - 1) * w / n, h - t); }
  g.closePath(); g.fill();
}, false);

function packFace(set, hero, logo, back) {
  return canvasTex(1024, 1829, (g, W, H) => {
    const base = g.createLinearGradient(0, 0, W * .35, H);
    base.addColorStop(0, set.c[0]); base.addColorStop(.55, set.c[1]); base.addColorStop(1, set.c[2]);
    g.fillStyle = base; g.fillRect(0, 0, W, H);
    if (!back) {
      // hero art, full bleed from the top, dissolving into the wrapper colour
      const artH = H * 0.72, sw = set.crop[2] * hero.width, sh = sw * artH / W;
      const a = document.createElement('canvas'); a.width = W; a.height = artH;
      const ag = a.getContext('2d');
      ag.imageSmoothingQuality = 'high';
      ag.drawImage(hero, set.crop[0] * hero.width, set.crop[1] * hero.height, sw, sh, 0, 0, W, artH);
      const m = ag.createLinearGradient(0, 0, 0, artH);
      m.addColorStop(0, '#000'); m.addColorStop(.48, '#000'); m.addColorStop(.76, 'rgba(0,0,0,0)');
      ag.globalCompositeOperation = 'destination-in'; ag.fillStyle = m; ag.fillRect(0, 0, W, artH);
      g.drawImage(a, 0, 0);
    }
    // darker foot so the logo sits on something calm
    const foot = g.createLinearGradient(0, H * .5, 0, H);
    foot.addColorStop(0, 'rgba(0,0,0,0)'); foot.addColorStop(1, 'rgba(0,0,0,.42)');
    g.fillStyle = foot; g.fillRect(0, H * .5, W, H * .5);
    // crimped ends read as bare foil
    g.fillStyle = 'rgba(255,255,255,.2)'; g.fillRect(0, 0, W, H * CR_T);
    g.fillStyle = 'rgba(255,255,255,.14)'; g.fillRect(0, H * (1 - CR_B), W, H * CR_B);
    // logo
    const bw = W * (back ? .5 : .8), bh = H * (back ? .12 : .2), k = Math.min(bw / logo.width, bh / logo.height);
    const lw = logo.width * k, lh = logo.height * k, ly = H * (back ? .5 : .695) - lh / 2;
    g.save(); g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 34; g.shadowOffsetY = 10;
    g.drawImage(logo, (W - lw) / 2, ly, lw, lh); g.restore();
    if (!back) {
      g.font = '600 31px Inter, system-ui, sans-serif'; g.textAlign = 'center'; g.fillStyle = 'rgba(255,255,255,.82)';
      try { g.letterSpacing = '9px'; } catch (e) {}
      g.fillText('5 CARDS', W / 2 + 4, H * .852);
    }
  });
}
function packGeo(v0, v1, sx, sy) {
  const g = new THREE.PlaneGeometry(PW, PH * (v1 - v0), sx, sy);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const u = uv.getX(i), v = v0 + uv.getY(i) * (v1 - v0);
    const side = 1 - Math.pow(Math.abs(2 * u - 1), 3.2);
    const body = smooth(CR_B, CR_B + .13, v) * (1 - smooth(VC - .13, VC, v));
    p.setXYZ(i, (u - .5) * PW, (v - .5) * PH, BULGE * side * body);
    uv.setXY(i, u, v);
  }
  g.computeVertexNormals();
  return g;
}
const bodyGeo = packGeo(0, VC, 28, 56);
function makePack(set, hero, logo) {
  const mat = map => new THREE.MeshPhysicalMaterial({
    map, normalMap: packNormal, normalScale: new THREE.Vector2(.55, .55), alphaMap: packAlpha, alphaTest: .5,
    metalness: .15, roughness: .3, specularIntensity: .45, envMapIntensity: .5, emissive: '#ffffff', emissiveMap: map, emissiveIntensity: .3,
  });
  const front = mat(packFace(set, hero, logo, false)), backM = mat(packFace(set, hero, logo, true));
  const group = new THREE.Group();
  const body = new THREE.Mesh(bodyGeo, front);
  const back = new THREE.Mesh(bodyGeo, backM); back.rotation.y = Math.PI;
  const stripGeo = packGeo(VC, 1, 72, 3);
  const stripM = front.clone(); stripM.side = THREE.DoubleSide;   // the curl shows its underside
  const strip = new THREE.Mesh(stripGeo, stripM);
  group.add(body, back, strip);
  group.userData = { set, strip, stripGeo, rest: stripGeo.attributes.position.array.slice(), mats: [front, backM, stripM], tiltX: 0, tiltY: 0 };
  return group;
}
// Peel the strip: everything behind the tear front curls up and towards the camera.
function peel(pack, p, dir) {
  const { stripGeo, rest } = pack.userData, pos = stripGeo.attributes.position, R = 0.1, MAXA_ = 2.75;
  for (let i = 0; i < pos.count; i++) {
    const x0 = rest[i * 3], y0 = rest[i * 3 + 1], z0 = rest[i * 3 + 2];
    const u = dir > 0 ? x0 / PW + .5 : .5 - x0 / PW;
    const s = (p - u) * PW;
    if (s <= 0) { pos.setXYZ(i, x0, y0, z0); continue; }
    const a = Math.min(s / R, MAXA_), tail = Math.max(0, s - R * MAXA_);
    const hx = (p - .5) * PW;                               // tear front, in the mirrored frame
    const lx = hx - R * Math.sin(a) - tail * Math.cos(MAXA_);
    const lz = R * (1 - Math.cos(a)) + tail * Math.sin(MAXA_) * .6;
    pos.setXYZ(i, dir > 0 ? lx : -lx, y0 + s * .03, z0 + lz);
  }
  pos.needsUpdate = true; stripGeo.computeVertexNormals();
}
function resetPack(pack) {
  const d = pack.userData;
  gsap.killTweensOf([pack.position, pack.rotation, pack.scale, d.strip.position, d.strip.rotation]);
  d.stripGeo.attributes.position.array.set(d.rest); d.stripGeo.attributes.position.needsUpdate = true; d.stripGeo.computeVertexNormals();
  d.strip.position.set(0, 0, 0); d.strip.rotation.set(0, 0, 0); d.strip.visible = true;
  pack.rotation.set(0, 0, 0); pack.visible = true; d.cut = 0;
}

// ================================================================ cards
const CW = 0.63, CH = 0.88;
const cardGeo = (() => {
  const w = CW / 2, h = CH / 2, r = 0.03, s = new THREE.Shape();
  s.moveTo(-w + r, -h); s.lineTo(w - r, -h); s.quadraticCurveTo(w, -h, w, -h + r);
  s.lineTo(w, h - r); s.quadraticCurveTo(w, h, w - r, h); s.lineTo(-w + r, h); s.quadraticCurveTo(-w, h, -w, h - r);
  s.lineTo(-w, -h + r); s.quadraticCurveTo(-w, -h, -w + r, -h);
  const g = new THREE.ShapeGeometry(s, 10), p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / CW + .5, p.getY(i) / CH + .5);
  return g;
})();
const HOLO = [0, 0, 0, .5, .36, .46, .5];
function frontMaterial(c, tex) {
  const foil = c.t >= 3;
  const m = new THREE.MeshPhysicalMaterial({
    map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: .42, metalness: 0, roughness: foil ? .3 : .6, clearcoat: foil ? .8 : .12, clearcoatRoughness: foil ? .1 : .5, envMapIntensity: foil ? .4 : .28,
  });
  if (!foil) return m;
  const a = c.set.art;
  const uni = {
    uHolo: { value: HOLO[c.t] }, uTier: { value: c.t }, uGold: { value: c.t === 6 ? 1 : 0 }, uSpark: { value: sparkTex },
    uArt: { value: new THREE.Vector4(a[1] / 100, a[2] / 100, 1 - a[1] / 100, 1 - a[0] / 100) },
  };
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uni);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uHolo; uniform float uTier; uniform float uGold; uniform vec4 uArt; uniform sampler2D uSpark;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      {
        vec2 huv = vMapUv;
        vec3 hn = normalize(vNormal), hv = normalize(vViewPosition);
        vec2 tilt = hn.xy * 2.4 + hv.xy * 1.4;              // how the surface is turned to the eye
        float mask = 1.0;
        if (uTier < 3.5) mask = step(uArt.x, huv.x) * step(huv.x, uArt.z) * step(uArt.y, huv.y) * step(huv.y, uArt.w);
        float band = huv.x * 1.25 + huv.y * 0.85 + tilt.x * 1.7 + tilt.y * 1.15;
        vec3 rainbow = 0.5 + 0.5 * cos(6.28318 * (band + vec3(0.0, 0.33, 0.67)));
        vec3 gold = vec3(1.0, 0.76, 0.3) * (0.55 + 0.45 * sin(6.28318 * band * 1.5));
        vec3 foilCol = mix(rainbow, gold, uGold * 0.7);
        float streak = pow(0.5 + 0.5 * sin(6.28318 * band * 2.0), 3.0);
        float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        vec3 foil = foilCol * (0.18 + 0.82 * streak) * (0.25 + 0.95 * lum);
        float lines = uTier < 3.5 ? 0.6 + 0.4 * step(0.5, fract(huv.x * 84.0)) : 1.0;   // classic holo rare bars
        vec4 sp = texture2D(uSpark, huv * vec2(2.6, 3.6));
        float tw = pow(max(0.0, cos(sp.g * 6.28318 + tilt.x * 16.0 + tilt.y * 12.0)), 12.0);
        float glit = sp.r * tw * step(4.5, uTier);
        totalEmissiveRadiance += (foil * lines * uHolo + glit * (foilCol * 2.2 + 1.6)) * mask;
      }`);
  };
  return m;
}
let backTex = null;
const backMat = () => new THREE.MeshPhysicalMaterial({ map: backTex, emissive: '#ffffff', emissiveMap: backTex, emissiveIntensity: .42, roughness: .5, clearcoat: .3, clearcoatRoughness: .3, envMapIntensity: .3 });
function makeCard(c) {
  const group = new THREE.Group();
  const front = new THREE.Mesh(cardGeo, new THREE.MeshPhysicalMaterial({ color: '#1b1d24', roughness: .6 }));
  const back = new THREE.Mesh(cardGeo, backMat()); back.rotation.y = Math.PI; back.position.z = -0.0015;
  group.add(front, back);
  group.userData = { c, up: false, moving: true };
  loadImage(cardUrls(c)).then(img => {
    const t = new THREE.Texture(img); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = MAXA; t.needsUpdate = true;
    front.material.dispose(); front.material = frontMaterial(c, t);
  }).catch(() => {});
  return group;
}
function disposeCard(g) {
  scene.remove(g);
  g.children.forEach(m => { if (m.material.map && m.material.map !== backTex) m.material.map.dispose(); m.material.dispose(); });
}

// ================================================================ light fx
const addMat = (map, color) => new THREE.MeshBasicMaterial({ map, color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
const plane1 = new THREE.PlaneGeometry(1, 1);
const backdrop = new THREE.Mesh(plane1, new THREE.MeshBasicMaterial({ map: glowTex, color: '#3b0a16', transparent: true, opacity: .6, depthWrite: false }));
backdrop.position.set(0, 0.1, -2.6); backdrop.scale.set(9, 7, 1); scene.add(backdrop);
const aura = new THREE.Mesh(plane1, addMat(glowTex, '#ffffff')); aura.scale.set(2.3, 2.6, 1); aura.renderOrder = 1; scene.add(aura);
const mouth = new THREE.Mesh(plane1, addMat(glowTex, '#ffe2a8')); mouth.renderOrder = 1; scene.add(mouth);
const ring = new THREE.Mesh(plane1, addMat(ringTex, '#ffffff')); ring.renderOrder = 3; scene.add(ring);
const rgb = (c, k = 1) => { const q = new THREE.Color(c); return { r: q.r * k, g: q.g * k, b: q.b * k }; };
const tint = c => { gsap.to(backdrop.material.color, { ...rgb(c), duration: .9, ease: 'power2.out', overwrite: true }); };

// sparks
const NP = 700, pPos = new Float32Array(NP * 3), pCol = new Float32Array(NP * 4), pSize = new Float32Array(NP), pVel = new Float32Array(NP * 3), pLife = new Float32Array(NP), pDecay = new Float32Array(NP), pG = new Float32Array(NP);
const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
pGeo.setAttribute('aCol', new THREE.BufferAttribute(pCol, 4));
pGeo.setAttribute('aSize', new THREE.BufferAttribute(pSize, 1));
const sparks = new THREE.Points(pGeo, new THREE.ShaderMaterial({
  uniforms: { uPx: { value: 1 } }, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  vertexShader: 'attribute vec4 aCol; attribute float aSize; uniform float uPx; varying vec4 vC; void main(){ vC=aCol; vec4 mv=modelViewMatrix*vec4(position,1.); gl_PointSize=aSize*uPx/-mv.z; gl_Position=projectionMatrix*mv; }',
  fragmentShader: 'varying vec4 vC; void main(){ float d=length(gl_PointCoord-.5); float a=smoothstep(.5,.0,d); gl_FragColor=vec4(vC.rgb*2.4, vC.a*a*a); }',
}));
sparks.frustumCulled = false; sparks.renderOrder = 4; scene.add(sparks);
let pNext = 0;
const tmpC = new THREE.Color();
function burst(x, y, z, color, n, speed, o = {}) {
  for (let k = 0; k < n; k++) {
    const i = pNext = (pNext + 1) % NP;
    const a = (o.dir ?? 0) + (Math.random() - .5) * (o.spread ?? Math.PI * 2), v = speed * (.25 + Math.random() * .75);
    pPos[i * 3] = x + (Math.random() - .5) * (o.rx ?? 0); pPos[i * 3 + 1] = y + (Math.random() - .5) * (o.ry ?? 0); pPos[i * 3 + 2] = z;
    pVel[i * 3] = Math.cos(a) * v; pVel[i * 3 + 1] = Math.sin(a) * v; pVel[i * 3 + 2] = (Math.random() - .3) * v * .6;
    tmpC.set(Math.random() < .35 ? '#ffffff' : color);
    pCol[i * 4] = tmpC.r; pCol[i * 4 + 1] = tmpC.g; pCol[i * 4 + 2] = tmpC.b; pCol[i * 4 + 3] = 1;
    pSize[i] = (o.size ?? .02) * (.4 + Math.random());
    pLife[i] = 1; pDecay[i] = (o.decay ?? 1.1) * (.6 + Math.random() * .9); pG[i] = o.gravity ?? 1.2;
  }
}
function stepSparks(dt) {
  for (let i = 0; i < NP; i++) {
    if (pLife[i] <= 0) { pCol[i * 4 + 3] = 0; continue; }
    pLife[i] -= pDecay[i] * dt;
    const d = Math.pow(.12, dt);
    pVel[i * 3] *= d; pVel[i * 3 + 1] = pVel[i * 3 + 1] * d - pG[i] * dt; pVel[i * 3 + 2] *= d;
    pPos[i * 3] += pVel[i * 3] * dt; pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt; pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
    pCol[i * 4 + 3] = Math.max(pLife[i], 0);
  }
  pGeo.attributes.position.needsUpdate = pGeo.attributes.aCol.needsUpdate = pGeo.attributes.aSize.needsUpdate = true;
}

// ================================================================ state
let state = 'boot', sel = 1, scroll = 1, set = SETS[1], pack = null, hand = [], cards = [], cur = -1, busy = false, tearDir = 1;
const ptr = { x: 0, y: 0 }, sway = { x: 0, y: 0 };
const setState = s => { state = s; document.body.dataset.s = s; };
const label = $('label');

let scrollTw = null;
function shelfUI() {
  const s = SETS[sel];
  $('setYear').textContent = s.year; $('setName').textContent = s.name; $('setName2').textContent = s.name; $('setSub').textContent = `${s.cards.length} cards · 5 per pack`;
  [...$('dots').children].forEach((d, i) => d.classList.toggle('on', i === sel));
  $('prev').disabled = sel === 0; $('next').disabled = sel === SETS.length - 1;
  tint(s.c[2]);
}
function select(i) {
  i = clamp(i, 0, SETS.length - 1);
  if (i !== sel) { sel = i; shelfUI(); }
  if (scrollTw) scrollTw.kill();
  scrollTw = gsap.to({ v: scroll }, { v: sel, duration: .7, ease: 'expo.out', onUpdate() { scroll = this.targets()[0].v; } });
}
// packs sit on an arc; this runs every frame while the shelf is up
function layoutShelf() {
  for (const [i, s] of SETS.entries()) {
    const p = s.pack; if (!p || p.userData.held) continue;
    const o = i - scroll, a = Math.min(Math.abs(o), 2);
    p.position.set(o * 0.8 * (1 - a * .07), L.packY - a * .012, -a * .62);
    p.rotation.set(p.userData.tiltX * (1 - a), -o * .52 + p.userData.tiltY * (1 - a), 0);
    p.scale.setScalar(L.packS);
    p.visible = a < 1.9 || true;
    const k = 1 - .5 * Math.min(a, 1);
    p.userData.mats.forEach(m => m.color.setScalar(k));
  }
}
function toShelf() {
  busy = true;
  clearHand(true);
  label.classList.remove('show');
  gsap.to(aura.material, { opacity: 0, duration: .3, overwrite: true });
  for (const s of SETS) {
    const p = s.pack; resetPack(p); p.userData.held = false; p.userData.tiltX = p.userData.tiltY = 0;
  }
  pack = null;
  setState('shelf'); shelfUI();
  layoutShelf();
  for (const s of SETS) { s.pack.userData.held = true; gsap.from(s.pack.position, { y: -2.4, duration: .9, ease: 'expo.out', delay: .05 * Math.abs(SETS.indexOf(s) - sel), onComplete() { s.pack.userData.held = false; } }); }
  gsap.delayedCall(.6, () => { busy = false; });
}
function clearHand(fly) {
  const old = cards; cards = []; hand = []; cur = -1;
  old.forEach((g, i) => {
    gsap.killTweensOf([g.position, g.rotation, g.scale]);
    if (!fly) { disposeCard(g); return; }
    gsap.to(g.position, { y: -L.h, z: -1, duration: .55, ease: 'power2.in', delay: i * .03, onComplete: () => disposeCard(g) });
    gsap.to(g.rotation, { z: (Math.random() - .5) * 1.2, duration: .55, delay: i * .03 });
  });
}
function choose() {
  if (busy && state !== 'result') return;
  busy = true;
  clearHand(true);
  label.classList.remove('show');
  gsap.to(aura.material, { opacity: 0, duration: .3, overwrite: true });
  set = SETS[sel];
  const fromResult = state === 'result';
  for (const s of SETS) {
    const p = s.pack; p.userData.held = true;
    if (s === set) continue;
    gsap.killTweensOf(p.position);
    gsap.to(p.position, { x: p.position.x + Math.sign(SETS.indexOf(s) - sel) * 2.4, z: -1.2, duration: .6, ease: 'power3.in', onComplete: () => { p.visible = false; } });
  }
  pack = set.pack; resetPack(pack);
  pack.userData.mats.forEach(m => m.color.setScalar(1));
  if (fromResult) { pack.position.set(0, -2.4, .2); pack.scale.setScalar(L.sealS); pack.rotation.set(0, .5, 0); }
  gsap.to(pack.position, { x: 0, y: L.sealY, z: .25, duration: .85, ease: 'expo.out' });
  gsap.to(pack.rotation, { x: 0, y: 0, z: 0, duration: .85, ease: 'expo.out' });
  gsap.to(pack.scale, { x: L.sealS, y: L.sealS, z: L.sealS, duration: .85, ease: 'back.out(1.6)' });
  pack.userData.tiltX = pack.userData.tiltY = 0;
  gsap.to(backdrop.material.color, { ...rgb(set.c[1], .5), duration: .9, ease: 'power2.out', overwrite: true });
  // deal the cards now so the textures are ready by the time the pack is open
  hand = rollPack(set);
  cards = hand.map((c, i) => { const g = makeCard(c); g.visible = false; g.rotation.y = Math.PI; scene.add(g); return g; });
  $('pips').innerHTML = hand.map(() => '<i></i>').join('');
  setState('sealed');
  gsap.delayedCall(.55, () => { busy = false; });
}

// ---------------------------------------------------------------- tear
const tmpV = new THREE.Vector3();
function tearFront(p) {
  tmpV.set((tearDir > 0 ? p - .5 : .5 - p) * PW, (VC - .5) * PH, BULGE * .2);
  return pack.localToWorld(tmpV);
}
function setCut(p) {
  pack.userData.cut = p;
  peel(pack, p, tearDir);
  const f = tearFront(p);
  burst(f.x, f.y, f.z + .05, '#ffe2a8', 4, .9, { size: .016, decay: 2.2, spread: Math.PI * 1.2, dir: Math.PI / 2, gravity: 2.2 });
}
function autoCut(from) {
  busy = true; setState('tearing');
  gsap.to({ p: from }, { p: 1, duration: .42 * (1 - from) + .05, ease: 'power2.in', onUpdate() { setCut(this.targets()[0].p); }, onComplete: open });
}
function open() {
  busy = true; setState('opening');
  const d = pack.userData, wp = pack.position;
  pack.userData.tiltX = pack.userData.tiltY = 0;
  gsap.to(pack.rotation, { x: 0, y: 0, duration: .3 });
  // the strip flicks away
  gsap.to(d.strip.position, { x: tearDir * .9, y: 1.5, z: .5, duration: .7, ease: 'power2.out' });
  gsap.to(d.strip.rotation, { z: -tearDir * 2.2, x: 1.2, duration: .7, ease: 'power1.out', onComplete: () => { d.strip.visible = false; } });
  // light pours out of the mouth
  const PS = pack.scale.x, my = wp.y + (VC - .5) * PH * PS;
  mouth.position.set(wp.x, my, wp.z + .12); mouth.scale.set(.6 * PS, .3 * PS, 1);
  gsap.fromTo(mouth.material, { opacity: 0 }, { opacity: .95, duration: .18, ease: 'power2.out' });
  gsap.to(mouth.scale, { x: 2.6 * PS, y: 2.2 * PS, duration: .7, ease: 'expo.out' });
  gsap.to(mouth.material, { opacity: 0, duration: .9, delay: .45, ease: 'power2.out' });
  burst(wp.x, my, wp.z + .1, '#ffe2a8', 90, 1.9, { size: .024, rx: PW * .9 * PS, spread: Math.PI * .9, dir: Math.PI / 2, decay: .9, gravity: 1.5 });
  // cards wait inside, slide up through the mouth, then the pack falls away
  cards.forEach((g, i) => {
    g.visible = true; g.userData.moving = true;
    g.position.set(wp.x, wp.y - .04 * PS, wp.z - .004 * i - .002); g.rotation.set(0, Math.PI, 0); g.scale.setScalar(.96 * PS);
    gsap.to(g.position, { y: wp.y + (L.compact ? .2 : .36) * PS + (cards.length - i) * .012, duration: .6, delay: .12 + i * .035, ease: 'power3.out' });
  });
  gsap.to(wp, { y: -L.h - .4, duration: .7, delay: .5, ease: 'power2.in', onComplete: () => { pack.visible = false; } });
  gsap.to(pack.rotation, { z: -tearDir * .22, duration: .7, delay: .5, ease: 'power2.in' });
  cards.forEach((g, i) => {
    const t = .95 + i * .03;
    gsap.to(g.position, { x: (i - 2) * .006, y: L.cardY + i * .004, z: .2 - i * .012, duration: .7, delay: t, ease: 'expo.out' });
    gsap.to(g.scale, { x: L.cardS, y: L.cardS, z: L.cardS, duration: .7, delay: t, ease: 'back.out(1.4)' });
    gsap.to(g.rotation, { z: (i ? (Math.random() - .5) * .07 : 0), duration: .7, delay: t });
  });
  gsap.delayedCall(1.75, () => {
    setState('cards'); cur = -1; busy = false;
    cards.forEach(g => { g.userData.moving = false; });
    flip(0);
  });
}

// ---------------------------------------------------------------- reveal
function setAura(c, waiting) {
  gsap.killTweensOf(aura.material);
  if (!c || c.t < 3) { gsap.to(aura.material, { opacity: 0, duration: .3 }); return; }
  aura.material.color.set(AURA[c.t]);
  aura.position.set(0, L.cardY, -.25); aura.scale.set(2.5 * L.cardS, 2.8 * L.cardS, 1);
  if (waiting) gsap.fromTo(aura.material, { opacity: .08 }, { opacity: .34, duration: .8, ease: 'sine.inOut', yoyo: true, repeat: -1 });
  else gsap.to(aura.material, { opacity: c.t >= 5 ? .5 : .32, duration: .5 });
}
function doSway(amount = .7) {
  gsap.killTweensOf(sway);
  gsap.timeline().to(sway, { x: -amount, y: .25, duration: .5, ease: 'sine.inOut' }).to(sway, { x: amount, y: -.2, duration: .9, ease: 'sine.inOut' }).to(sway, { x: 0, y: 0, duration: .7, ease: 'sine.inOut' });
}
function flip(i) {
  cur = i; busy = true;
  const g = cards[i], c = hand[i], big = c.t >= 4, top = c.t >= 6;
  g.userData.moving = true;
  [...$('pips').children].forEach((p, k) => p.classList.toggle('on', k <= i));
  const tl = gsap.timeline({ onComplete() { g.userData.up = true; g.userData.moving = false; busy = false; if (c.t >= 3) doSway(); } });
  const S = L.cardS;
  if (big) {  // the card gathers itself before it turns
    tl.to(g.position, { z: L.upZ - .08, y: L.cardY + .02, duration: .4, ease: 'power2.out' }, 0)
      .to(g.scale, { x: S * .94, y: S * .94, z: S * .94, duration: .4, ease: 'power2.inOut' }, 0);
  }
  const t0 = big ? .4 : 0;
  tl.to(g.position, { x: 0, y: L.cardY, z: L.upZ, duration: .55, ease: 'power3.out' }, t0)
    .to(g.rotation, { y: 0, z: 0, x: 0, duration: big ? .75 : .6, ease: big ? 'back.out(1.9)' : 'back.out(1.25)' }, t0)
    .to(g.scale, { x: S * 1.03, y: S * 1.03, z: S * 1.03, duration: .6, ease: 'back.out(2)' }, t0);
  tl.call(() => {
    setAura(c, false);
    label.querySelector('.n').textContent = c.name;
    const r = label.querySelector('.r'); r.textContent = c.rarity; r.style.setProperty('--rc', AURA[c.t] || '');
    label.classList.add('show');
    if (c.t >= 3) {
      const col = AURA[c.t];
      burst(0, L.cardY, L.upZ + .1, col, top ? 260 : big ? 150 : 40, top ? 3.2 : big ? 2.4 : 1.3, { size: top ? .03 : .022, rx: CW * S, ry: CH * S, decay: top ? .55 : .8, gravity: .5 });
      if (big) {
        ring.material.color.set(col); ring.position.set(0, L.cardY, .2); ring.scale.set(.8, .8, 1);
        gsap.fromTo(ring.material, { opacity: .9 }, { opacity: 0, duration: .9, ease: 'power2.out' });
        gsap.to(ring.scale, { x: top ? 7 : 5, y: top ? 7 : 5, duration: .9, ease: 'expo.out' });
        gsap.fromTo(backdrop.material.color, rgb(col, .42), { ...rgb(col, .16), duration: 1.2, ease: 'power2.out', overwrite: true });
      }
    }
  }, null, t0 + (big ? .3 : .22));
}
function next() {
  if (busy || cur < 0) return;
  const g = cards[cur];
  if (!g.userData.up) { flip(cur); return; }                 // the last card waits for its own tap
  // send the open card down to the tray
  g.userData.moving = true; g.userData.up = false;
  gsap.killTweensOf(sway); sway.x = sway.y = 0;
  label.classList.remove('show'); setAura(null);
  const slot = L.tray(cur);
  gsap.to(g.position, { x: slot.x, y: slot.y, z: 0, duration: .55, ease: 'power3.inOut' });
  gsap.to(g.rotation, { x: 0, y: 0, z: 0, duration: .55, ease: 'power3.inOut' });
  gsap.to(g.scale, { x: L.trayS, y: L.trayS, z: L.trayS, duration: .55, ease: 'power3.inOut' });
  if (cur === hand.length - 1) { busy = true; gsap.delayedCall(.45, finish); return; }
  const n = cur + 1;
  if (n === hand.length - 1) {
    cur = n; busy = true;
    const h = cards[n];
    gsap.to(h.position, { x: 0, y: L.cardY, z: L.upZ - .1, duration: .5, ease: 'power3.out' });
    gsap.to(h.rotation, { z: 0, duration: .5 });
    gsap.delayedCall(.3, () => { setAura(hand[n], true); busy = false; });
  } else {
    gsap.delayedCall(.12, () => flip(n));
  }
}
function resultSlots() {
  const n = hand.length, wide = L.w / L.h > 1.05, gap = .045;
  const rows = wide ? [n] : [3, n - 3];
  const s = Math.min((L.w * .9) / (rows[0] * CW + (rows[0] - 1) * gap), (L.h * (L.compact ? .58 : wide ? .46 : .56)) / (rows.length * CH + (rows.length - 1) * gap));
  const out = []; let y0 = (rows.length - 1) * (CH + gap) * s / 2 + (wide ? 0 : .02);
  for (const cnt of rows) {
    for (let k = 0; k < cnt; k++) out.push({ x: (k - (cnt - 1) / 2) * (CW + gap) * s, y: y0, s });
    y0 -= (CH + gap) * s;
  }
  return out;
}
function finish() {
  setState('result');
  const best = hand.reduce((a, b) => (b.t > a.t ? b : a));
  $('bestName').textContent = best.name; $('bestRar').textContent = best.rarity;
  $('bestRar').style.color = AURA[best.t] || '';
  const text = `Pulled ${best.name} (${best.rarity}) from a free ${set.name} rip`;
  $('share').href = 'https://x.com/intent/post?text=' + encodeURIComponent(text) + '&url=' + encodeURIComponent(location.href.split(/[?#]/)[0]);
  const slots = resultSlots();
  cards.forEach((g, i) => {
    const s = slots[i]; g.userData.moving = true;
    gsap.to(g.position, { x: s.x, y: s.y, z: 0, duration: .8, delay: i * .06, ease: 'expo.out' });
    gsap.to(g.scale, { x: s.s, y: s.s, z: s.s, duration: .8, delay: i * .06, ease: 'back.out(1.5)', onComplete: () => { g.userData.moving = false; g.userData.up = true; } });
  });
  if (best.t >= 4) gsap.delayedCall(.5, () => { const s = slots[hand.indexOf(best)]; burst(s.x, s.y, .2, AURA[best.t], 90, 1.8, { size: .022, rx: CW * s.s, ry: CH * s.s, gravity: .4, decay: .7 }); });
  gsap.delayedCall(.7, () => { doSway(.55); busy = false; });
}

// ================================================================ input
let down = null;
const unitsX = e => (e.clientX - innerWidth / 2) / L.u;
canvas.addEventListener('pointerdown', e => {
  down = { x: e.clientX, y: e.clientY, moved: false, scroll, cut: pack ? pack.userData.cut || 0 : 0 };
  if (state === 'sealed') tearDir = unitsX(e) > 0 ? -1 : 1;
});
addEventListener('pointermove', e => {
  ptr.x = clamp((e.clientX / innerWidth - .5) * 2, -1, 1); ptr.y = clamp((e.clientY / innerHeight - .5) * 2, -1, 1);
  if (!down) return;
  const dx = e.clientX - down.x, dy = e.clientY - down.y;
  if (Math.abs(dx) > 7 || Math.abs(dy) > 7) down.moved = true;
  if (state === 'shelf' && down.moved) {
    if (scrollTw) scrollTw.kill();
    scroll = clamp(down.scroll - dx / (L.u * .8), -.35, SETS.length - .65);
  }
  if (state === 'sealed' && down.moved && !busy && Math.abs(dx) > Math.abs(dy)) {
    const p = clamp(Math.abs(dx) / (PW * L.u) * 1.1, 0, 1);
    setCut(p);
    if (p >= 1) { down = null; open(); }
  }
});
addEventListener('pointerup', e => {
  const d = down; down = null;
  if (!d) return;
  if (state === 'shelf') {
    if (d.moved) { select(Math.round(scroll)); return; }
    const x = unitsX(e);
    if (Math.abs(x) < .34) choose(); else select(sel + Math.sign(x));
    return;
  }
  if (state === 'sealed' && !busy) {
    const p = pack.userData.cut || 0;
    if (d.moved && p < .3) { gsap.to({ p }, { p: 0, duration: .25, onUpdate() { peel(pack, this.targets()[0].p, tearDir); pack.userData.cut = this.targets()[0].p; } }); return; }
    autoCut(d.moved ? p : 0);
    return;
  }
  if (state === 'cards' && !d.moved) next();
});
addEventListener('keydown', e => {
  if (state === 'shelf' && e.code === 'ArrowLeft') return select(sel - 1);
  if (state === 'shelf' && e.code === 'ArrowRight') return select(sel + 1);
  if (e.code !== 'Space' && e.code !== 'Enter') return;
  e.preventDefault();
  if (state === 'shelf') choose();
  else if (state === 'sealed' && !busy) autoCut(0);
  else if (state === 'cards') next();
  else if (state === 'result' && !busy) choose();
});
$('open').addEventListener('click', choose);
$('prev').addEventListener('click', () => select(sel - 1));
$('next').addEventListener('click', () => select(sel + 1));
$('again').addEventListener('click', () => { if (!busy) choose(); });
$('change').addEventListener('click', () => { if (!busy) toShelf(); });

// ================================================================ loop
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), .05), k = 1 - Math.pow(.0015, dt);
  const tx = clamp(ptr.x + sway.x, -1, 1), ty = clamp(ptr.y + sway.y, -1, 1);
  if (state === 'shelf') {
    const p = SETS[sel].pack;
    if (p) { p.userData.tiltY = lerp(p.userData.tiltY, ptr.x * .32, k); p.userData.tiltX = lerp(p.userData.tiltX, ptr.y * .2, k); }
    layoutShelf();
  }
  if (state === 'sealed' && pack && !busy) {
    pack.rotation.y = lerp(pack.rotation.y, ptr.x * .3, k); pack.rotation.x = lerp(pack.rotation.x, ptr.y * .18, k);
  }
  if (state === 'cards' && cur >= 0) {
    const g = cards[cur];
    if (g.userData.up && !g.userData.moving) { g.rotation.y = lerp(g.rotation.y, tx * .42, k); g.rotation.x = lerp(g.rotation.x, ty * .3, k); }
  }
  if (state === 'result') {
    for (const g of cards) if (!g.userData.moving) { g.rotation.y = lerp(g.rotation.y, tx * .34, k); g.rotation.x = lerp(g.rotation.x, ty * .22, k); }
  }
  sparks.material.uniforms.uPx.value = renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)));
  stepSparks(dt);
  composer.render();
  requestAnimationFrame(frame);
}

// ================================================================ boot
addEventListener('resize', resize); resize();
$('dots').innerHTML = SETS.map(() => '<i></i>').join('');
(async () => {
  const backImg = await loadImage('cardback.png');
  backTex = new THREE.Texture(backImg); backTex.colorSpace = THREE.SRGBColorSpace; backTex.anisotropy = MAXA; backTex.needsUpdate = true;
  await Promise.all(SETS.map(async s => {
    const [hero, logo] = await Promise.all([
      loadImage(cardUrls(s.cards.find(c => c.n === s.hero)).reverse()),      // the big PNG first: it is the print on the pack
      loadImage(`https://images.pokemontcg.io/${s.id}/logo.png`),
    ]);
    s.pack = makePack(s, hero, logo); s.pack.userData.held = false; scene.add(s.pack);
  }));
  try { await document.fonts.ready; } catch (e) {}
  setState('shelf'); shelfUI(); layoutShelf();
  for (const s of SETS) { s.pack.userData.held = true; gsap.from(s.pack.position, { y: -2.4, duration: 1.1, ease: 'expo.out', delay: .08 * SETS.indexOf(s), onComplete() { s.pack.userData.held = false; } }); }
  requestAnimationFrame(frame);
})();
