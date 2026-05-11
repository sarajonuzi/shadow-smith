// Shadow Smith - JS + Canvas (10 levels) - PRO MAX (single-file)
// Adds: camera follow + wider levels, dash (Shift), wall slide/jump,
// checkpoints, local best records, PRO key, SFX, dust, shake, jump buffer/coyote.
// PRO polish additions (no level number changes):
// - rotations counted by angle steps (not per-frame spam)
// - scan meter always visible + SAFE ZONE hint
// - respawn i-frames (brief scan protection) + blink effect
// - camera look-ahead + reduced shake toggle
// - M: mute, V: reduce shake
// - dash trail (visual only)
// - GAME OVER: triggers on fall ONLY if checkpoint not reached
// Controls: A/D or Arrows move, W/Up/Space jump, Shift dash, Q/E rotate light
// Enter start, R restart, N next level (after win). Click canvas to focus.

const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");

canvas.width = 960;
canvas.height = 540;
canvas.style.width = "960px";
canvas.style.height = "540px";

// focus
canvas.tabIndex = 0;
canvas.style.outline = "none";
canvas.addEventListener("click", () => { canvas.focus(); ensureAudio(); });
canvas.focus();

// ---------- INPUT (with edge detection) ----------
const keys = new Set();
const pressed = new Set();

addEventListener("keydown", (e) => {
  if (!keys.has(e.code)) pressed.add(e.code);
  keys.add(e.code);
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
});
addEventListener("keyup", (e) => keys.delete(e.code));
function wasPressed(code) { return pressed.has(code); }

// ---------- HELPERS ----------
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function wrapAngle(a) {
  while (a < -Math.PI) a += Math.PI * 2;
  while (a > Math.PI) a -= Math.PI * 2;
  return a;
}
function dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }
function overlapsRect(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
function distPointToRect(px, py, r) {
  const cx = clamp(px, r.x, r.x + r.w);
  const cy = clamp(py, r.y, r.y + r.h);
  return Math.hypot(px - cx, py - cy);
}

// ---------- GRID / WORLD SIZE ----------
const tileSize = 32;
const viewCols = Math.floor(canvas.width / tileSize);
const viewRows = Math.floor(canvas.height / tileSize);

// Make the world wider than the screen for camera scrolling
const WORLD_COLS = viewCols * 3; // 3 screens wide
const WORLD_ROWS = viewRows;     // same height

// ---------- STATE ----------
const State = Object.freeze({ MENU: "MENU", PLAY: "PLAY", WIN: "WIN", GAMEOVER: "GAMEOVER" });
let state = State.MENU;

// ---------- COLORS ----------
const COLORS = {
  bg: "#070a10",
  bg0: "#070a10",
  bg1: "#0b1220",
  world: "#1f2a37",
  shadow: "rgba(30, 90, 120, 0.40)",
  shadowHi: "rgba(90, 170, 220, 0.22)",
  uiText: "#c8d6e6",
  uiDim: "#7f93a8",
  title: "#e6f1ff",
  accent: "#9ae6ff",
  player: "#6cffd6",
  key: "#ffe66d",
  danger: "#ff5c5c",
  checkpoint: "#c77dff",
};

// ---------- SETTINGS ----------
const SETTINGS = {
  mute: false,
  reduceShake: false,
};

// spawn protection (short invulnerability after respawn)
let spawnIFrame = 0;

// dash trail particles (visual only)
let dashTrailT = 0;

// ---------- CAMERA ----------
const camera = { x: 0, y: 0, shake: 0, shakeX: 0, shakeY: 0 };
function addShake(amount) { camera.shake = Math.min(1, camera.shake + amount); }

// ---------- AUDIO (no external files) ----------
let audioCtx = null;
function ensureAudio() {
  if (SETTINGS.mute) return;
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
}
function tone(freq, dur, type = "sine", gain = 0.06, detune = 0) {
  if (SETTINGS.mute) return;
  if (!audioCtx) return;
  const t0 = audioCtx.currentTime;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  o.detune.setValueAtTime(detune, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g);
  g.connect(audioCtx.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}
function noiseBurst(dur = 0.08, gain = 0.04) {
  if (SETTINGS.mute) return;
  if (!audioCtx) return;
  const t0 = audioCtx.currentTime;
  const bufferSize = Math.floor(audioCtx.sampleRate * dur);
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(g);
  g.connect(audioCtx.destination);
  src.start(t0);
  src.stop(t0 + dur);
}
function sfxKey() { ensureAudio(); tone(880, 0.08, "triangle", 0.07); tone(1320, 0.10, "sine", 0.05, 8); }
function sfxWin() { ensureAudio(); tone(660, 0.10, "triangle", 0.06); setTimeout(() => tone(990, 0.12, "triangle", 0.06), 70); setTimeout(() => tone(1320, 0.14, "sine", 0.05), 140); }
function sfxRotate() { ensureAudio(); noiseBurst(0.05, 0.02); tone(220, 0.05, "sine", 0.02); }
function sfxDash() { ensureAudio(); noiseBurst(0.06, 0.03); tone(160, 0.06, "sawtooth", 0.02); }
function sfxCheckpoint() { ensureAudio(); tone(520, 0.08, "triangle", 0.05); tone(780, 0.10, "sine", 0.03); }
function sfxDeath() { ensureAudio(); tone(120, 0.18, "square", 0.05); noiseBurst(0.12, 0.03); }

// ---------- BACKGROUND STARS ----------
const stars = Array.from({ length: 160 }, () => ({
  x: Math.random() * canvas.width,
  y: Math.random() * canvas.height,
  r: Math.random() * 1.6 + 0.2,
  a: Math.random() * 0.6 + 0.15,
  s: Math.random() * 12 + 6,
}));
function drawBackground() {
  const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
  g.addColorStop(0, COLORS.bg0);
  g.addColorStop(1, COLORS.bg1);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const t = performance.now() / 1000;
  for (const st of stars) {
    const tw = 0.35 + 0.25 * Math.sin(t * (1 / st.s) + st.x * 0.01);
    ctx.fillStyle = `rgba(230,241,255,${st.a * tw})`;
    ctx.beginPath();
    ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
    ctx.fill();
  }

  // vignette
  const vg = ctx.createRadialGradient(canvas.width * 0.5, canvas.height * 0.5, canvas.height * 0.1, canvas.width * 0.5, canvas.height * 0.5, canvas.height * 0.85);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // light grain
  const n = 550;
  ctx.fillStyle = "rgba(255,255,255,0.012)";
  for (let i = 0; i < n; i++) ctx.fillRect((Math.random() * canvas.width) | 0, (Math.random() * canvas.height) | 0, 1, 1);
}
function drawPanel(x, y, w, h, a = 0.55) {
  ctx.fillStyle = `rgba(0,0,0,${a})`;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "rgba(230,241,255,0.10)";
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

// ---------- PLAYER ----------
const player = {
  x: 3 * tileSize, y: 5 * tileSize,
  w: 22, h: 28,
  vx: 0, vy: 0,
  onGround: false,
  facing: 1,
  animT: 0,
  squish: 0,
  wallDir: 0, // -1 left wall, +1 right wall
};

// movement tuning
const GRAVITY = 1800;
const MOVE = 380;
const JUMP = 720;

// wall movement
const WALL_SLIDE_SPEED = 220;
const WALL_JUMP_X = 520;
const WALL_JUMP_Y = 720;

// dash
let dashTime = 0;
let dashCooldown = 0;
const DASH_DUR = 0.12;
const DASH_SPEED = 860;
const DASH_COOLDOWN = 0.55;

// jump feel
let prevJumpHeld = false;
let coyoteTime = 0;
let jumpBuffer = 0;

// ---------- LIGHT ----------
const light = { x: 6.5 * tileSize, y: 6.5 * tileSize, angle: 0.15, cone: Math.PI / 5, range: 15 * tileSize };

// ---------- WORLD CONTAINERS ----------
let levelIndex = 0;
let solidWorld = new Set();
let solidShadow = new Set();

let finish = { x: 0, y: 0, w: 26, h: 44, locked: true };
let keyObj = { x: 0, y: 0, r: 10, collected: false };

// checkpoint
let checkpoint = { x: 0, y: 0, r: 16, active: false, used: false };
let spawnPoint = { x: 3 * tileSize, y: 5 * tileSize };

let timeStart = 0;
let elapsed = 0;
let rotations = 0;
let scanned = 0;
let won = false;

// rotations: count by angle steps (not by frame)
let lastRotStep = 0;
const ROT_STEP = (12 * Math.PI) / 180; // 12 degrees per "rotation step"

const particles = [];
function spawnParticles(x, y, color, count = 18, speed = 180) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = (0.35 + Math.random() * 0.65) * speed;
    particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.6 + Math.random() * 0.4, t: 0, color, r: 1.5 + Math.random() * 2.2 });
  }
}
function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.t += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= Math.pow(0.02, dt);
    p.vy *= Math.pow(0.02, dt);
    if (p.t >= p.life) particles.splice(i, 1);
  }
}
function drawParticles() {
  for (const p of particles) {
    const k = 1 - p.t / p.life;
    ctx.fillStyle = p.color.replace("ALPHA", (0.7 * k).toFixed(3));
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * k, 0, Math.PI * 2);
    ctx.fill();
  }
}

