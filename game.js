'use strict';
/* Dino Rush — a colour endless runner (portrait).
   Backgrounds: CraftPix "Free Desert Scrolling 2D Game Backgrounds".
   Dinos: spritesheets built by tools/slice.py into assets/dinos/. */

const W = 540, H = 960, GROUND = 790;
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

function fitCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = W * dpr; canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
fitCanvas();
window.addEventListener('resize', fitCanvas);

// --------------------------------------------------------------- helpers ---
const rand = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const wrap = (x, tile) => ((x % tile) + tile) % tile;
const ready = im => im && im.complete && im.naturalWidth > 0;

function loadImage(src) {                    // retries if a request drops
  const im = new Image(); let tries = 0;
  im.onerror = () => { if (tries++ < 2) setTimeout(() => { im.src = src + '?r=' + tries; }, 400); };
  im.src = src; return im;
}
function rr(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
function ellipse(x, y, rx, ry, rot = 0) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); }
function paint(fill, stroke = '#2b2b2b', lw = 2.5) {
  ctx.fillStyle = fill; ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.stroke(); }
}

// ----------------------------------------------------------------- audio ---
let audio = null, muted = false;
function beep(freq, dur = 0.08, type = 'square', vol = 0.06, slide = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime;
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(audio.destination); o.start(t); o.stop(t + dur);
  } catch (e) { /* audio unavailable */ }
}

// ------------------------------------------------------------ background ---
// Each scene has 5 layers (1 = sky ... 5 = ground strip), 1920x1080, tileable.
// `surf` is the y of the walking surface inside the source image.
const BG_DIR = 'assets/craftpix-desert/_PNG/';
const BG_SCALE = 0.8;
// Scroll speed of each layer as a fraction of ground speed. Where the plants and
// rocks (layer 4) stand on the sand (layer 3) the two must move together, or
// the objects slide across the ground they cast shadows on.
const ON_SAND = [0.03, 0.1, 0.45, 0.45, 1];
const SCENES = [
  { set: 4, surf: 965, dust: '246,226,170', speeds: ON_SAND },
  { set: 2, surf: 994, dust: '226,214,170', speeds: ON_SAND },
  { set: 1, surf: 984, dust: '236,206,190', speeds: [0.03, 0.1, 0.25, 0.5, 1] },   // separate hills + foreground rocks
  { set: 3, surf: 969, dust: '238,200,150', speeds: ON_SAND },
].map(s => ({ ...s, layers: [1, 2, 3, 4, 5].map(n => loadImage(`${BG_DIR}${s.set}/${n}.png`)) }));
const SCENE_EVERY = 300;                     // points between scene changes

// Rolling terrain: height of the ground above the GROUND baseline at a world x.
const terrain = wx => 18 * Math.sin(wx / 115) + 7 * Math.sin(wx / 61 + 1.3) + 5 * Math.sin(wx / 290 + 4);
const hAt = sx => terrain(scroll + sx);                 // same, for a screen x
const slopeAt = sx => (hAt(sx + 12) - hAt(sx - 12)) / 24;

// The ground strip image is flat, so draw it in thin vertical slices, each
// shifted to follow the terrain, and fill below it down to the bottom edge.
function drawGroundStrip(im, x, dy, w, h) {
  const SL = 4, sy = 900, sh = im.naturalHeight - sy;
  for (let sx = Math.max(x, 0); sx < Math.min(x + w, W); sx += SL) {
    const off = hAt(sx + SL / 2);
    const srcX = Math.min((sx - x) / BG_SCALE, im.naturalWidth - 1);
    const srcW = Math.min(SL / BG_SCALE, im.naturalWidth - srcX);
    ctx.drawImage(im, srcX, sy, srcW, sh, sx, dy + sy * BG_SCALE - off, SL + 0.5, sh * BG_SCALE);
    ctx.drawImage(im, srcX, im.naturalHeight - 3, srcW, 2, sx, dy + h - off - 1, SL + 0.5, H - (dy + h - off) + 2);
  }
}

function drawScene(sc, scroll, alpha) {
  ctx.globalAlpha = alpha;
  const dy = GROUND - sc.surf * BG_SCALE;
  sc.layers.forEach((im, i) => {
    if (!ready(im)) return;
    const w = im.naturalWidth * BG_SCALE, h = im.naturalHeight * BG_SCALE;
    for (let x = -wrap(scroll * sc.speeds[i], w); x < W; x += w) {
      if (i === 4) { drawGroundStrip(im, x, dy, w, h); continue; }
      ctx.drawImage(im, x, dy, w + 1, h);
      if (i === 0 && dy > 0)                                        // extend sky to the top edge
        ctx.drawImage(im, 0, 0, im.naturalWidth, 2, x, 0, w + 1, dy + 1);
    }
  });
  ctx.globalAlpha = 1;
}

// ------------------------------------------------------------- particles ---
let particles = [];
const streaks = Array.from({ length: 12 }, () => ({
  x: rand(0, W), y: rand(380, GROUND + 40), len: rand(30, 90), v: rand(120, 320), a: rand(0.15, 0.35),
}));

function puff(x, y, n, spread, back) {       // soft dust clouds
  for (let i = 0; i < n; i++) particles.push({
    kind: 'puff', x: x + rand(-6, 6), y: y + rand(-4, 2),
    vx: rand(-spread, spread) - back, vy: -rand(15, 70),
    r: rand(5, 11), grow: rand(16, 34), life: 0, max: rand(0.4, 0.8),
  });
}
function grains(x, y, n, power, back) {      // kicked-up sand that falls back down
  for (let i = 0; i < n; i++) particles.push({
    kind: 'grain', x, y, vx: rand(-power, power * 0.3) - back, vy: -rand(power * 0.6, power * 1.6),
    r: rand(1.5, 3.2), life: 0, max: rand(0.3, 0.6),
  });
}

function updateParticles(dt) {
  for (const p of particles) {
    p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.kind === 'grain') { p.vy += 900 * dt; if (p.y > GROUND - hAt(p.x) + 4) p.life = p.max; }
    else { p.vy *= 1 - 2.5 * dt; p.r += p.grow * dt; }
  }
  particles = particles.filter(p => p.life < p.max);
  const wind = state === 'playing' ? speed : 60;
  for (const s of streaks) {
    s.x -= (wind * 0.9 + s.v) * dt;
    if (s.x + s.len < 0) { s.x = W + rand(0, 200); s.y = rand(380, GROUND + 40); }
  }
}

