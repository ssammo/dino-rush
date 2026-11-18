'use strict';
/* Dino Rush — saved progress: coins, eggs, XP and levels, dino unlocks,
   egg hatching, and the pixel-art icons. Loaded before game.js. */

const SAVE_KEY = 'dinoRushSave1';

// What each dino costs in coins and the player level it needs. Rex is free.
const UNLOCKS = {
  rex: { cost: 0, level: 1 },
  crest: { cost: 60, level: 1 },
  bonehead: { cost: 120, level: 2 },
  sail: { cost: 200, level: 3 },
  tank: { cost: 300, level: 4 },
  dragon: { cost: 400, level: 5 },
  spino: { cost: 500, level: 6 },
  raptor: { cost: 650, level: 7 },
  trike: { cost: 800, level: 8 },
  stego: { cost: 1000, level: 9 },
};
const unlockOf = id => UNLOCKS[id] || { cost: 0, level: 1 };

const save = (() => {
  const s = { coins: 0, eggs: 0, xp: 0, level: 1, owned: ['rex'], best: 0, runs: 0, hatched: 0, dino: 'rex' };
  try {
    Object.assign(s, JSON.parse(localStorage.getItem(SAVE_KEY) || '{}'));
    if (!s.best) s.best = +localStorage.getItem('dinoRushBest') || 0;      // carry over the old best score
  } catch (e) { /* storage unavailable: progress lasts for this visit only */ }
  if (!Array.isArray(s.owned)) s.owned = ['rex'];
  if (!s.owned.includes('rex')) s.owned.push('rex');
  return s;
})();
function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {} }

// ---------------------------------------------------------- XP and levels ---
const xpToNext = level => 60 + (level - 1) * 40;         // XP needed to finish this level

/** Adds XP. Every level gained pays out coins and one egg. Returns the level-ups. */
function addXp(n) {
  save.xp += Math.max(0, Math.floor(n));
  const ups = [];
  while (save.xp >= xpToNext(save.level)) {
    save.xp -= xpToNext(save.level);
    save.level++;
    const coins = 20 + save.level * 5;
    save.coins += coins; save.eggs += 1;
    ups.push({ level: save.level, coins });
  }
  persist();
  return ups;
}

// ------------------------------------------------------------------ unlocks ---
const owns = id => save.owned.includes(id);

function buyCheck(id) {
  const u = unlockOf(id);
  if (owns(id)) return { ok: true };
  if (save.level < u.level) return { ok: false, why: `Reach level ${u.level} to unlock` };
  if (save.coins < u.cost) return { ok: false, why: `Need ${u.cost - save.coins} more coins` };
  return { ok: true };
}
function buy(id) {
  if (owns(id) || !buyCheck(id).ok) return false;
  save.coins -= unlockOf(id).cost;
  save.owned.push(id);
  persist();
  return true;
}

// --------------------------------------------------------------------- eggs ---
/** Hatches one egg: mostly coins, sometimes XP, now and then a locked dino. */
function hatchEgg(lockedIds) {
  if (save.eggs <= 0) return null;
  save.eggs--; save.hatched++;
  const r = Math.random();
  let res;
  if (r < 0.12 && lockedIds.length) {
    const id = lockedIds[Math.floor(Math.random() * Math.min(3, lockedIds.length))];   // one of the next few
    save.owned.push(id);
    res = { kind: 'dino', id };
  } else if (r < 0.45) {
    const xp = 30 + Math.floor(Math.random() * 51);
    res = { kind: 'xp', amount: xp, ups: addXp(xp) };
  } else {
    const coins = 25 + Math.floor(Math.random() * 66);
    save.coins += coins;
    res = { kind: 'coins', amount: coins };
  }
  persist();
  return res;
}

// ----------------------------------------------------------------- missions ---
// One mission is active at a time. Meeting its goal within a single run pays
// coins and rolls a new one. Goals get harder as the player levels up.
const MISSIONS = [
  { id: 'coins', goals: [15, 25, 40], text: n => `Collect ${n} coins in one run` },
  { id: 'score', goals: [150, 300, 500], text: n => `Score ${n} in one run` },
  { id: 'jumps', goals: [12, 25, 40], text: n => `Jump ${n} times in one run` },
  { id: 'eggs', goals: [1, 1, 2], text: n => (n > 1 ? `Pick up ${n} eggs in one run` : 'Pick up an egg in a run') },
];
function newMission() {
  const pool = MISSIONS.filter(m => !save.mission || m.id !== save.mission.id);   // never the same twice running
  const m = pool[Math.floor(Math.random() * pool.length)];
  const top = Math.min(2, Math.floor((save.level - 1) / 3));
  const tier = Math.floor(Math.random() * (top + 1));
  save.mission = { id: m.id, goal: m.goals[tier], reward: 30 + tier * 25 };
  persist();
}
const missionText = () => (MISSIONS.find(m => m.id === save.mission.id) || MISSIONS[0]).text(save.mission.goal);
/** stats: { coins, score, jumps, eggs } for the run just finished. */
function checkMission(stats) {
  const m = save.mission;
  if (!m || (stats[m.id] || 0) < m.goal) return null;
  save.coins += m.reward;
  const done = { text: missionText(), reward: m.reward };
  newMission();
  return done;
}
if (!save.mission || !MISSIONS.some(m => m.id === save.mission.id)) newMission();