// dust motes (in light)
const dust = Array.from({ length: 80 }, () => ({
  x: Math.random() * canvas.width * 1.2,
  y: Math.random() * canvas.height,
  vx: (Math.random() * 2 - 1) * 10,
  vy: (Math.random() * 2 - 1) * 10,
  a: Math.random() * 0.35 + 0.05,
  r: Math.random() * 1.2 + 0.2,
}));
function updateDust(dt) {
  for (const d of dust) {
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    if (d.x < -40) d.x = canvas.width + 40;
    if (d.x > canvas.width + 40) d.x = -40;
    if (d.y < -40) d.y = canvas.height + 40;
    if (d.y > canvas.height + 40) d.y = -40;
  }
}

// ---------- LEVEL BUILD HELPERS ----------
function mkSet() { return new Set(); }
function baseFloor(s) { for (let x = 0; x < WORLD_COLS; x++) s.add(`${x},${WORLD_ROWS - 2}`); }
function addRectSolid(s, x0, y0, w, h) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) s.add(`${x},${y}`);
}
function deleteFloorRange(s, x1, x2) { for (let x = x1; x <= x2; x++) s.delete(`${x},${WORLD_ROWS - 2}`); }
function addFloorRange(s, x1, x2) { for (let x = x1; x <= x2; x++) s.add(`${x},${WORLD_ROWS - 2}`); }