function drawParticles(rgb) {
  for (const p of particles) {
    const t = p.life / p.max;
    if (p.kind === 'puff') {
      const a = 0.85 * (1 - t) ** 1.5;
      ellipse(p.x, p.y, p.r, p.r * 0.8);
      ctx.fillStyle = `rgba(${rgb},${a})`; ctx.fill();
      ctx.strokeStyle = `rgba(150,105,55,${a * 0.6})`; ctx.lineWidth = 1.5; ctx.stroke();
    } else {
      ctx.fillStyle = p.col || `rgba(165,115,60,${1 - t * 0.5})`; ellipse(p.x, p.y, p.r, p.r); ctx.fill();
    }
  }
}
function drawStreaks(rgb) {                  // wind-blown sand across the scene
  ctx.lineCap = 'round'; ctx.lineWidth = 2;
  for (const s of streaks) {
    const g = ctx.createLinearGradient(s.x, 0, s.x + s.len, 0);
    g.addColorStop(0, `rgba(${rgb},${s.a})`); g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.strokeStyle = g; ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x + s.len, s.y); ctx.stroke();
  }
}

// ------------------------------------------------------------------ dino ---
const dino = { x: 60, y: 0, vy: 0, onGround: true, ducking: false, dead: false };
const DINO_H = 88;                           // on-screen standing height
const FEET_X = 44;                           // feet position relative to dino.x

const DINO_LIST = [                             // in unlock order (see UNLOCKS in progress.js)
  { id: 'rex', label: 'REX' }, { id: 'crest', label: 'CREST' }, { id: 'bonehead', label: 'BONEHEAD' },
  { id: 'sail', label: 'SAIL', h: 80 },
  { id: 'tank', label: 'TANK', h: 62 },                      // long, low bodies are drawn shorter
  { id: 'dragon', label: 'DRAGON', flies: true, h: 98 },     // flies for as long as jump is held
  { id: 'spino', label: 'SPINO', h: 70 },
  // still: one full-size picture, animated by hand in drawDino. flip: the art faces left.
  { id: 'raptor', label: 'RAPTOR', still: true }, { id: 'trike', label: 'TRIKE', still: true, flip: true, h: 72 },
  { id: 'stego', label: 'STEGO', still: true, h: 76 },
].filter(d => window.DINOS && window.DINOS[d.id]);       // only dinos whose spritesheet has been built
const canFly = () => !!(DINO_LIST[selected] && DINO_LIST[selected].flies);
const FLY_CEILING = 560;                                 // max height above the ground while flying
for (const d of DINO_LIST) {
  d.meta = window.DINOS[d.id];
  d.sheet = loadImage(`assets/dinos/${d.id}.png`);
  d.portrait = loadImage(`assets/dinos/${d.id}_portrait.png`);
}
let selected = Math.max(0, DINO_LIST.findIndex(d => d.id === save.dino));
function selectDino(i) {
  selected = (i + DINO_LIST.length) % DINO_LIST.length;
  const id = DINO_LIST[selected].id;
  if (owns(id)) { save.dino = id; persist(); }             // only an owned dino is remembered
  beep(660, 0.05, 'triangle', 0.05);
}

function dinoBox() {
  return dino.ducking && dino.onGround
    ? { x: dino.x + 4, y: GROUND - dino.y - 42, w: 84, h: 40 }
    : { x: dino.x + 18, y: GROUND - dino.y - 76, w: 44, h: 74 };
}

function drawDino(time) {
  const d = DINO_LIST[selected];
  const gh = hAt(dino.x + FEET_X), air = Math.max(0, dino.y - gh);
  const tilt = dino.onGround ? -Math.atan(slopeAt(dino.x + FEET_X)) * 0.8 : 0;   // lean with the slope
  ctx.fillStyle = 'rgba(0,0,0,.2)';
  ellipse(dino.x + FEET_X, GROUND - gh + 5, 38 - Math.min(air, 140) * 0.12, 7, tilt); ctx.fill();
  if (!d || !ready(d.sheet)) return;
  const a = d.meta.anims, [cw, ch] = d.meta.cell, S = (d.h || DINO_H) / d.meta.stand;
  let frames, i;
  if (dino.dead) { frames = a.dead; i = Math.min(frames.length - 1, Math.floor((time - overAt) * 10)); }
  else if (d.flies) {
    frames = dino.ducking && state === 'playing' ? a.duck : (a.fly || a.idle);
    i = Math.floor(time * 14) % frames.length;
  }
  else if (state === 'ready') { frames = a.idle; i = Math.floor(time * 6) % frames.length; }
  else if (!dino.onGround) {
    frames = a.jump;
    i = dino.vy > 250 ? 0 : dino.vy < -250 ? frames.length - 1 : Math.floor((frames.length - 1) / 2);
  }
  else if (dino.ducking) { frames = a.duck; i = Math.floor(scroll / 30) % frames.length; }
  else { frames = a.run; i = Math.floor(scroll / 26) % frames.length; }
  const n = frames[i];
  ctx.imageSmoothingQuality = 'high';
  ctx.save();
  // Dinos with a single still picture are moved by hand instead of by frames:
  // a rocking bob while running, a lean in the air, a squash for the slide,
  // and a roll onto the back when knocked out.
  let rot = tilt, sx = d.flip ? -1 : 1, sy = 1, lift = 0, roll = 0;
  if (dino.dead && (d.still || d.flies)) roll = Math.min(1, (time - overAt) * 4) * Math.PI;
  else if (d.flies) {                                       // nose up while climbing, hover just off the ground
    rot = Math.max(-0.35, Math.min(0.45, -dino.vy * 0.0007));
    lift = dino.onGround ? 18 + Math.sin(time * 5) * 4 : 0;
  }
  else if (d.still) {
    const ph = scroll / 26;
    if (!dino.onGround) rot += dino.vy > 0 ? -0.22 : 0.16;
    else if (dino.ducking) { sx *= 1.12; sy = 0.6; lift = Math.abs(Math.sin(ph * 2)) * 1.5; }
    else if (state === 'playing') { lift = Math.abs(Math.sin(ph)) * 6; rot += Math.sin(ph) * 0.07; sy = 1 - Math.abs(Math.cos(ph)) * 0.04; }
    else sy = 1 + Math.sin(time * 3) * 0.02;
  }
  ctx.translate(dino.x + FEET_X, GROUND - dino.y - lift);
  ctx.rotate(rot);
  if (roll) { const mid = (d.h || DINO_H) / 2; ctx.translate(0, -mid); ctx.rotate(roll); ctx.translate(0, mid); }
  ctx.scale(sx, sy);
  ctx.drawImage(d.sheet, (n % d.meta.cols) * cw, Math.floor(n / d.meta.cols) * ch, cw, ch,
    d.meta.head ? 44 - cw * S : -cw * S / 2,
    d.meta.head ? -d.meta.head * S - 40 : -(ch - d.meta.pad) * S + 5, cw * S, ch * S);
  ctx.restore();
  if (shield && !dino.dead && state === 'playing') {        // shield bubble
    const b = dinoBox();
    ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2 + 24, b.h / 2 + 16);
    ctx.fillStyle = 'rgba(120,200,255,.18)'; ctx.fill();
    ctx.strokeStyle = `rgba(120,210,255,${0.6 + 0.3 * Math.sin(time * 8)})`; ctx.lineWidth = 3; ctx.stroke();
  }
}