// -------------------------------------------------------------- pixel icons ---
// Each icon is a tiny canvas painted pixel by pixel, then drawn enlarged with
// smoothing off so it stays blocky.
function pixelSprite(w, h, colourAt) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const col = colourAt(x, y);
    if (col) { g.fillStyle = col; g.fillRect(x, y, 1, 1); }
  }
  return c;
}
// outline helper: a pixel is on the edge if it is inside but a neighbour is not
const edgeOf = inside => (x, y) => inside(x, y) && !(inside(x - 1, y) && inside(x + 1, y) && inside(x, y - 1) && inside(x, y + 1));

const ICONS = (() => {
  const coinIn = (x, y) => Math.hypot(x - 5.5, y - 5.5) <= 5.9;
  const coinEdge = edgeOf(coinIn);
  const coin = pixelSprite(12, 12, (x, y) => {
    if (!coinIn(x, y)) return null;
    if (coinEdge(x, y)) return '#8a5200';
    const r = Math.hypot(x - 5.5, y - 5.5);
    if ((x === 5 || x === 6) && y >= 3 && y <= 8) return '#c98a10';
    if (x + y <= 7 && r > 2.6) return '#fff6b0';
    if (x + y >= 15 && r > 2.6) return '#e8a51c';
    return '#ffd43a';
  });

  const eggIn = (x, y) => {
    if (y < 0 || y > 14) return false;
    const mid = 8.7, ry = y < mid ? 8.4 : 6.0;
    const t = (y - mid) / ry;
    if (Math.abs(t) > 1) return false;
    const taper = y < mid ? 0.72 + 0.28 * (y / mid) : 1;
    return Math.abs(x - 5.5) <= 5.4 * Math.sqrt(1 - t * t) * taper;
  };
  const eggEdge = edgeOf(eggIn);
  const spots = new Set(['4,4', '5,4', '4,5', '7,7', '8,7', '8,8', '3,9', '4,9', '3,10', '6,11', '7,11', '6,12']);
  const makeEgg = (shell, shade, spot) => pixelSprite(12, 15, (x, y) => {
    if (!eggIn(x, y)) return null;
    if (eggEdge(x, y)) return '#5f4226';
    if (spots.has(x + ',' + y)) return spot;
    if (x <= 4 && y >= 2 && y <= 5 && x + y <= 7) return '#ffffff';
    if (x >= 8 && y >= 8) return shade;
    return shell;
  });

  const shieldIn = (x, y) => y >= 0 && y <= 12 && Math.abs(x - 5.5) <= (y <= 6 ? 5.5 : 5.5 - (y - 6) * 0.95);
  const shieldEdge = edgeOf(shieldIn);
  const shield = pixelSprite(12, 13, (x, y) => {
    if (!shieldIn(x, y)) return null;
    if (shieldEdge(x, y)) return '#1d3f73';
    if (x <= 5) return y <= 5 ? '#9fdcff' : '#5db4f2';
    return y <= 5 ? '#5db4f2' : '#2f86d6';
  });

  const magIn = (x, y) => {
    const r = Math.hypot(x - 5.5, y - 5.5);
    if (y <= 5) return r <= 5.8 && r >= 2.2;
    return y <= 11 && Math.abs(x - 5.5) <= 5.6 && Math.abs(x - 5.5) >= 2.4;
  };
  const magEdge = edgeOf(magIn);
  const magnet = pixelSprite(12, 12, (x, y) => {
    if (!magIn(x, y)) return null;
    if (magEdge(x, y)) return '#5a1414';
    if (y >= 9) return '#f2f2f2';
    return x <= 5 ? '#ff6a5e' : '#d8362e';
  });

  const lockIn = (x, y) => {
    if (y >= 5) return y <= 12 && x >= 0 && x <= 10;
    const r = Math.hypot(x - 5, y - 4.5);
    return r <= 4.4 && r >= 2.2;
  };
  const lockEdge = edgeOf(lockIn);
  const lock = pixelSprite(11, 13, (x, y) => {
    if (!lockIn(x, y)) return null;
    if (lockEdge(x, y)) return '#3a2a12';
    if (y < 5) return '#c9ccd4';
    if ((x === 5 && y >= 7 && y <= 10) || (y === 7 && x >= 4 && x <= 6)) return '#3a2a12';
    return y <= 6 ? '#ffe07a' : '#f2b52e';
  });

  return {
    coin, shield, magnet, lock,
    egg: makeEgg('#fff0cf', '#e9cfa0', '#59b8a8'),
  };
})();