// ---------- LEVELS (UNCHANGED NUMBERS) ----------
const LEVELS = [
  {
    name: "Level 1: Shadow Bridge",
    tip: "Rotate the light to create a shadow bridge.",
    playerSpawn: { x: 3, y: 5 },
    checkpoint: { x: 22, y: WORLD_ROWS - 5 },
    light: { x: 8.5, y: 6.5, angle: 0.10, cone: Math.PI / 5, range: 18 },
    key: { x: 12, y: WORLD_ROWS - 4 },
    finish: { x: 56, y: WORLD_ROWS - 4 },
    solids: () => {
      const s = mkSet(); baseFloor(s);
      addRectSolid(s, 14, WORLD_ROWS - 6, 1, 4);
      deleteFloorRange(s, 20, 28);
      addFloorRange(s, 29, 35);
      addRectSolid(s, 40, WORLD_ROWS - 6, 1, 4);
      deleteFloorRange(s, 44, 47);
      addFloorRange(s, 48, 60);
      return s;
    },
  },
  {
    name: "Level 2: Two Pillars",
    tip: "Use pillars to shape shadow steps.",
    playerSpawn: { x: 3, y: 5 },
    checkpoint: { x: 26, y: WORLD_ROWS - 5 },
    light: { x: 10.5, y: 6.0, angle: 0.0, cone: Math.PI / 6, range: 18 },
    key: { x: 14, y: WORLD_ROWS - 5 },
    finish: { x: 62, y: WORLD_ROWS - 4 },
    solids: () => {
      const s = mkSet(); baseFloor(s);
      addRectSolid(s, 18, WORLD_ROWS - 7, 1, 5);
      addRectSolid(s, 28, WORLD_ROWS - 6, 1, 4);
      deleteFloorRange(s, 24, 32);
      addFloorRange(s, 34, 40);
      addRectSolid(s, 44, WORLD_ROWS - 6, 2, 6);
      deleteFloorRange(s, 50, 54);
      addFloorRange(s, 55, 70);
      return s;
    },
  },
  {
    name: "Level 3: Narrow Cone",
    tip: "Precision shadows between obstacles.",
    playerSpawn: { x: 3, y: 5 },
    checkpoint: { x: 30, y: WORLD_ROWS - 5 },
    light: { x: 10.0, y: 6.0, angle: 0.2, cone: Math.PI / 10, range: 18 },
    key: { x: 26, y: WORLD_ROWS - 7 },
    finish: { x: 66, y: WORLD_ROWS - 4 },
    solids: () => {
      const s = mkSet(); baseFloor(s);
      addRectSolid(s, 22, WORLD_ROWS - 8, 2, 6);
      addRectSolid(s, 38, WORLD_ROWS - 6, 1, 4);
      deleteFloorRange(s, 30, 33);
      addFloorRange(s, 34, 36);
      addRectSolid(s, 48, WORLD_ROWS - 8, 1, 7);
      deleteFloorRange(s, 52, 58);
      addFloorRange(s, 59, 74);
      return s;
    },
  },
  {
    name: "Level 4: Long Gap",
    tip: "Create a longer shadow bridge.",
    playerSpawn: { x: 3, y: 5 },
    checkpoint: { x: 34, y: WORLD_ROWS - 5 },
    light: { x: 10.0, y: 6.5, angle: 0.05, cone: Math.PI / 6, range: 20 },
    key: { x: 16, y: WORLD_ROWS - 4 },
    finish: { x: 70, y: WORLD_ROWS - 4 },
    solids: () => {
      const s = mkSet(); baseFloor(s);
      addRectSolid(s, 18, WORLD_ROWS - 7, 1, 5);
      deleteFloorRange(s, 28, 39);
      addFloorRange(s, 41, 50);
      addRectSolid(s, 52, WORLD_ROWS - 6, 1, 4);
      deleteFloorRange(s, 58, 62);
      addFloorRange(s, 63, 78);
      return s;
    },
  },
  {
    name: "Level 5: Two Blockers",
    tip: "Blockers make shadow steps. Dash can help.",
    playerSpawn: { x: 3, y: 5 },
    checkpoint: { x: 30, y: WORLD_ROWS - 5 },
    light: { x: 11.0, y: 6.0, angle: 0.1, cone: Math.PI / 5, range: 19 },
    key: { x: 30, y: WORLD_ROWS - 6 },
    finish: { x: 68, y: WORLD_ROWS - 4 },
    solids: () => {
      const s = mkSet(); baseFloor(s);
      addRectSolid(s, 20, WORLD_ROWS - 6, 1, 4);
      addRectSolid(s, 26, WORLD_ROWS - 7, 1, 5);
      deleteFloorRange(s, 34, 40);
      addFloorRange(s, 42, 46);
      addRectSolid(s, 50, WORLD_ROWS - 6, 2, 6);
      deleteFloorRange(s, 56, 60);
      addFloorRange(s, 61, 76);
      return s;
    },
  },
  {
    name: "Level 6: Small Platforms",
    tip: "Wall-jump can save you. Use short shadow platforms.",
    playerSpawn: { x: 3, y: 5 },
    checkpoint: { x: 32, y: WORLD_ROWS - 5 },
    light: { x: 10.5, y: 6.5, angle: 0.2, cone: Math.PI / 7, range: 18 },
    key: { x: 22, y: WORLD_ROWS - 6 },
    finish: { x: 66, y: WORLD_ROWS - 4 },
    solids: () => {
      const s = mkSet(); baseFloor(s);
      deleteFloorRange(s, 26, 27);
      deleteFloorRange(s, 32, 33);
      deleteFloorRange(s, 38, 39);
      addRectSolid(s, 18, WORLD_ROWS - 6, 1, 4);
      addRectSolid(s, 40, WORLD_ROWS - 6, 1, 5);
      addRectSolid(s, 44, WORLD_ROWS - 8, 1, 5);
      deleteFloorRange(s, 52, 56);
      addFloorRange(s, 57, 76);
      return s;
    },
  },
  {
    name: "Level 7: Tall Wall",
    tip: "Shorter wall. Rotate, dash, and cross.",
    playerSpawn: { x: 3, y: 5 },
    checkpoint: { x: 30, y: WORLD_ROWS - 5 },
    light: { x: 9.5, y: 6.0, angle: 0.0, cone: Math.PI / 5, range: 19 },
    key: { x: 20, y: WORLD_ROWS - 7 },
    finish: { x: 72, y: WORLD_ROWS - 4 },
    solids: () => {
      const s = mkSet(); baseFloor(s);
      addRectSolid(s, 24, WORLD_ROWS - 7, 2, 5); // shorter wall
      deleteFloorRange(s, 44, 50);
      addFloorRange(s, 52, 56);
      deleteFloorRange(s, 60, 63);
      addFloorRange(s, 64, 85);
      return s;
    },
  },
  {
    name: "Level 8: Zig-Zag",
    tip: "Rotate multiple times. Checkpoint helps.",
    playerSpawn: { x: 3, y: 5 },
    checkpoint: { x: 38, y: WORLD_ROWS - 5 },
    light: { x: 12.0, y: 6.0, angle: 0.2, cone: Math.PI / 6, range: 19 },
    key: { x: 38, y: WORLD_ROWS - 6 },
    finish: { x: 74, y: WORLD_ROWS - 4 },
    solids: () => {
      const s = mkSet(); baseFloor(s);
      addRectSolid(s, 20, WORLD_ROWS - 6, 1, 4);
      addRectSolid(s, 30, WORLD_ROWS - 8, 1, 6);
      addRectSolid(s, 40, WORLD_ROWS - 6, 1, 4);
      deleteFloorRange(s, 46, 52);
      addFloorRange(s, 54, 58);
      addRectSolid(s, 60, WORLD_ROWS - 6, 1, 5);
      deleteFloorRange(s, 64, 66);
      addFloorRange(s, 67, 86);
      return s;
    },
  },
  {
    name: "Level 9: Precision",
    tip: "Narrow cone + wall jump = control.",
    playerSpawn: { x: 3, y: 5 },
    checkpoint: { x: 34, y: WORLD_ROWS - 5 },
    light: { x: 10.0, y: 6.0, angle: 0.1, cone: Math.PI / 12, range: 19 },
    key: { x: 28, y: WORLD_ROWS - 7 },
    finish: { x: 76, y: WORLD_ROWS - 4 },
    solids: () => {
      const s = mkSet(); baseFloor(s);
      addRectSolid(s, 22, WORLD_ROWS - 8, 1, 6);
      addRectSolid(s, 30, WORLD_ROWS - 7, 1, 5);
      addRectSolid(s, 38, WORLD_ROWS - 6, 1, 4);
      deleteFloorRange(s, 58, 64);
      addFloorRange(s, 62, 64);
      addRectSolid(s, 80, WORLD_ROWS - 7, 1, 5);
      addRectSolid(s, 86, WORLD_ROWS - 8, 1, 7);
      addFloorRange(s, 68, 88);
      return s;
    },
  },
  {
    name: "Level 10: Final",
    tip: "Everything together. Safe zone at the flag.",
    playerSpawn: { x: 3, y: 5 },
    checkpoint: { x: 40, y: WORLD_ROWS - 5 },
    light: { x: 12.5, y: 6.5, angle: 0.1, cone: Math.PI / 7, range: 20 },
    key: { x: 38, y: WORLD_ROWS - 7 },
    finish: { x: 84, y: WORLD_ROWS - 4 },
    solids: () => {
      const s = mkSet(); baseFloor(s);
      addRectSolid(s, 22, WORLD_ROWS - 7, 1, 7);
      addRectSolid(s, 34, WORLD_ROWS - 9, 2, 6);
      addRectSolid(s, 48, WORLD_ROWS - 7, 1, 7);
      deleteFloorRange(s, 56, 64);
      addFloorRange(s, 70, 72);
      addRectSolid(s, 72, WORLD_ROWS - 7, 1, 6);
      deleteFloorRange(s, 74, 78);
      addFloorRange(s, 79, 92);
      return s;
    },
  },
];