// ------------------------------------------------------------- obstacles ---
let obstacles = [];

function makeCactus(x) {
  const n = pick([1, 1, 1, 2, 2, 3]);
  const parts = []; let w = 0;
  for (let i = 0; i < n; i++) {
    const tall = Math.random() < 0.45 && n < 3;
    const pw = tall ? 34 : 28, ph = tall ? rand(64, 76) : rand(42, 54);
    parts.push({ dx: w, w: pw, h: ph, flip: Math.random() < 0.5, flower: Math.random() < 0.4 });
    w += pw - 4;
  }
  w += 4;
  const h = Math.max(...parts.map(p => p.h));
  return { kind: 'cactus', x, y: GROUND - h, w, h, parts };
}
function makeBird(x) {
  // runners: low = jump · mid = duck · high = run under.  flyers meet them at every height
  const lift = canFly() ? pick([8, 50, 110, 180, 250, 320, 400, 480]) : pick([8, 50, 50, 100]);
  const foe = Math.floor(Math.random() * FOES.length);
  return { kind: 'bird', foe, x, y: GROUND - lift - 32, w: (FOES[foe] && FOES[foe].w) || 62, h: 32, extra: rand(20, 70), phase: rand(0, 6) };
}

function drawCactus(o) {
  ctx.fillStyle = 'rgba(0,0,0,.18)'; ellipse(o.x + o.w / 2, GROUND + 4, o.w / 2 + 8, 5); ctx.fill();
  for (const p of o.parts) {
    const x = o.x + p.dx, cx = x + p.w / 2, top = GROUND - p.h, tw = p.w * 0.46;
    const arm = (side, ay, ah) => {
      const ax = cx + side * (tw / 2 + 7);
      rr(Math.min(cx, ax) - 1, ay + ah - 8, Math.abs(ax - cx) + 2, 9, 4); paint('#3f9e4d');
      rr(ax - 4.5, ay, 9, ah, 4.5); paint('#3f9e4d');
    };
    const s = p.flip ? -1 : 1;
    arm(s, top + p.h * 0.28, p.h * 0.28);
    arm(-s, top + p.h * 0.45, p.h * 0.22);
    rr(cx - tw / 2, top, tw, p.h + 3, tw / 2); paint('#4cb85a');
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx - 2, top + 10); ctx.lineTo(cx - 2, GROUND - 6); ctx.stroke();
    if (p.flower) { ellipse(cx, top - 1, 5, 5); paint('#ff5fa2', '#2b2b2b', 2); }
  }
}
// Flying enemies from assets/dinos/foe_*.png (built by tools/slice.py).
// h = drawn height, flip = the art faces right so mirror it to face the dino.
const FOES = [
  { sheet: 'bats', anim: 'pink', h: 56, fps: 12 },
  { sheet: 'bats', anim: 'yellow', h: 56, fps: 12 },
  { sheet: 'ptero', anim: 'fly', h: 72, fps: 5, flip: true },
  { sheet: 'wings', anim: 'teal', h: 64, fps: 10, flip: true },
  { sheet: 'wings', anim: 'purple', h: 64, fps: 10, flip: true },
  { sheet: 'beaks', anim: 'purple', h: 60, w: 100, fps: 1, sway: true },     // single still pictures: they
  { sheet: 'beaks', anim: 'red', h: 60, w: 100, fps: 1, sway: true },        // tilt and bob instead of flapping
].filter(f => window.ENEMIES && window.ENEMIES[f.sheet]);
const foeSheets = {};
for (const f of FOES) {
  f.meta = window.ENEMIES[f.sheet];
  f.img = foeSheets[f.sheet] = foeSheets[f.sheet] || loadImage(`assets/dinos/foe_${f.sheet}.png`);
}

function drawFoe(o, time) {
  const f = FOES[o.foe];
  if (!f || !ready(f.img)) return false;
  const frames = f.meta.anims[f.anim], [cw, ch] = f.meta.cell, S = f.h / ch;
  const n = frames[Math.floor(time * f.fps + o.phase) % frames.length];
  ctx.save();
  ctx.translate(o.x + o.w / 2, o.y + o.h / 2 + Math.sin(time * 5 + o.phase) * 3);   // gentle bob
  if (f.flip) ctx.scale(-1, 1);
  if (f.sway) { ctx.rotate(Math.sin(time * 5 + o.phase) * 0.1); ctx.scale(1, 1 + Math.sin(time * 9 + o.phase) * 0.06); }
  ctx.drawImage(f.img, (n % f.meta.cols) * cw, Math.floor(n / f.meta.cols) * ch, cw, ch,
    -cw * S / 2, -ch * S / 2, cw * S, ch * S);
  ctx.restore();
  return true;
}

function drawBird(o, time) {
  if (drawFoe(o, time)) return;
  const flap = Math.sin(time * 14 + o.phase);
  const cx = o.x + 32, cy = o.y + 18;
  ctx.beginPath(); ctx.moveTo(cx - 10, cy - 2); ctx.lineTo(cx + 10, cy - 2);
  ctx.lineTo(cx + 6, cy - 2 - flap * 26); ctx.closePath(); paint('#8a5bd6');
  ellipse(cx, cy, 20, 10); paint('#a877f0');
  ellipse(cx - 20, cy - 4, 9, 8); paint('#a877f0');
  ctx.beginPath(); ctx.moveTo(cx - 27, cy - 7); ctx.lineTo(cx - 44, cy - 1); ctx.lineTo(cx - 27, cy);
  ctx.closePath(); paint('#ffb43c');
  ctx.beginPath(); ctx.moveTo(cx - 16, cy - 10); ctx.lineTo(cx - 4, cy - 18); ctx.lineTo(cx - 12, cy - 6);
  ctx.closePath(); paint('#ff6b5e', '#2b2b2b', 2);
  ellipse(cx - 22, cy - 6, 2, 2); ctx.fillStyle = '#2b2b2b'; ctx.fill();
  ctx.beginPath(); ctx.moveTo(cx + 18, cy - 3); ctx.lineTo(cx + 32, cy); ctx.lineTo(cx + 18, cy + 4);
  ctx.closePath(); paint('#8a5bd6');
}
const obstacleLift = o => hAt(o.x + o.w / 2);            // obstacles sit on / fly over the local ground
function obstacleBox(o) {
  const up = obstacleLift(o);
  return o.kind === 'cactus'
    ? { x: o.x + 5, y: o.y + 6 - up, w: o.w - 10, h: o.h - 6 }
    : { x: o.x + 4, y: o.y + 8 - up, w: o.w - 10, h: o.h - 12 };
}
const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

// ------------------------------------------------------------ game state ---
const START_SPEED = 300, MAX_SPEED = 600, GRAVITY = 2600, JUMP_V = 900;
let state = 'ready';            // ready | playing | over
let speed, scroll = 0, score, nextGap, time = 0, overAt = 0, flash = 0, dustClock = 0;
let scene = 0, prevScene = 0, sceneBase = 0, sceneFade = 1;
// things to pick up during a run, and what this run has earned so far
let pickups = [], runCoins = 0, runEggs = 0, nextEggAt = 0, nextPowerAt = 0;
let shield = false, magnetT = 0, invulnT = 0;
let summary = null;                            // rewards of the last run, for the game-over screen
let toast = null;                              // { msg, until }: a short message on the menu
const bag = { hatchAt: 0, result: null };      // inventory screen
const say = (msg, secs = 2.4) => { toast = { msg, until: time + secs }; };
const inRect = (c, x, y) => x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h;

function reset() {
  speed = START_SPEED; score = 0; nextGap = 420; flash = 0; sceneBase = scene;
  obstacles = []; particles = []; pickups = [];
  runCoins = 0; runEggs = 0; nextEggAt = rand(70, 130); nextPowerAt = rand(140, 220);
  shield = false; magnetT = 0; invulnT = 0; summary = null;
  Object.assign(dino, { y: 0, vy: 0, onGround: true, ducking: false, dead: false });
}
reset();

const keys = { jump: false, duck: false };
const HOLD_MS = 150;                           // touch longer than this = slide, shorter = jump
let holdTimer = 0, touching = false, sliding = false, tapJump = false;
const feet = () => [dino.x + FEET_X - 10, GROUND - dino.y + 2];
const feetH = () => hAt(dino.x + FEET_X);

/** Starting needs an unlocked dino; tapping a locked one tries to buy it instead. */
function tryStart() {
  const d = DINO_LIST[selected];
  if (owns(d.id)) { state = 'playing'; return true; }
  const check = buyCheck(d.id);
  if (check.ok && buy(d.id)) {
    save.dino = d.id; persist();
    say(`${d.label} unlocked!`);
    beep(660, 0.1, 'triangle', 0.07); setTimeout(() => beep(990, 0.18, 'triangle', 0.07), 110);
  } else {
    say(check.why); beep(160, 0.15, 'square', 0.05);
  }
  return false;
}

function pressJump() {
  if (state === 'bag') return;
  if (state === 'ready') { if (!tryStart()) return; }
  else if (state === 'over') { if (time - overAt > 0.45) { reset(); state = 'playing'; } return; }
  if (dino.onGround) {
    dino.vy = canFly() ? 420 : JUMP_V; dino.onGround = false; dino.ducking = false;
    puff(...feet(), 7, 60, speed * 0.3); grains(...feet(), 10, 150, speed * 0.3);
    beep(520, 0.12, 'square', 0.05, 260);
  }
}

function update(dt) {
  time += dt;
  updateParticles(dt);
  sceneFade = Math.min(1, sceneFade + dt / 1.5);
  carPos = drag
    ? Math.max(-0.35, Math.min(DINO_LIST.length - 0.65, selected - drag.dx / CAR.gap))   // follows the finger
    : carPos + (selected - carPos) * Math.min(1, dt * 14);                                // eases to the choice
  if (bag.hatchAt && time - bag.hatchAt > 1.1) finishHatch();
  if (dino.onGround) dino.y = feetH();                      // dino.y = height above the baseline
  if (state !== 'playing') return;

  speed = Math.min(MAX_SPEED, speed + 4 * dt);
  scroll += speed * dt;
  const before = Math.floor(score / 100);
  score += speed * dt * 0.025;
  if (Math.floor(score / 100) > before) {
    flash = 1; beep(880, 0.09, 'triangle', 0.07); setTimeout(() => beep(1175, 0.14, 'triangle', 0.07), 90);
  }
  flash = Math.max(0, flash - dt * 1.2);
  magnetT = Math.max(0, magnetT - dt); invulnT = Math.max(0, invulnT - dt);

  const target = (sceneBase + Math.floor(score / SCENE_EVERY)) % SCENES.length;
  if (target !== scene) { prevScene = scene; scene = target; sceneFade = 0; }

  // dino physics
  dino.ducking = keys.duck;
  if (!dino.onGround) {
    if (canFly()) {
      // hold to climb, release to glide down, duck to dive
      if (keys.duck) dino.vy -= GRAVITY * 2.4 * dt;
      else if (keys.jump) dino.vy = Math.min(300, dino.vy + 1800 * dt);
      else dino.vy = Math.max(-420, dino.vy - 1300 * dt);
    } else {
      if (!keys.jump && dino.vy > 330) dino.vy = 330;     // short hop on early release
      dino.vy -= GRAVITY * (keys.duck ? 2.4 : 1) * dt;      // fast fall while holding duck
    }
    dino.y += dino.vy * dt;
    const ceiling = feetH() + FLY_CEILING;
    if (dino.y > ceiling) { dino.y = ceiling; dino.vy = Math.min(dino.vy, 0); }
    if (dino.y <= feetH()) {
      dino.y = feetH(); dino.vy = 0; dino.onGround = true;
      if (tapJump) { tapJump = false; keys.jump = false; }
      puff(...feet(), 10, 110, speed * 0.25); grains(...feet(), 12, 170, speed * 0.3);
    }
  } else {
    dino.y = feetH();
    // sand kicked up by running (more while sliding low)
    dustClock -= dt;
    if (dustClock <= 0) {
      dustClock = dino.ducking ? 0.03 : 0.05;
      puff(...feet(), dino.ducking ? 2 : 1, 25, speed * 0.35);
      grains(...feet(), dino.ducking ? 3 : 2, 90 + speed * 0.12, speed * 0.4);
    }
  }

  // spawn
  nextGap -= speed * dt;
  if (nextGap <= 0) {
    const bird = canFly() ? Math.random() < 0.6 : score > 200 && Math.random() < 0.25;
    const o = bird ? makeBird(W + 40) : makeCactus(W + 40);
    obstacles.push(o);
    const gap = speed * 0.85 + 110 + rand(0, speed * 0.9);
    nextGap = o.w + gap;
    spawnPickups(o, gap);
  }

  // move + collide
  const db = dinoBox();
  for (const o of obstacles) {
    o.x -= (speed + (o.extra || 0)) * dt;
    if (invulnT <= 0 && hit(db, obstacleBox(o))) {
      if (!shield) { gameOver(); break; }
      shield = false; invulnT = 1; o.gone = true;            // the shield takes the hit and breaks
      puff(o.x + o.w / 2, o.y - obstacleLift(o) + o.h / 2, 14, 150, 0);
      beep(300, 0.2, 'square', 0.06, 240);
    }
  }
  obstacles = obstacles.filter(o => !o.gone && o.x + o.w > -60);
  if (state !== 'playing') return;

  // pickups: move with the ground, drift to the dino under a magnet, collect on touch
  const cxd = db.x + db.w / 2, cyd = db.y + db.h / 2;
  for (const p of pickups) {
    p.x -= speed * dt;
    let py = GROUND - hAt(p.x) - p.alt;
    if (magnetT > 0 && p.kind === 'coin') {
      const dx = cxd - p.x, dy = cyd - py, dd = Math.hypot(dx, dy) || 1;
      if (dd < 200) { p.x += dx / dd * 560 * dt; p.alt -= dy / dd * 560 * dt; py = GROUND - hAt(p.x) - p.alt; }
    }
    if (p.x > db.x - 18 && p.x < db.x + db.w + 18 && py > db.y - 18 && py < db.y + db.h + 18) collect(p, py);
  }
  pickups = pickups.filter(p => !p.got && p.x > -40);
}