// ---------- RECORDS ----------
function recKey(level) { return `shadow_smith_rec_v1_${level}`; }
function getRecord(level) {
  try {
    const raw = localStorage.getItem(recKey(level));
    if (!raw) return null;
    const r = JSON.parse(raw);
    if (typeof r.time !== "number" || typeof r.rotations !== "number") return null;
    return r;
  } catch { return null; }
}
function setRecord(level, time, rotations_) {
  try { localStorage.setItem(recKey(level), JSON.stringify({ time, rotations: rotations_ })); } catch {}
}
function isBetter(newTime, newRot, old) {
  if (!old) return true;
  if (newTime < old.time - 1e-6) return true;
  if (Math.abs(newTime - old.time) < 1e-6 && newRot < old.rotations) return true;
  return false;
}

// ---------- LEVEL LOAD ----------
function loadLevel(i) {
  levelIndex = (i + LEVELS.length) % LEVELS.length;
  const L = LEVELS[levelIndex];

  solidWorld = L.solids();
  solidShadow = new Set();

  spawnPoint.x = L.playerSpawn.x * tileSize;
  spawnPoint.y = L.playerSpawn.y * tileSize;

  player.x = spawnPoint.x;
  player.y = spawnPoint.y;
  player.vx = player.vy = 0;
  player.facing = 1;
  player.animT = 0;
  player.squish = 0;
  player.wallDir = 0;

  dashTime = 0;
  dashCooldown = 0;

  light.x = L.light.x * tileSize;
  light.y = L.light.y * tileSize;
  light.angle = L.light.angle;
  light.cone = L.light.cone;
  light.range = L.light.range * tileSize;

  keyObj.x = L.key.x * tileSize + tileSize * 0.5;
  keyObj.y = L.key.y * tileSize + tileSize * 0.5;
  keyObj.r = 10;
  keyObj.collected = false;

  finish.x = L.finish.x * tileSize + 2;
  finish.y = L.finish.y * tileSize - 12;
  finish.w = 26;
  finish.h = 44;
  finish.locked = true;

  checkpoint.x = L.checkpoint.x * tileSize + tileSize * 0.5;
  checkpoint.y = L.checkpoint.y * tileSize + tileSize * 0.5;
  checkpoint.r = 16;
  checkpoint.active = true;
  checkpoint.used = false;

  scanned = 0;
  won = false;

  elapsed = 0;
  rotations = 0;
  timeStart = performance.now();

  lastRotStep = Math.round(light.angle / ROT_STEP);

  particles.length = 0;

  camera.x = 0;
  camera.y = 0;
  camera.shake = camera.shakeX = camera.shakeY = 0;

  spawnIFrame = 0.35;
  dashTrailT = 0;

  state = State.PLAY;
}
function respawnToCheckpointOrStart() {
  const px = checkpoint.used ? checkpoint.x : spawnPoint.x + player.w * 0.5;
  const py = checkpoint.used ? checkpoint.y : spawnPoint.y + player.h * 0.5;

  player.x = px - player.w * 0.5;
  player.y = py - player.h * 0.5;
  player.vx = 0;
  player.vy = 0;
  dashTime = 0;
  dashCooldown = 0.2;
  scanned = 0;

  spawnIFrame = 0.45;
  dashTrailT = 0;

  addShake(0.25);
}

// ---------- SOLID QUERIES ----------
function isWorldSolid(tx, ty) { return solidWorld.has(`${tx},${ty}`); }
function isShadowSolid(tx, ty) { return solidShadow.has(`${tx},${ty}`); }
function isSolidAt(tx, ty) { return isWorldSolid(tx, ty) || isShadowSolid(tx, ty); }

function rectVsTiles(px, py, pw, ph) {
  const left = Math.floor(px / tileSize);
  const right = Math.floor((px + pw) / tileSize);
  const top = Math.floor(py / tileSize);
  const bottom = Math.floor((py + ph) / tileSize);
  for (let ty = top; ty <= bottom; ty++) {
    for (let tx = left; tx <= right; tx++) {
      if (isSolidAt(tx, ty)) return true;
    }
  }
  return false;
}