function gameOver() {
  state = 'over'; overAt = time; dino.dead = true;
  puff(dino.x + FEET_X, GROUND - dino.y, 16, 160, 0); grains(dino.x + FEET_X, GROUND - dino.y, 18, 220, 0);
  beep(220, 0.35, 'sawtooth', 0.07, -160);
  // bank what the run earned: coins and eggs are kept, score and coins become XP
  const xp = Math.floor(score) + runCoins * 2;
  const newBest = score > save.best;
  if (newBest) save.best = Math.floor(score);
  save.coins += runCoins; save.eggs += runEggs; save.runs++;
  const ups = addXp(xp);                                    // also saves
  summary = { coins: runCoins, eggs: runEggs, xp, ups, newBest };
  runCoins = 0; runEggs = 0;
  if (ups.length) setTimeout(() => { beep(784, 0.1, 'triangle', 0.07); setTimeout(() => beep(1175, 0.22, 'triangle', 0.07), 120); }, 500);
}
function toMenu() { reset(); state = 'ready'; }

// --------------------------------------------------------------- pickups ---
function spawnPickups(o, gap) {
  const cx = o.x + o.w / 2, after = o.x + o.w;
  if (canFly()) {                                           // a wavy line of coins through the sky
    const base = rand(140, 380), amp = rand(30, 80);
    for (let k = 0; k < 6; k++) pickups.push({ kind: 'coin', x: after + 90 + k * 38, alt: base + Math.sin(k * 0.9) * amp });
  } else {
    if (o.kind === 'cactus' && Math.random() < 0.65)        // an arc that a jump over the cactus sweeps up
      [100, 140, 152, 140, 100].forEach((alt, k) => pickups.push({ kind: 'coin', x: cx + (k - 2) * 34, alt }));
    if (gap > 330 && Math.random() < 0.6) {                 // a row along the ground in a long gap
      const n = 3 + Math.floor(rand(0, 3));
      for (let k = 0; k < n; k++) pickups.push({ kind: 'coin', x: after + 130 + k * 34, alt: 26 });
    }
  }
  // now and then something special floats mid-gap, a hop above head height
  let special = null;
  if (score >= nextEggAt) { nextEggAt = score + rand(140, 240); special = 'egg'; }
  else if (score >= nextPowerAt) { nextPowerAt = score + rand(220, 340); special = pick(['shield', 'magnet']); }
  if (special) pickups.push({ kind: special, x: after + gap * 0.55, alt: canFly() ? rand(150, 400) : 98 });
}

function sparkle(x, y, col, n = 7) {
  for (let i = 0; i < n; i++) particles.push({
    kind: 'grain', col, x, y, vx: rand(-140, 140), vy: -rand(40, 220), r: rand(1.5, 3), life: 0, max: rand(0.25, 0.5),
  });
}

function collect(p, py) {
  p.got = true;
  if (p.kind === 'coin') { runCoins++; sparkle(p.x, py, '#ffe14a', 5); beep(1320, 0.05, 'square', 0.035); }
  else if (p.kind === 'egg') {
    runEggs++; sparkle(p.x, py, '#fff0cf', 12);
    beep(880, 0.08, 'triangle', 0.07); setTimeout(() => beep(1320, 0.16, 'triangle', 0.07), 90);
  }
  else if (p.kind === 'shield') { shield = true; sparkle(p.x, py, '#9fdcff', 12); beep(520, 0.2, 'triangle', 0.07, 400); }
  else if (p.kind === 'magnet') { magnetT = 8; sparkle(p.x, py, '#ff6a5e', 12); beep(420, 0.2, 'triangle', 0.07, 500); }
}

/** Draws a pixel icon centred on (cx, cy), h pixels tall, kept blocky. */
function drawIcon(icon, cx, cy, h, squash = 1) {
  const w = icon.width / icon.height * h * squash;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(icon, cx - w / 2, cy - h / 2, w, h);
  ctx.imageSmoothingEnabled = true;
}

function drawPickups() {
  for (const p of pickups) {
    const y = GROUND - hAt(p.x) - p.alt + Math.sin(time * 4 + p.x * 0.02) * 3;
    if (p.kind === 'coin') drawIcon(ICONS.coin, p.x, y, 26, 0.25 + 0.75 * Math.abs(Math.cos(time * 5 + p.x * 0.01)));
    else {
      ellipse(p.x, y, 27, 27);                               // a soft bubble so it stands out
      ctx.fillStyle = `rgba(255,255,255,${0.3 + 0.12 * Math.sin(time * 6)})`; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 2; ctx.stroke();
      drawIcon(ICONS[p.kind], p.x, y, p.kind === 'egg' ? 38 : 30);
    }
  }
}

// ------------------------------------------------------------------- HUD ---
function drawHud() {
  const pad = n => String(Math.floor(n)).padStart(5, '0');
  const blink = flash > 0 && Math.floor(flash * 8) % 2 === 0;
  if (state !== 'ready') text(pad(score), W - 20, 54, 36, 'right', blink ? '#ffe14a' : '#fff');
  text('BEST ' + pad(save.best), W - 20, state === 'ready' ? 44 : 82, 16, 'right', '#ffe9c2');

  // level + XP bar
  text('LV ' + save.level, 18, 42, 22, 'left', '#ffe14a');
  rr(84, 26, 110, 14, 7); paint('rgba(0,0,0,.45)', 'rgba(40,30,20,.85)', 2);
  const fill = Math.max(0, Math.min(1, save.xp / xpToNext(save.level)));
  if (fill > 0.02) { rr(86, 28, 106 * fill, 10, 5); ctx.fillStyle = '#6fe06f'; ctx.fill(); }
  // coins and eggs: what is saved plus what this run has picked up
  drawIcon(ICONS.coin, 30, 72, 26); text(String(save.coins + runCoins), 50, 80, 22, 'left');
  drawIcon(ICONS.egg, 132, 71, 30); text(String(save.eggs + runEggs), 150, 80, 22, 'left');
  // active power-ups
  let px = 30;
  if (shield) { drawIcon(ICONS.shield, px, 112, 28); px += 40; }
  if (magnetT > 0) {
    drawIcon(ICONS.magnet, px, 112, 28);
    rr(px - 16, 130, 32, 6, 3); paint('rgba(0,0,0,.45)', null);
    rr(px - 16, 130, 32 * magnetT / 8, 6, 3); paint('#ff6a5e', null);
  }
  if (muted) text('MUTED', 18, 160, 15, 'left', '#ffe9c2');
}

// ------------------------------------------------------------- inventory ---
const BAG_BTN = { x: 150, y: 640, w: 240, h: 52 };          // on the menu
const HATCH_BTN = { x: 140, y: 610, w: 260, h: 58 };        // inside the inventory
const BACK_BTN = { x: 170, y: 762, w: 200, h: 48 };

function button(c, label, size, on = true) {
  rr(c.x, c.y, c.w, c.h, 14);
  paint(on ? '#ff9a3c' : 'rgba(120,110,100,.7)', '#3a2a12', 3);
  text(label, c.x + c.w / 2, c.y + c.h / 2 + size * 0.36, size);
}
function openBag() { state = 'bag'; bag.result = null; bag.hatchAt = 0; beep(520, 0.06, 'triangle', 0.05); }
function closeBag() { state = 'ready'; bag.hatchAt = 0; beep(400, 0.06, 'triangle', 0.05); }
function startHatch() {
  if (save.eggs <= 0 || bag.hatchAt) { beep(160, 0.12, 'square', 0.05); return; }
  bag.hatchAt = time; bag.result = null;
  beep(300, 0.5, 'triangle', 0.05, 500);
}
function finishHatch() {
  bag.hatchAt = 0;
  const locked = DINO_LIST.filter(d => !owns(d.id)).map(d => d.id);
  const r = hatchEgg(locked);
  if (!r) return;
  if (r.kind === 'dino') r.label = (DINO_LIST.find(d => d.id === r.id) || {}).label || r.id;
  bag.result = r;
  beep(784, 0.1, 'triangle', 0.07); setTimeout(() => beep(1175, r.kind === 'dino' ? 0.4 : 0.18, 'triangle', 0.07), 110);
}
function bagTap(x, y) {
  if (inRect(HATCH_BTN, x, y)) startHatch();
  else if (inRect(BACK_BTN, x, y)) closeBag();
}
function bagKey(e) {
  if (e.code === 'Escape' || e.code === 'KeyI' || e.code === 'Backspace') closeBag();
  else if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); startHatch(); }
}
/** Testing shortcut (U key): a handful of coins, eggs and XP. */
function cheat() {
  save.coins += 500; save.eggs += 3; addXp(300);
  say('Test boost: +500 coins, +3 eggs, +300 XP');
}

function drawBag() {
  ctx.fillStyle = 'rgba(20,16,40,.72)'; ctx.fillRect(0, 0, W, H);
  rr(30, 110, 480, 720, 26); paint('rgba(74,52,34,.96)', '#ffcf7a', 5);
  text('INVENTORY', W / 2, 172, 42, 'center', '#ffe14a');

  // level
  text('LEVEL ' + save.level, 64, 232, 26, 'left');
  text(save.xp + ' / ' + xpToNext(save.level) + ' XP', 476, 232, 17, 'right', '#ffe9c2');
  rr(64, 246, 412, 18, 9); paint('rgba(0,0,0,.5)', '#3a2a12', 2);
  const fill = Math.max(0, Math.min(1, save.xp / xpToNext(save.level)));
  if (fill > 0.01) { rr(67, 249, 406 * fill, 12, 6); ctx.fillStyle = '#6fe06f'; ctx.fill(); }

  // coins and collection
  drawIcon(ICONS.coin, 88, 314, 44); text(String(save.coins), 122, 328, 32, 'left');
  const owned = DINO_LIST.filter(d => owns(d.id)).length;
  text('Dinos ' + owned + ' / ' + DINO_LIST.length, 476, 326, 22, 'right', '#ffe9c2');

  // the egg
  const hatching = bag.hatchAt > 0, t = hatching ? (time - bag.hatchAt) / 1.1 : 0;
  ctx.save();
  ctx.translate(W / 2, 470);
  if (hatching) { ctx.rotate(Math.sin(time * 38) * 0.22 * t); ctx.scale(1 + t * 0.12, 1 + t * 0.12); }
  ctx.globalAlpha = save.eggs > 0 || hatching ? 1 : 0.28;
  drawIcon(ICONS.egg, 0, 0, 150);
  ctx.restore();
  text('x ' + save.eggs, W / 2 + 84, 520, 30, 'left');

  const r = bag.result;
  if (r) {
    const msg = r.kind === 'coins' ? `+${r.amount} coins!`
      : r.kind === 'xp' ? `+${r.amount} XP!` + (r.ups && r.ups.length ? '  Level up!' : '')
      : `${r.label} hatched!`;
    text(msg, W / 2, 584, 28, 'center', r.kind === 'dino' ? '#7dff7d' : '#ffe14a');
    if (r.kind === 'dino') text('A new dino is unlocked', W / 2, 606, 16, 'center', '#ffe9c2');
  } else if (!hatching) {
    text(save.eggs > 0 ? 'Eggs hold coins, XP or a new dino' : 'Find eggs in a run or by levelling up', W / 2, 590, 17, 'center', '#ffe9c2');
  }
  button(HATCH_BTN, hatching ? 'HATCHING...' : 'HATCH AN EGG', 24, save.eggs > 0 && !hatching);

  text(`Best ${save.best}  ·  Runs ${save.runs}  ·  Eggs hatched ${save.hatched}`, W / 2, 722, 16, 'center', '#ffe9c2');
  button(BACK_BTN, 'BACK', 22);
}