// move & collide + wall detection
function moveAndCollide(dt) {
  const wasOnGround = player.onGround;
  player.wallDir = 0;

  // X
  player.x += player.vx * dt;
  if (rectVsTiles(player.x, player.y, player.w, player.h)) {
    const step = Math.sign(player.vx) || 1;
    while (rectVsTiles(player.x, player.y, player.w, player.h)) player.x -= step;

    if (step > 0) player.wallDir = +1; else if (step < 0) player.wallDir = -1;
    player.vx = 0;
  } else {
    const probe = 2;
    if (rectVsTiles(player.x - probe, player.y, player.w, player.h)) player.wallDir = -1;
    else if (rectVsTiles(player.x + probe, player.y, player.w, player.h)) player.wallDir = +1;
  }

  // Y
  player.y += player.vy * dt;
  if (rectVsTiles(player.x, player.y, player.w, player.h)) {
    const step = Math.sign(player.vy) || 1;
    while (rectVsTiles(player.x, player.y, player.w, player.h)) player.y -= step;
    if (player.vy > 0) player.onGround = true;
    player.vy = 0;
  } else {
    player.onGround = false;
  }

  if (!wasOnGround && player.onGround) {
    player.squish = 1.0;
    noiseBurst(0.04, 0.02);
  }
}

// ---------- LIGHT / SHADOWS ----------
function hasLineOfSightToPoint(x1, y1) {
  const x0 = light.x, y0 = light.y;
  const dx = x1 - x0, dy = y1 - y0;
  const dist = Math.hypot(dx, dy);
  const steps = Math.ceil(dist / 8);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + dx * t;
    const y = y0 + dy * t;
    const tx = Math.floor(x / tileSize);
    const ty = Math.floor(y / tileSize);
    if (isWorldSolid(tx, ty)) return false;
  }
  return true;
}
function pointIsLit(px, py) {
  const vx = px - light.x, vy = py - light.y;
  const dist = Math.hypot(vx, vy);
  if (dist > light.range) return false;
  const ang = Math.atan2(vy, vx);
  const d = wrapAngle(ang - light.angle);
  if (Math.abs(d) > light.cone * 0.5) return false;
  return hasLineOfSightToPoint(px, py);
}
function tileIsLit(tx, ty) {
  const cx = (tx + 0.5) * tileSize;
  const cy = (ty + 0.5) * tileSize;
  return pointIsLit(cx, cy);
}
function computeShadowPlatforms() {
  let next = new Set();
  const r = Math.ceil(light.range / tileSize);
  const lx = Math.floor(light.x / tileSize);
  const ly = Math.floor(light.y / tileSize);

  const minX = Math.max(0, lx - r), maxX = Math.min(WORLD_COLS - 1, lx + r);
  const minY = Math.max(0, ly - r), maxY = Math.min(WORLD_ROWS - 1, ly + r);

  function supported(tx, ty, shadowSet) {
    if (ty === WORLD_ROWS - 1) return true;
    return isWorldSolid(tx, ty + 1) || shadowSet.has(`${tx},${ty + 1}`);
  }

  for (let pass = 0; pass < 2; pass++) {
    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        if (isWorldSolid(tx, ty)) continue;
        if (tileIsLit(tx, ty)) continue;
        if (supported(tx, ty, next)) next.add(`${tx},${ty}`);
      }
    }
  }
  solidShadow = next;
}