// ---------------------------------------------------------------- render ---
function text(str, x, y, size, align = 'center', fill = '#fff') {
  ctx.font = `bold ${size}px "Trebuchet MS", "Segoe UI", sans-serif`;
  ctx.textAlign = align; ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(40,30,20,.85)'; ctx.lineWidth = Math.max(4, size / 5); ctx.strokeText(str, x, y);
  ctx.fillStyle = fill; ctx.fillText(str, x, y);
}
// Dino picker: a carousel. The chosen dino sits in the middle, its neighbours
// peek in from the sides; swipe (or drag, or use the arrow keys) to move along.
const CAR = { y: 250, w: 250, h: 250, gap: 205 };
let carPos = selected;                         // eased position, in dino indexes
let drag = null;                               // { x0, dx } while a swipe is in progress

function drawCarousel() {
  const n = DINO_LIST.length, cy = CAR.y + CAR.h / 2;
  const order = DINO_LIST.map((d, i) => i).sort((a, b) => Math.abs(b - carPos) - Math.abs(a - carPos));
  for (const i of order) {                     // furthest first, so the middle card is on top
    const off = i - carPos, dist = Math.abs(off);
    if (dist > 2.2) continue;
    const d = DINO_LIST[i], k = Math.max(0.55, 1 - dist * 0.32), on = dist < 0.5;
    const w = CAR.w * k, h = CAR.h * k, cx = W / 2 + off * CAR.gap;
    ctx.globalAlpha = Math.max(0.3, 1 - dist * 0.45);
    rr(cx - w / 2, cy - h / 2, w, h, 20 * k);
    paint(on ? 'rgba(255,255,255,.94)' : 'rgba(255,255,255,.7)', on ? '#ff9a3c' : 'rgba(60,40,20,.5)', on ? 6 : 2.5);
    if (ready(d.portrait)) {
      const s = Math.min((w - 28 * k) / d.portrait.naturalWidth, (h - 70 * k) / d.portrait.naturalHeight);
      const pw = d.portrait.naturalWidth * s, ph = d.portrait.naturalHeight * s;
      ctx.drawImage(d.portrait, cx - pw / 2, cy - h / 2 + 12 * k + (h - 70 * k - ph) / 2, pw, ph);
    }
    if (!owns(d.id)) {                                      // locked: dim the card, show lock + price
      const u = unlockOf(d.id);
      rr(cx - w / 2, cy - h / 2, w, h, 20 * k); ctx.fillStyle = 'rgba(24,20,44,.62)'; ctx.fill();
      drawIcon(ICONS.lock, cx, cy - 42 * k, 62 * k);
      text('LEVEL ' + u.level, cx, cy + 22 * k, 20 * k, 'center', save.level >= u.level ? '#7dff7d' : '#ff8a7a');
      drawIcon(ICONS.coin, cx - 34 * k, cy + 48 * k, 24 * k);
      text(String(u.cost), cx - 16 * k, cy + 56 * k, 22 * k, 'left', save.coins >= u.cost ? '#7dff7d' : '#ff8a7a');
    }
    text(d.label, cx, cy + h / 2 - 20 * k, 24 * k, 'center', on ? '#ffe14a' : '#fff');
  }
  ctx.globalAlpha = 1;
  if (selected > 0) text('‹', 20, cy + 16, 50);
  if (selected < n - 1) text('›', W - 20, cy + 16, 50);
  for (let i = 0; i < n; i++) {                // position dots
    ellipse(W / 2 + (i - (n - 1) / 2) * 20, CAR.y + CAR.h + 24, i === selected ? 6 : 4, i === selected ? 6 : 4);
    paint(i === selected ? '#ffe14a' : 'rgba(255,255,255,.75)', 'rgba(40,30,20,.8)', 2);
  }
}
const CHANGE_BTN = { x: 160, y: 470, w: 220, h: 44 };

function render() {
  ctx.fillStyle = '#f3dcae'; ctx.fillRect(0, 0, W, H);
  if (sceneFade < 1) drawScene(SCENES[prevScene], scroll, 1);
  drawScene(SCENES[scene], scroll, sceneFade);
  const dust = SCENES[scene].dust;

  drawStreaks(dust);
  for (const o of obstacles) {
    ctx.save(); ctx.translate(0, -obstacleLift(o));
    if (o.kind === 'cactus') drawCactus(o); else drawBird(o, time);
    ctx.restore();
  }
  drawPickups();
  drawParticles(dust);
  drawDino(time);
  drawHud();

  if (state === 'ready') {
    text('DINO RUSH', W / 2, 170, 68, 'center', '#ffe14a');
    if (toast && time < toast.until) text(toast.msg, W / 2, 226, 22, 'center', '#7dff7d');
    else text('Swipe to choose your dino', W / 2, 226, 22);
    drawCarousel();
    const ty = CAR.y + CAR.h + 74, cur = DINO_LIST[selected], lockedNow = !owns(cur.id), chk = buyCheck(cur.id);
    const line = !lockedNow ? 'Tap your dino or press SPACE to run'
      : chk.ok ? `Tap to unlock ${cur.label} for ${unlockOf(cur.id).cost} coins` : chk.why;
    if (lockedNow || Math.floor(time * 2) % 2 === 0) text(line, W / 2, ty, 19, 'center', lockedNow && !chk.ok ? '#ff8a7a' : '#fff');
    text(canFly() ? 'This one flies: hold SPACE or keep touching' : 'In the run: tap to jump, touch and hold to slide', W / 2, ty + 30, 16, 'center', '#ffe9c2');
    button(BAG_BTN, 'INVENTORY' + (save.eggs ? `  (${save.eggs} egg${save.eggs > 1 ? 's' : ''})` : ''), 21);
  } else if (state === 'over') {
    text('GAME OVER', W / 2, 300, 60, 'center', '#ff6b5e');
    text('Score ' + Math.floor(score) + (summary && summary.newBest ? '  \u00b7  new best!' : ''), W / 2, 346, 24);
    if (summary) {                                          // what the run earned
      drawIcon(ICONS.coin, 150, 378, 26); text('+' + summary.coins, 170, 386, 22, 'left');
      drawIcon(ICONS.egg, 258, 377, 30); text('+' + summary.eggs, 278, 386, 22, 'left');
      text('+' + summary.xp + ' XP', 400, 386, 22, 'center', '#7dff7d');
      if (summary.ups.length) {
        const last = summary.ups[summary.ups.length - 1], won = summary.ups.reduce((a, u) => a + u.coins, 0);
        text(`LEVEL UP!  Level ${last.level}  \u00b7  +${won} coins, +${summary.ups.length} egg${summary.ups.length > 1 ? 's' : ''}`, W / 2, 418, 18, 'center', '#ffe14a');
      }
    }
    if (time - overAt > 0.45) {
      text('Tap or press SPACE to run again', W / 2, 452, 19, 'center', '#ffe9c2');
      rr(CHANGE_BTN.x, CHANGE_BTN.y, CHANGE_BTN.w, CHANGE_BTN.h, 12); paint('rgba(0,0,0,.4)', '#fff', 2);
      text('MENU (C)', W / 2, CHANGE_BTN.y + 29, 17);
    }
  }
  if (state === 'bag') drawBag();
}

// ------------------------------------------------------------------ loop ---
let last = performance.now();
function frame(now) {
  let dt = Math.min(0.05, (now - last) / 1000); last = now;
  while (dt > 0) { const s = Math.min(dt, 1 / 120); update(s); dt -= s; }
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ----------------------------------------------------------------- input ---
const JUMP_KEYS = ['Space', 'ArrowUp', 'KeyW'], DUCK_KEYS = ['ArrowDown', 'KeyS'];
window.addEventListener('keydown', e => {
  if (state === 'bag') { bagKey(e); return; }
  if (e.code === 'KeyI' && state === 'ready') { openBag(); return; }
  if (e.code === 'KeyU' && state === 'ready') { cheat(); return; }
  if (JUMP_KEYS.includes(e.code)) { e.preventDefault(); if (!e.repeat) { keys.jump = true; pressJump(); } }
  else if (DUCK_KEYS.includes(e.code)) { e.preventDefault(); keys.duck = true; }
  else if (e.code === 'KeyM') muted = !muted;
  else if (state === 'ready' && e.code === 'ArrowLeft') selectDino(Math.max(0, selected - 1));
  else if (state === 'ready' && e.code === 'ArrowRight') selectDino(Math.min(DINO_LIST.length - 1, selected + 1));
  else if (state === 'over' && e.code === 'KeyC' && time - overAt > 0.45) toMenu();
});
window.addEventListener('keyup', e => {
  if (JUMP_KEYS.includes(e.code)) keys.jump = false;
  else if (DUCK_KEYS.includes(e.code)) keys.duck = false;
});
canvas.addEventListener('pointerdown', e => {
  e.preventDefault();
  const [px, py] = toCanvas(e);
  const inside = c => px >= c.x && px <= c.x + c.w && py >= c.y && py <= c.y + c.h;
  if (state === 'bag') { bagTap(px, py); return; }
  if (state === 'ready') { drag = { x0: px, y0: py, dx: 0 }; return; }   // swipe or tap, decided on release
  if (state === 'over' && time - overAt > 0.45 && inside(CHANGE_BTN)) { toMenu(); return; }
  if (state !== 'playing' || canFly()) { keys.jump = true; pressJump(); return; }
  // Runners: a quick tap jumps, touching and holding slides for as long as it is held.
  clearTimeout(holdTimer);
  touching = true; sliding = false;
  holdTimer = setTimeout(() => { if (touching) { sliding = true; keys.duck = true; } }, HOLD_MS);
});
function toCanvas(e) {
  const r = canvas.getBoundingClientRect();
  return [(e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height];
}
window.addEventListener('pointermove', e => { if (drag) drag.dx = toCanvas(e)[0] - drag.x0; });

function endDrag(commit) {
  const d = drag, n = DINO_LIST.length; drag = null;
  if (!commit) return;
  const clampI = i => Math.max(0, Math.min(n - 1, i));
  if (Math.abs(d.dx) > 14) {                                   // a swipe: go to the nearest dino,
    let target = clampI(Math.round(selected - d.dx / CAR.gap));   // or at least one along for a short flick
    if (target === selected && Math.abs(d.dx) > 40) target = clampI(selected - Math.sign(d.dx));
    if (target !== selected) selectDino(target);
  } else if (inRect(BAG_BTN, d.x0, d.y0)) {
    openBag();
  } else if (d.y0 < CAR.y - 20 || d.y0 > CAR.y + CAR.h + 20) {
    // a tap away from the cards does nothing
  } else if (d.x0 < W / 2 - CAR.w / 2) {                        // tap on the left neighbour
    if (selected > 0) selectDino(selected - 1);
  } else if (d.x0 > W / 2 + CAR.w / 2) {                        // tap on the right neighbour
    if (selected < n - 1) selectDino(selected + 1);
  } else {                                                      // tap on the chosen dino: go
    pressJump();
    if (state === 'playing' && !canFly()) { keys.jump = true; tapJump = true; }
  }
}

function endTouch(jumpIfTap) {
  if (drag) { endDrag(jumpIfTap); return; }
  clearTimeout(holdTimer);
  if (touching) {
    if (sliding) keys.duck = false;
    else if (jumpIfTap && state === 'playing') { keys.jump = true; tapJump = true; pressJump(); }   // full-height jump
    touching = sliding = false;
    if (tapJump) return;
  }
  keys.jump = false;
}
window.addEventListener('pointerup', () => endTouch(true));
window.addEventListener('pointercancel', () => endTouch(false));
const duckBtn = document.getElementById('duck');
duckBtn.addEventListener('pointerdown', e => { e.preventDefault(); keys.duck = true; });
for (const ev of ['pointerup', 'pointercancel', 'pointerleave'])
  duckBtn.addEventListener(ev, () => { keys.duck = false; });
window.addEventListener('blur', () => { keys.jump = keys.duck = false; });
document.addEventListener('visibilitychange', () => { last = performance.now(); });