// ---------- DRAW: PLAYER ----------
function drawHuman(px, py, animT) {
  const cx = px + player.w / 2;
  const top = py;
  const walk = Math.sin(animT * 10) * 4;

  const squash = Math.max(0, player.squish);
  const sx = 1 + squash * 0.12;
  const sy = 1 - squash * 0.14;

  const blink = spawnIFrame > 0 ? (Math.sin(performance.now() / 55) > 0) : true;
  if (!blink) return;

  ctx.save();
  ctx.translate(cx, top + 16);
  ctx.scale(sx, sy);
  ctx.translate(-cx, -(top + 16));

  ctx.fillStyle = "rgba(108,255,214,0.20)";
  ctx.beginPath();
  ctx.arc(cx, top + 16, 18, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = COLORS.player;
  ctx.beginPath();
  ctx.arc(cx, top + 7, 6, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillRect(cx - 5, top + 13, 10, 10);
  ctx.fillRect(cx - 9, top + 14, 4, 6);
  ctx.fillRect(cx + 5, top + 14, 4, 6);

  const legY = top + 23;
  ctx.fillRect(cx - 6, legY, 4, 8 + walk * 0.15);
  ctx.fillRect(cx + 2, legY, 4, 8 - walk * 0.15);

  ctx.strokeStyle = COLORS.accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - 3, top + 7);
  ctx.lineTo(cx + 3, top + 7);
  ctx.stroke();

  ctx.restore();
}

// ---------- DRAW: PRO KEY ----------
function drawKey(x, y, t, collected) {
  if (collected) return;

  const floatY = Math.sin(t * 2.2) * 4;
  const rot = Math.sin(t * 1.4) * 0.12;

  ctx.save();
  ctx.translate(x, y + floatY);
  ctx.rotate(rot);

  const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 28);
  glow.addColorStop(0, "rgba(255,230,109,0.35)");
  glow.addColorStop(0.6, "rgba(255,230,109,0.14)");
  glow.addColorStop(1, "rgba(255,230,109,0.00)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, 28, 0, Math.PI * 2);
  ctx.fill();

  const metal = ctx.createLinearGradient(-18, -10, 18, 10);
  metal.addColorStop(0, "#fff2b3");
  metal.addColorStop(0.35, "#ffd86b");
  metal.addColorStop(0.7, "#ffbf3f");
  metal.addColorStop(1, "#fff0a6");

  ctx.fillStyle = metal;
  ctx.strokeStyle = "rgba(0,0,0,0.30)";
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.arc(-10, 0, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.arc(-10, 0, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";

  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.roundRect(-4, -3, 22, 6, 3);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.roundRect(12, 1, 6, 8, 2);
  ctx.roundRect(18, -1, 6, 10, 2);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = "rgba(255,255,255,0.45)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-2, -2);
  ctx.lineTo(14, -2);
  ctx.stroke();

  ctx.restore();
}

// ---------- DRAW: CHECKPOINT ----------
function drawCheckpoint() {
  if (!checkpoint.active) return;
  const t = performance.now() / 1000;
  const pulse = 0.5 + 0.5 * Math.sin(t * 2.5);
  const col = checkpoint.used ? "rgba(199,125,255,0.25)" : `rgba(199,125,255,${0.18 + pulse * 0.18})`;

  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.arc(checkpoint.x, checkpoint.y, checkpoint.r + 14, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = checkpoint.used ? "rgba(199,125,255,0.95)" : "rgba(199,125,255,0.75)";
  ctx.beginPath();
  ctx.arc(checkpoint.x, checkpoint.y, checkpoint.r, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = COLORS.bg;
  ctx.font = "12px system-ui, Segoe UI, Arial";
  ctx.fillText("CP", checkpoint.x - 10, checkpoint.y + 4);
}

// ---------- DRAW: FLAG ----------
function drawFlag(f) {
  const poleX = f.x + 6;
  const poleTop = f.y;
  const poleBottom = f.y + f.h;

  ctx.strokeStyle = "rgba(230,241,255,0.55)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(poleX, poleTop);
  ctx.lineTo(poleX, poleBottom);
  ctx.stroke();

  const t = performance.now() / 250;
  const wave = Math.sin(t) * 3;
  const flagColor = f.locked ? COLORS.danger : "#ffd166";

  ctx.fillStyle = flagColor + "22";
  ctx.fillRect(poleX + 2, poleTop + 6, 26, 22);

  ctx.fillStyle = flagColor;
  ctx.beginPath();
  ctx.moveTo(poleX, poleTop + 6);
  ctx.lineTo(poleX + 22, poleTop + 10 + wave);
  ctx.lineTo(poleX + 22, poleTop + 26 + wave);
  ctx.lineTo(poleX, poleTop + 22);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = COLORS.bg;
  ctx.font = "12px system-ui, Segoe UI, Arial";
  ctx.fillText(f.locked ? "LOCK" : "GO", poleX + 3, poleTop + 20);
}

// ---------- DRAW: LIGHT ----------
function drawLightCone() {
  ctx.save();
  ctx.translate(light.x, light.y);
  ctx.rotate(light.angle);
  const r = light.range;
  const a = light.cone * 0.5;

  const grd = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
  grd.addColorStop(0, "rgba(140, 220, 255, 0.25)");
  grd.addColorStop(0.6, "rgba(140, 220, 255, 0.10)");
  grd.addColorStop(1, "rgba(140, 220, 255, 0.00)");
  ctx.fillStyle = grd;

  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, r, -a, a);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = COLORS.accent;
  ctx.beginPath();
  ctx.arc(light.x, light.y, 6, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(154,230,255,0.22)";
  ctx.beginPath();
  ctx.arc(light.x, light.y, 14, 0, Math.PI * 2);
  ctx.fill();
}
function drawDustInLight() {
  for (const d of dust) {
    const wx = d.x + camera.x * 0.05;
    const wy = d.y;
    if (pointIsLit(wx, wy)) {
      ctx.fillStyle = `rgba(180,240,255,${d.a})`;
      ctx.beginPath();
      ctx.arc(wx, wy, d.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// ---------- MAIN LOOP ----------
let last = performance.now();
requestAnimationFrame(frame);
function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;

  update(dt);
  render();
  pressed.clear();

  requestAnimationFrame(frame);
}

// ---------- UPDATE ----------
let rotateSoundCooldown = 0;

function update(dt) {
  updateParticles(dt);
  updateDust(dt);
  if (rotateSoundCooldown > 0) rotateSoundCooldown -= dt;
  if (dashCooldown > 0) dashCooldown -= dt;

  if (spawnIFrame > 0) spawnIFrame -= dt;
  if (dashTrailT > 0) dashTrailT -= dt;

  if (state === State.MENU) {
    if (wasPressed("Enter")) loadLevel(0);
    return;
  }
  if (state === State.WIN) {
    if (wasPressed("KeyN")) loadLevel(levelIndex + 1);
    if (wasPressed("KeyR")) loadLevel(levelIndex);
    return;
  }
  if (state === State.GAMEOVER) {
    if (wasPressed("KeyR")) loadLevel(levelIndex);
    return;
  }

  // PRO toggles
  if (wasPressed("KeyM")) {
    SETTINGS.mute = !SETTINGS.mute;
    if (!SETTINGS.mute) ensureAudio();
  }
  if (wasPressed("KeyV")) SETTINGS.reduceShake = !SETTINGS.reduceShake;

  elapsed = (performance.now() - timeStart) / 1000;

  // rotate light
  const rotSpeed = 1.6;
  let rotated = false;
  if (keys.has("KeyQ")) { light.angle -= rotSpeed * dt; rotated = true; }
  if (keys.has("KeyE")) { light.angle += rotSpeed * dt; rotated = true; }
  light.angle = wrapAngle(light.angle);

  if (rotated) {
    const stepNow = Math.round(light.angle / ROT_STEP);
    const diff = Math.abs(stepNow - lastRotStep);
    if (diff > 0) {
      rotations += diff;
      lastRotStep = stepNow;
    }
    if (rotateSoundCooldown <= 0) {
      sfxRotate();
      rotateSoundCooldown = 0.08;
    }
  }

  // dash start
  const dashPressed = wasPressed("ShiftLeft") || wasPressed("ShiftRight");
  if (dashPressed && dashCooldown <= 0 && dashTime <= 0) {
    dashTime = DASH_DUR;
    dashCooldown = DASH_COOLDOWN;
    sfxDash();
    addShake(0.20);
    dashTrailT = 0.14;
  }

  // move input
  let ax = 0;
  if (keys.has("ArrowLeft") || keys.has("KeyA")) ax -= 1;
  if (keys.has("ArrowRight") || keys.has("KeyD")) ax += 1;

  // compute shadows BEFORE collisions
  computeShadowPlatforms();

  // Jump pressed-edge + buffer/coyote
  const jumpHeld = keys.has("ArrowUp") || keys.has("KeyW") || keys.has("Space");
  const jumpPressed = jumpHeld && !prevJumpHeld;
  prevJumpHeld = jumpHeld;

  if (jumpPressed) jumpBuffer = 0.12;
  else jumpBuffer = Math.max(0, jumpBuffer - dt);

  if (player.onGround) coyoteTime = 0.10;
  else coyoteTime = Math.max(0, coyoteTime - dt);

  // wall slide
  const touchingWall = player.wallDir !== 0;
  const wantsMove = ax !== 0;

  if (!player.onGround && touchingWall && wantsMove && player.vy > 0) {
    player.vy = Math.min(player.vy, WALL_SLIDE_SPEED);
  }

  // wall jump
  if (jumpBuffer > 0 && !player.onGround && touchingWall) {
    player.vy = -WALL_JUMP_Y;
    player.vx = -player.wallDir * WALL_JUMP_X;
    jumpBuffer = 0;
    coyoteTime = 0;
    addShake(0.15);
    tone(420, 0.06, "triangle", 0.03);
  } else if (jumpBuffer > 0 && coyoteTime > 0) {
    player.vy = -JUMP;
    jumpBuffer = 0;
    coyoteTime = 0;
    tone(360, 0.05, "sine", 0.02);
  }

  // horizontal velocity
  if (dashTime > 0) {
    dashTime -= dt;
    const dir = (ax !== 0) ? Math.sign(ax) : (player.facing || 1);
    player.facing = dir;
    player.vx = dir * DASH_SPEED;
    player.vy *= 0.98;
  } else {
    player.vx = ax * MOVE;
    if (ax !== 0) player.facing = Math.sign(ax);
  }

  // gravity
  player.vy += GRAVITY * dt;

  // collide
  moveAndCollide(dt);

  // dash trail
  if (dashTrailT > 0) {
    const px = player.x + player.w * 0.5;
    const py = player.y + player.h * 0.65;
    spawnParticles(px, py, "rgba(154,230,255,ALPHA)", 2, 60);
  }

  // squish decay
  player.squish = Math.max(0, player.squish - dt * 6);

  // anim
  if (Math.abs(player.vx) > 1 && player.onGround) player.animT += dt;
  else player.animT += dt * 0.3;

  // fall death -> GAME OVER if no checkpoint yet, else respawn
  if (player.y > canvas.height + 220) {
    sfxDeath();
    if (!checkpoint.used) {
      state = State.GAMEOVER;
      addShake(0.35);
    } else {
      respawnToCheckpointOrStart();
    }
  }

  // checkpoint activate
  if (checkpoint.active && !checkpoint.used) {
    const pcx = player.x + player.w * 0.5;
    const pcy = player.y + player.h * 0.5;
    if (dist2(pcx, pcy, checkpoint.x, checkpoint.y) < (checkpoint.r + 14) ** 2) {
      checkpoint.used = true;
      spawnParticles(checkpoint.x, checkpoint.y, "rgba(199,125,255,ALPHA)", 22, 210);
      addShake(0.25);
      sfxCheckpoint();
    }
  }

  // scan (safe zone near finish)
  const pcx = player.x + player.w * 0.5;
  const pcy = player.y + player.h * 0.5;

  const safeZoneRadius = 110;
  const nearFinish = distPointToRect(pcx, pcy, finish) < safeZoneRadius;
  const inLight = (!nearFinish) && pointIsLit(pcx, pcy);

  const canBeScanned = spawnIFrame <= 0;
  if (canBeScanned && inLight) scanned = Math.min(1, scanned + dt * 2.0);
  else scanned = Math.max(0, scanned - dt * 5.5);
  if (nearFinish) scanned = Math.max(0, scanned - dt * 10);

  const blocked = scanned > 0.25;

  // key pickup
  if (!keyObj.collected) {
    if (dist2(pcx, pcy, keyObj.x, keyObj.y) <= (keyObj.r + 14) ** 2) {
      keyObj.collected = true;
      finish.locked = false;
      spawnParticles(keyObj.x, keyObj.y, "rgba(255,230,109,ALPHA)", 30, 250);
      addShake(0.35);
      sfxKey();
    }
  }

  // restart
  if (wasPressed("KeyR")) loadLevel(levelIndex);

  // win
  if (!finish.locked && !blocked && overlapsRect(player, finish)) {
    won = true;
    spawnParticles(finish.x + 12, finish.y + 16, "rgba(154,230,255,ALPHA)", 36, 290);
    addShake(0.55);
    sfxWin();

    const old = getRecord(levelIndex);
    if (isBetter(elapsed, rotations, old)) setRecord(levelIndex, elapsed, rotations);

    state = State.WIN;
  }

  // camera follow (smooth)
  const lookAhead = (dashTime > 0 ? 90 : 55) * (player.facing || 1);
  const targetX = (player.x + player.w / 2 + lookAhead) - canvas.width / 2;

  const worldW = WORLD_COLS * tileSize;
  camera.x = lerp(camera.x, targetX, 1 - Math.pow(0.001, dt));
  camera.x = clamp(camera.x, 0, Math.max(0, worldW - canvas.width));
  camera.y = 0;

  // shake update
  camera.shake = Math.max(0, camera.shake - dt * 2.5);
  const ss = camera.shake * camera.shake;
  const shakeMul = SETTINGS.reduceShake ? 0.35 : 1.0;
  camera.shakeX = (Math.random() * 2 - 1) * 8 * ss * shakeMul;
  camera.shakeY = (Math.random() * 2 - 1) * 6 * ss * shakeMul;
}

// ---------- RENDER ----------
function render() {
  drawBackground();

  // world transform
  ctx.save();
  ctx.translate(-camera.x + camera.shakeX, -camera.y + camera.shakeY);

  // shadow tiles
  for (const s of solidShadow) {
    const [tx, ty] = s.split(",").map(Number);
    const x = tx * tileSize, y = ty * tileSize;

    ctx.fillStyle = COLORS.shadow;
    ctx.fillRect(x, y, tileSize, tileSize);

    ctx.fillStyle = COLORS.shadowHi;
    ctx.fillRect(x, y, tileSize, 4);

    ctx.strokeStyle = "rgba(154,230,255,0.08)";
    ctx.strokeRect(x + 0.5, y + 0.5, tileSize - 1, tileSize - 1);
  }

  // world tiles
  for (const s of solidWorld) {
    const [tx, ty] = s.split(",").map(Number);
    const x = tx * tileSize, y = ty * tileSize;

    ctx.fillStyle = COLORS.world;
    ctx.fillRect(x, y, tileSize, tileSize);

    ctx.fillStyle = "rgba(230,241,255,0.06)";
    ctx.fillRect(x, y, tileSize, 3);

    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(x + tileSize - 3, y, 3, tileSize);

    ctx.fillStyle = "rgba(0,0,0,0.14)";
    ctx.fillRect(x, y + tileSize - 3, tileSize, 3);
  }

  // light + dust
  drawLightCone();
  drawDustInLight();

  // checkpoint
  drawCheckpoint();

  // key
  drawKey(keyObj.x, keyObj.y, performance.now() / 1000, keyObj.collected);

  // flag
  drawFlag(finish);

  // player
  drawHuman(player.x, player.y, player.animT);

  // particles
  drawParticles();

  ctx.restore();

  // UI / overlays
  if (state === State.MENU) {
    drawPanel(200, 140, 560, 300, 0.62);
    ctx.fillStyle = COLORS.title;
    ctx.font = "52px system-ui, Segoe UI, Arial";
    ctx.fillText("Shadow Smith", 315, 220);

    ctx.fillStyle = COLORS.uiText;
    ctx.font = "18px system-ui, Segoe UI, Arial";
    ctx.fillText("Click canvas to focus keyboard + enable sound.", 270, 262);
    ctx.fillText("Move: A/D or Arrows   Jump: W/Up/Space   Dash: Shift", 230, 294);
    ctx.fillText("Rotate Light: Q/E   Shadows become platforms.", 290, 326);

    ctx.fillStyle = COLORS.uiDim;
    ctx.font = "14px system-ui, Segoe UI, Arial";
    ctx.fillText("SCANNED blocks finishing, but the flag area is a SAFE ZONE.", 240, 358);

    ctx.fillStyle = COLORS.accent;
    ctx.font = "22px system-ui, Segoe UI, Arial";
    ctx.fillText("Press ENTER to start", 350, 402);
    return;
  }

  const L = LEVELS[levelIndex];
  drawPanel(14, 12, 720, 162, 0.50);

  ctx.fillStyle = COLORS.uiText;
  ctx.font = "16px system-ui, Segoe UI, Arial";
  ctx.fillText(L.name, 26, 36);

  ctx.fillStyle = COLORS.uiDim;
  ctx.font = "13px system-ui, Segoe UI, Arial";
  ctx.fillText(L.tip, 26, 58);

  ctx.fillStyle = COLORS.uiText;
  ctx.font = "15px system-ui, Segoe UI, Arial";
  ctx.fillText(`Time: ${elapsed.toFixed(1)}s`, 26, 86);
  ctx.fillText(`Level: ${levelIndex + 1}/${LEVELS.length}`, 160, 86);
  ctx.fillText(`Rotations: ${rotations}`, 300, 86);
  ctx.fillText(`Dash: ${dashCooldown > 0 ? dashCooldown.toFixed(1) + "s" : "READY"}`, 430, 86);

  ctx.fillText(`Key: ${keyObj.collected ? "Collected" : "Not collected"}`, 26, 110);
  ctx.fillText(`Checkpoint: ${checkpoint.used ? "Active" : "Not reached"}`, 200, 110);

  const rec = getRecord(levelIndex);
  ctx.fillStyle = COLORS.uiDim;
  ctx.font = "12px system-ui, Segoe UI, Arial";
  ctx.fillText(`Best: ${rec ? rec.time.toFixed(1) + "s / " + rec.rotations + " rot" : "-"}`, 430, 110);

  // scan meter
  ctx.fillStyle = "rgba(255,92,92,0.10)";
  ctx.fillRect(26, 124, 220, 10);
  ctx.fillStyle = "rgba(255,92,92,0.70)";
  ctx.fillRect(26, 124, 220 * scanned, 10);
  ctx.strokeStyle = "rgba(255,92,92,0.55)";
  ctx.strokeRect(26, 124, 220, 10);

  ctx.fillStyle = "#ffb3b3";
  ctx.font = "12px system-ui, Segoe UI, Arial";
  ctx.fillText(scanned > 0.01 ? "SCANNED" : "SCAN METER", 255, 133);

  // SAFE ZONE label
  const pcx = player.x + player.w * 0.5;
  const pcy = player.y + player.h * 0.5;
  const safeZoneRadius = 110;
  const nearFinish = distPointToRect(pcx, pcy, finish) < safeZoneRadius;
  if (nearFinish) {
    ctx.fillStyle = "rgba(154,230,255,0.95)";
    ctx.font = "12px system-ui, Segoe UI, Arial";
    ctx.fillText("SAFE ZONE", 340, 133);
  }

  ctx.fillStyle = COLORS.uiDim;
  ctx.font = "12px system-ui, Segoe UI, Arial";
  ctx.fillText("R: restart   N: next (after win)   M: mute   V: reduce shake", 26, 156);

  if (state === State.WIN) {
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawPanel(220, 185, 520, 210, 0.62);

    ctx.fillStyle = COLORS.title;
    ctx.font = "52px system-ui, Segoe UI, Arial";
    ctx.fillText("LEVEL CLEARED!", 250, 265);

    ctx.fillStyle = COLORS.uiText;
    ctx.font = "20px system-ui, Segoe UI, Arial";
    ctx.fillText(`Time: ${elapsed.toFixed(1)}s   Rotations: ${rotations}`, 300, 305);

    const r = getRecord(levelIndex);
    ctx.fillStyle = COLORS.uiDim;
    ctx.font = "14px system-ui, Segoe UI, Arial";
    ctx.fillText(`Record saved if better. Best: ${r ? r.time.toFixed(1) + "s / " + r.rotations : "-"}`, 300, 330);

    ctx.fillStyle = COLORS.accent;
    ctx.font = "18px system-ui, Segoe UI, Arial";
    ctx.fillText("Press N for next level, or R to retry", 275, 365);
  }

  if (state === State.GAMEOVER) {
    ctx.fillStyle = "rgba(0,0,0,0.72)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawPanel(260, 200, 440, 180, 0.62);

    ctx.fillStyle = COLORS.danger;
    ctx.font = "56px system-ui, Segoe UI, Arial";
    ctx.fillText("GAME OVER", 290, 275);

    ctx.fillStyle = COLORS.uiText;
    ctx.font = "20px system-ui, Segoe UI, Arial";
    ctx.fillText("Press R to restart", 360, 330);
  }
}

// NOTE: expects an HTML canvas with id="c" in the page.