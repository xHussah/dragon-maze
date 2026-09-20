// ═══════════════════════════════════════════════════════════
//  DRAGON'S MAZE — game.js
//  All game logic: grid, rendering, movement, AI, levels
// ═══════════════════════════════════════════════════════════

// ── Cell type constants ──────────────────────────────────
const EMPTY    = 0;
const OBSTACLE = 1;
const REWARD   = 2;
const DOOR     = 3;
const PLAYER   = 4;
const DRAGON   = 5;

// ── Colours used on the canvas ───────────────────────────
const COL = {
  ground:      '#1a1a2e',
  groundLine:  '#16213e',
  obstacle:    '#2d5a27',
  obstacleTop: '#4a8a3e',
  door:        '#f5c842',
  doorGlow:    '#a88820',
  reward:      '#ffe066',
  rewardGlow:  '#ffaa00',
  playerBody:  '#3a7bd5',
  playerSkin:  '#f5c0a0',
  dragonBody:  '#cc2200',
  dragonWing:  '#881500',
  safeFlash:   'rgba(76,255,145,0.18)',
  fogEdge:     'rgba(13,13,26,0.92)',
};

// ═══════════════════════════════════════════════════════════
//  SOUND ENGINE  (Web Audio API — no files needed)
// ═══════════════════════════════════════════════════════════
const Audio = (() => {
  let ctx = null;

  // Lazy-init AudioContext on first user interaction (browser requirement)
  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    return ctx;
  }

  // Core: play a tone with an envelope
  function tone(freq, type, gainPeak, attackSec, decaySec, startHz = null) {
    const ac  = getCtx();
    const osc = ac.createOscillator();
    const env = ac.createGain();

    osc.connect(env);
    env.connect(ac.destination);

    osc.type = type;

    // Optional frequency sweep (e.g. for step sound)
    if (startHz) {
      osc.frequency.setValueAtTime(startHz, ac.currentTime);
      osc.frequency.linearRampToValueAtTime(freq, ac.currentTime + attackSec);
    } else {
      osc.frequency.setValueAtTime(freq, ac.currentTime);
    }

    // Gain envelope: attack → decay → silence
    env.gain.setValueAtTime(0, ac.currentTime);
    env.gain.linearRampToValueAtTime(gainPeak, ac.currentTime + attackSec);
    env.gain.linearRampToValueAtTime(0, ac.currentTime + attackSec + decaySec);

    osc.start(ac.currentTime);
    osc.stop(ac.currentTime + attackSec + decaySec + 0.01);
  }

  // Schedule two tones together
  function chord(freqs, type, gainPeak, attackSec, decaySec) {
    freqs.forEach(f => tone(f, type, gainPeak, attackSec, decaySec));
  }

  return {
    // Soft tick on each player step
    step() {
      tone(520, 'sine', 0.08, 0.01, 0.08, 440);
    },

    // Collect a reward — bright ascending chime
    reward() {
      tone(660, 'sine', 0.18, 0.02, 0.12);
      setTimeout(() => tone(880, 'sine', 0.14, 0.02, 0.15), 80);
      setTimeout(() => tone(1100, 'sine', 0.10, 0.02, 0.2), 180);
    },

    // Win — triumphant fanfare
    win() {
      const ac = getCtx();
      const notes = [523, 659, 784, 1047]; // C5 E5 G5 C6
      notes.forEach((f, i) => {
        setTimeout(() => tone(f, 'triangle', 0.22, 0.04, 0.25), i * 120);
      });
      // Final chord
      setTimeout(() => chord([523, 659, 784], 'triangle', 0.18, 0.05, 0.6), 520);
    },

    // Game over — descending growl
    gameover() {
      tone(220, 'sawtooth', 0.2,  0.02, 0.18);
      setTimeout(() => tone(180, 'sawtooth', 0.18, 0.02, 0.2),  150);
      setTimeout(() => tone(140, 'sawtooth', 0.15, 0.02, 0.35), 320);
      setTimeout(() => tone(100, 'sawtooth', 0.12, 0.03, 0.5),  500);
    },

    // Surprise banner — sharp alert ping
    surprise() {
      tone(900, 'square', 0.12, 0.01, 0.06);
      setTimeout(() => tone(700, 'square', 0.09, 0.01, 0.08), 90);
    },

    // Blocked move — short dull thud
    blocked() {
      tone(130, 'triangle', 0.1, 0.01, 0.07);
    },

    // Level start jingle — short upbeat intro
    levelStart() {
      tone(392, 'triangle', 0.15, 0.03, 0.12);
      setTimeout(() => tone(523, 'triangle', 0.15, 0.03, 0.12), 140);
      setTimeout(() => tone(659, 'triangle', 0.18, 0.03, 0.25), 280);
    },

    // Legendary win — full orchestral fanfare for completing all 7 levels
    legendary() {
      // Rising arpeggio
      const notes = [262, 330, 392, 523, 659, 784, 1047];
      notes.forEach((f, i) => {
        setTimeout(() => tone(f, 'triangle', 0.2, 0.04, 0.2), i * 80);
      });
      // Big chord at the end
      setTimeout(() => {
        chord([523, 659, 784, 1047], 'triangle', 0.22, 0.06, 0.8);
      }, notes.length * 80 + 100);
      // Final triumphant hold
      setTimeout(() => {
        tone(1047, 'sine', 0.15, 0.05, 1.2);
      }, notes.length * 80 + 500);
    },
  };
})();

// ── Level definitions ─────────────────────────────────────
// Each level: gridSize, player start, door pos, dragon start,
// obstacles (array of [r,c]), rewards (array of [r,c]),
// dragonRandomness (0=perfect, 1=fully random),
// surprise type ('none'|'falling_reward'|'speed_burst'|'fog'|'two_dragons')
const LEVELS = [
  { // 1 — tutorial: player bottom-left, door top-right (classic diagonal)
    size: 5,
    player:  [4, 0],
    door:    [0, 4],
    dragons: [[0, 1]],
    obstacles: [[1,1],[2,3],[3,2],[1,3]],
    rewards:   [[2,1],[3,3]],
    dragonRandomness: 0.35,
    visionRadius: 4,
    surprise: 'none',
    name: 'THE BEGINNING',
  },
  { // 2 — player top-left, door bottom-right — dragon starts centre
    size: 6,
    player:  [0, 0],
    door:    [5, 5],
    dragons: [[2, 3]],
    obstacles: [[1,2],[2,1],[3,4],[4,2],[2,4],[0,3],[4,4]],
    rewards:   [[3,1],[1,4],[4,3]],
    dragonRandomness: 0.2,
    visionRadius: 5,
    surprise: 'none',
    name: 'THE HUNT BEGINS',
  },
  { // 3 — player mid-right, door mid-left — cross the field with falling rewards
    size: 7,
    player:  [3, 6],
    door:    [3, 0],
    dragons: [[0, 3]],
    obstacles: [[1,1],[2,2],[2,5],[4,2],[4,5],[5,1],[5,5],[1,5],[0,5],[6,3]],
    rewards:   [[1,3],[5,3],[3,4]],
    dragonRandomness: 0.15,
    visionRadius: 6,
    surprise: 'falling_reward',
    name: 'VANISHING STARS',
  },
  { // 4 — player bottom-right, door top-left — dragon starts opposite corner
    size: 7,
    player:  [6, 6],
    door:    [0, 0],
    dragons: [[6, 0]],
    obstacles: [[1,2],[2,1],[3,3],[4,5],[5,2],[3,5],[6,4]],
    rewards:   [[4,3],[2,4]],
    dragonRandomness: 0.1,
    visionRadius: 7,
    surprise: 'none',
    name: 'TIGHT CORRIDORS',
  },
  { // 5 — player top-right, door bottom-left — long diagonal under speed burst
    size: 8,
    player:  [0, 7],
    door:    [7, 0],
    dragons: [[0, 0]],
    obstacles: [[1,5],[2,3],[3,6],[4,2],[4,5],[5,3],[5,6],[6,1],[6,5],[2,1],[3,3]],
    rewards:   [[2,6],[4,4],[6,2]],
    dragonRandomness: 0.08,
    visionRadius: 8,
    surprise: 'speed_burst',
    name: 'DRAGON FURY',
  },
  { // 6 — fog of war: trees scattered across full grid like a real forest
    //     verified solvable in 10 steps — disorientating in the dark
    size: 9,
    player:  [8, 4],
    door:    [0, 4],
    dragons: [[0, 0]],
    obstacles: [
      [1,1],[1,6],
      [2,3],[2,7],
      [3,1],[3,5],[3,8],
      [4,3],[4,7],
      [5,1],[5,5],[5,8],
      [6,2],[6,6],
      [7,1],[7,4],[7,7],
      [8,2],[8,6],
    ],
    rewards:   [[2,1],[4,6],[6,3],[1,7]],
    dragonRandomness: 0.05,
    visionRadius: 9,
    surprise: 'fog',
    name: 'SHROUDED IN DARKNESS',
  },
  { // 7 — two dragons: player centre, door centre-opposite side
    //     dragons flank from both corners
    size: 10,
    player:  [9, 5],
    door:    [0, 4],
    dragons: [[0, 0],[0, 9]],
    obstacles: [
      [1,2],[1,7],[2,1],[2,5],[2,8],
      [3,3],[3,6],[4,2],[4,7],[4,9],
      [5,1],[5,4],[5,8],[6,3],[6,6],
      [7,2],[7,5],[7,8],[8,1],[8,4],[8,7],
      [3,0],[6,9],
    ],
    rewards:   [[4,5],[6,2],[6,8]],
    dragonRandomness: 0.0,
    visionRadius: 10,
    surprise: 'none',
    name: 'THE FINAL MAZE',
  },
];

// ── Win messages per level ────────────────────────────────
const WIN_MESSAGES = [
  'Great start, adventurer!',
  'The dragon underestimated you!',
  'You outsmarted the beast!',
  'Those corridors were no match for you!',
  'You outran the fury!',
  'You navigated the darkness!',
  'LEGENDARY. You beat the Dragon\'s Maze!',
];

// ═══════════════════════════════════════════════════════════
//  GAME STATE
// ═══════════════════════════════════════════════════════════
let state = {
  level:         0,       // 0-indexed
  grid:          [],      // 2D array of cell types
  playerPos:     [0,0],   // [row, col]
  dragonPositions: [],    // array of [row,col]
  rewardPositions: [],    // current reward positions
  doorPos:       [0,0],
  rewardsCollected: 0,
  safeMovesLeft: 0,       // turns dragon is frozen after reward
  dragonFrozen:  false,
  speedBurstActive: false,
  speedBurstTurns: 0,

  // Timer
  timerSeconds:  0,
  timerInterval: null,

  // Falling reward surprise
  fallingReward:    null,   // {pos:[r,c], turnsLeft:3} or null
  fallingInterval:  null,

  // Fog
  fogActive: false,
  FOG_RADIUS: 2,

  // Animation
  animFrame: null,
  glowPhase: 0,            // 0-2π, used for pulsing glows

  // Game flags
  running: false,
  gameOver: false,
  activePolicy: null,
  policyStatus: 'loading',   // 'loading' | 'loaded' | 'unavailable'
};

// ═══════════════════════════════════════════════════════════
//  DOM REFERENCES
// ═══════════════════════════════════════════════════════════
const canvas      = document.getElementById('game-canvas');
const ctx         = canvas.getContext('2d');
const fogCanvas   = document.getElementById('fog-canvas');
const fogCtx      = fogCanvas.getContext('2d');

const introScreen        = document.getElementById('intro-screen');
const instructionsScreen = document.getElementById('instructions-screen');
const winScreen          = document.getElementById('win-screen');
const gameoverScreen     = document.getElementById('gameover-screen');
const hud                = document.getElementById('hud');
const surpriseBanner     = document.getElementById('surprise-banner');
const levelBadge         = document.getElementById('level-badge');

const hudTimer   = document.getElementById('hud-timer');
const hudLevel   = document.getElementById('hud-level');
const hudReward  = document.getElementById('hud-reward');

// ═══════════════════════════════════════════════════════════
//  SCREEN HELPERS
// ═══════════════════════════════════════════════════════════
function showScreen(el)  { el.classList.remove('hidden'); }
function hideScreen(el)  { el.classList.add('hidden'); }
function hideAllScreens() {
  [introScreen, instructionsScreen, winScreen, gameoverScreen].forEach(hideScreen);
}

// ═══════════════════════════════════════════════════════════
//  CANVAS SIZING
// ═══════════════════════════════════════════════════════════
let CELL = 60; // pixels per cell, recalculated on resize

function resizeCanvas() {
  const level  = LEVELS[state.level];
  const size   = level ? level.size : 5;
  const wrap   = document.getElementById('game-wrap');
  const maxW   = wrap.clientWidth  - 16;
  const maxH   = wrap.clientHeight - 16;
  CELL         = Math.floor(Math.min(maxW, maxH) / size);
  const dim    = CELL * size;
  canvas.width  = dim;
  canvas.height = dim;
  fogCanvas.width  = fogCanvas.offsetWidth;
  fogCanvas.height = fogCanvas.offsetHeight;
}

window.addEventListener('resize', () => { resizeCanvas(); drawAll(); });

// ═══════════════════════════════════════════════════════════
//  LEVEL INITIALISATION
// ═══════════════════════════════════════════════════════════

// ── Backend address ──────────────────────────────────────
// Live site (CloudFront): '' = same origin, so /policy/N goes through
// CloudFront to the backend over HTTPS (no mixed content, no CORS).
// Local testing (localhost): talk to the backend on port 8000.
const API_BASE = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
  ? 'http://localhost:8000'
  : '';

// ── Agent diagnostics ────────────────────────────────────
// policy   = times the dragon used a move from the trained Q-table
// fallback = times it used plain BFS pathfinding instead
// (type  agentStats  in the browser console to inspect it)
const agentStats = { policy: 0, fallback: 0 };

// Small "AGENT" indicator added to the HUD
const hudAgent = (() => {
  const item = document.createElement('div');
  item.className = 'hud-item';
  item.innerHTML = '<div class="hud-label">AGENT</div><div class="hud-value" style="font-size:9px">--</div>';
  hud.appendChild(item);
  return item.querySelector('.hud-value');
})();

function updateAgentHud() {
  if (state.policyStatus === 'loading') {
    hudAgent.textContent = 'LOADING';
    hudAgent.style.color = '#f5c842';
  } else if (state.policyStatus === 'unavailable') {
    hudAgent.textContent = 'OFFLINE';
    hudAgent.style.color = '#ff5555';
  } else {
    const total = agentStats.policy + agentStats.fallback;
    hudAgent.textContent = total ? `AI ${Math.round(100 * agentStats.policy / total)}%` : 'AI READY';
    hudAgent.style.color = '#4cff91';
  }
}

async function loadPolicy(levelIndex) {
  try {
    const res = await fetch(`${API_BASE}/policy/${levelIndex + 1}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    console.info(`[Agent] Level ${levelIndex + 1}: policy loaded (${Object.keys(data.q_table).length} states)`);
    return data.q_table;
  } catch (err) {
    console.warn(`[Agent] Level ${levelIndex + 1}: policy NOT loaded - dragon uses pathfinding fallback.`, err);
    return null;
  }
}

function initLevel(levelIndex) {
  const def = LEVELS[levelIndex];
  state.level           = levelIndex;
  state.rewardsCollected= 0;
  state.safeMovesLeft   = 0;
  state.dragonFrozen    = false;
  state.speedBurstActive= false;
  state.speedBurstTurns = 0;
  state.fallingReward   = null;
  state.gameOver        = false;
  state.running         = true;
  state.activePolicy = null;
  state.policyStatus = 'loading';
  agentStats.policy = 0;
  agentStats.fallback = 0;
  updateAgentHud();
  loadPolicy(levelIndex).then(p => {
    if (state.level !== levelIndex) return;   // player already moved to another level
    state.activePolicy = p;
    state.policyStatus = p ? 'loaded' : 'unavailable';
    updateAgentHud();
  });
  state.fogActive       = def.surprise === 'fog';
  state.glowPhase       = 0;

  // Clear dragon memory
  Object.keys(dragonMemory).forEach(k => delete dragonMemory[k]);

  // Build clean grid
  const S = def.size;
  state.grid = Array.from({length: S}, () => Array(S).fill(EMPTY));

  // Place static elements
  def.obstacles.forEach(([r,c]) => { state.grid[r][c] = OBSTACLE; });
  state.rewardPositions = def.rewards.map(pos => [...pos]);
  state.rewardPositions.forEach(([r,c]) => { state.grid[r][c] = REWARD; });
  state.doorPos   = [...def.door];
  state.grid[def.door[0]][def.door[1]] = DOOR;
  state.playerPos = [...def.player];
  state.dragonPositions = def.dragons.map(d => [...d]);

  // HUD
  hudLevel.textContent = levelIndex + 1;
  hudReward.textContent = 0;

  // Resize + draw
  resizeCanvas();

  // Start timer
  clearInterval(state.timerInterval);
  state.timerSeconds = 0;
  updateTimerDisplay();
  state.timerInterval = setInterval(() => {
    if (state.running) {
      state.timerSeconds++;
      updateTimerDisplay();
    }
  }, 1000);

  // Show level badge briefly
  showLevelBadge(levelIndex);

  // Kick off falling reward if needed
  if (def.surprise === 'falling_reward') scheduleFallingReward();

  // Start render loop
  cancelAnimationFrame(state.animFrame);
  renderLoop();
}

function showLevelBadge(idx) {
  const badge   = levelBadge;
  const numEl   = document.getElementById('badge-num');
  numEl.textContent = (idx + 1) + ' — ' + LEVELS[idx].name;
  badge.classList.add('show');
  Audio.levelStart();
  setTimeout(() => badge.classList.remove('show'), 2000);
}

function updateTimerDisplay() {
  const m = String(Math.floor(state.timerSeconds / 60)).padStart(2,'0');
  const s = String(state.timerSeconds % 60).padStart(2,'0');
  hudTimer.textContent = m + ':' + s;
}

// ═══════════════════════════════════════════════════════════
//  GRID HELPERS
// ═══════════════════════════════════════════════════════════
function inBounds(r, c) {
  const S = LEVELS[state.level].size;
  return r >= 0 && r < S && c >= 0 && c < S;
}

function cellAt(r, c) {
  if (!inBounds(r, c)) return -1;
  return state.grid[r][c];
}

function isWalkable(r, c, forDragon = false) {
  if (!inBounds(r, c)) return false;
  const cell = state.grid[r][c];
  if (cell === OBSTACLE) return false;
  if (forDragon) {
    // Dragon can't walk on door; player position is fine (catch)
    if (cell === DOOR) return false;
  }
  return true;
}

// ═══════════════════════════════════════════════════════════
//  VISION — radius check + last-known-position memory
// ═══════════════════════════════════════════════════════════

// Dragon remembers where it last saw the player
// key: dragon index → [r, c] or null
const dragonMemory = {};

function manhattanDist(a, b) {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
}

// Returns true if dragon can "see" the player:
// within visionRadius tiles (Manhattan) AND no wall directly between them
function canSeePlayer(dragonPos, dragonIndex) {
  const def    = LEVELS[state.level];
  const radius = def.visionRadius || 4;
  const dist   = manhattanDist(dragonPos, state.playerPos);
  if (dist > radius) return false;
  // Light obstacle check — only block sight if player is directly in-line
  return !directWallBlock(dragonPos, state.playerPos);
}

// Simple wall check: if moving in a straight line (same row or col),
// block sight only if there's an obstacle directly between them.
// Diagonal movement is always visible — this keeps the dragon active.
function directWallBlock(from, to) {
  const [r0, c0] = from;
  const [r1, c1] = to;
  if (r0 === r1) {
    // same row — check cells between
    const minC = Math.min(c0, c1), maxC = Math.max(c0, c1);
    for (let c = minC + 1; c < maxC; c++) {
      if (state.grid[r0][c] === OBSTACLE) return true;
    }
  } else if (c0 === c1) {
    // same col — check cells between
    const minR = Math.min(r0, r1), maxR = Math.max(r0, r1);
    for (let r = minR + 1; r < maxR; r++) {
      if (state.grid[r][c0] === OBSTACLE) return true;
    }
  }
  // Diagonal or mixed — visible
  return false;
}

// ═══════════════════════════════════════════════════════════
//  PLAYER MOVEMENT
// ═══════════════════════════════════════════════════════════
function movePlayer(dr, dc) {
  if (!state.running || state.gameOver) return;

  const [r, c] = state.playerPos;
  const nr = r + dr, nc = c + dc;

  if (!isWalkable(nr, nc)) {
    Audio.blocked();  // dull thud on wall hit
    return;
  }

  // Check door
  if (state.grid[nr][nc] === DOOR) {
    state.playerPos = [nr, nc];
    triggerWin();
    return;
  }

  // Move player
  Audio.step();  // soft tick on every valid move
  state.playerPos = [nr, nc];

  // Tick down a freeze that was ALREADY running. This must happen before
  // the reward check below, otherwise a star collected on this move would
  // lose its own freeze turn immediately (the old bug: stars never froze
  // the dragon).
  if (state.safeMovesLeft > 0) {
    state.safeMovesLeft--;
    state.dragonFrozen = state.safeMovesLeft > 0;
  }

  // Check reward collection (may start a new freeze)
  if (state.grid[nr][nc] === REWARD) collectReward(nr, nc);
  if (state.fallingReward &&
      state.fallingReward.pos[0] === nr &&
      state.fallingReward.pos[1] === nc) {
    collectFallingReward();
  }

  // Move dragon(s) in response
  moveDragons();

  // Check if dragon caught player after moving
  checkCaught();

  drawAll();
}

function collectReward(r, c) {
  state.grid[r][c] = EMPTY;
  state.rewardPositions = state.rewardPositions.filter(
    ([pr, pc]) => !(pr === r && pc === c)
  );
  state.rewardsCollected++;
  state.safeMovesLeft = 1;
  state.dragonFrozen  = true;
  hudReward.textContent = state.rewardsCollected;
  Audio.reward();  // ascending chime
}

// ═══════════════════════════════════════════════════════════
//  FALLING REWARD SURPRISE  (level 3+)
// ═══════════════════════════════════════════════════════════
function scheduleFallingReward() {
  // Drop a bonus reward after 8–14 player moves; it vanishes in 3 moves
  const delay = (8 + Math.floor(Math.random() * 6)) * 1200;
  setTimeout(() => {
    if (!state.running) return;
    dropFallingReward();
  }, delay);
}

function dropFallingReward() {
  const S = LEVELS[state.level].size;
  // Find a random empty cell
  let tries = 0, r, c;
  do {
    r = Math.floor(Math.random() * S);
    c = Math.floor(Math.random() * S);
    tries++;
  } while (
    tries < 100 &&
    (state.grid[r][c] !== EMPTY ||
     (r === state.playerPos[0] && c === state.playerPos[1]) ||
     state.dragonPositions.some(([dr,dc]) => dr===r && dc===c))
  );

  if (tries >= 100) return; // no space — skip

  state.fallingReward = { pos: [r, c], turnsLeft: 3 };
  showSurpriseBanner('⭐ BONUS STAR! Catch it in 3 moves!');
}

function tickFallingReward() {
  if (!state.fallingReward) return;
  state.fallingReward.turnsLeft--;
  if (state.fallingReward.turnsLeft <= 0) {
    // Vanish
    state.fallingReward = null;
    showSurpriseBanner('⭐ The star vanished!');
  }
}

function collectFallingReward() {
  state.fallingReward = null;
  state.rewardsCollected++;
  state.safeMovesLeft = 2; // falling rewards give 2 safe turns
  state.dragonFrozen  = true;
  hudReward.textContent = state.rewardsCollected;
  Audio.reward();
  showSurpriseBanner('⭐ BONUS STAR CAUGHT! +2 safe moves!');
}

// ═══════════════════════════════════════════════════════════
//  DRAGON MOVEMENT  (greedy + random)
// ═══════════════════════════════════════════════════════════
const DIRS = [[-1,0],[1,0],[0,-1],[0,1]];

function moveDragons() {
  if (state.dragonFrozen) return;

  const def  = LEVELS[state.level];
  const rand = def.dragonRandomness;

  state.dragonPositions = state.dragonPositions.map((dragonPos, idx) => {
    const sees = canSeePlayer(dragonPos, idx);

    if (sees) {
      // Update memory — dragon now knows where you are
      dragonMemory[idx] = [...state.playerPos];
    }

    // Dragon always moves:
    // - If it sees you → chase you directly
    // - If it doesn't → move toward last known position
    // - If no memory yet → wander randomly
    const target = sees
      ? state.playerPos
      : (dragonMemory[idx] || null);

    // Speed burst: move twice this turn
    const moves = (state.speedBurstActive && state.speedBurstTurns > 0) ? 2 : 1;
    let pos = dragonPos;
    for (let m = 0; m < moves; m++) {
      pos = dragonStepToward(pos, target, rand);
    }

    // If dragon reached last known position and player is gone — clear memory
    if (dragonMemory[idx] &&
        pos[0] === dragonMemory[idx][0] &&
        pos[1] === dragonMemory[idx][1] &&
        !sees) {
      dragonMemory[idx] = null;
    }

    // Decrement speed burst
    if (state.speedBurstActive) {
      state.speedBurstTurns--;
      if (state.speedBurstTurns <= 0) {
        state.speedBurstActive = false;
        state.speedBurstTurns  = 0;
      }
    }

    return pos;
  });

  updateAgentHud();

  // Tick falling reward after dragon moves
  tickFallingReward();

  // Maybe trigger speed burst (level 5)
  if (def.surprise === 'speed_burst' && !state.speedBurstActive) {
    if (Math.random() < 0.12) { // 12% chance each turn
      state.speedBurstActive = true;
      state.speedBurstTurns  = 2;
      showSurpriseBanner('🐉 DRAGON FURY! Speed burst activated!');
    }
  }
}

function dragonStepToward(dragonPos, target, randomness) {
  // No target (no memory) — wander randomly
  if (!target) {
    const shuffled = [...DIRS].sort(() => Math.random() - 0.5);
    for (const [dr, dc] of shuffled) {
      const nr = dragonPos[0] + dr, nc = dragonPos[1] + dc;
      if (isWalkable(nr, nc, true)) return [nr, nc];
    }
    return dragonPos;
  }

  // Already at target
  if (dragonPos[0] === target[0] && dragonPos[1] === target[1]) return dragonPos;

  // With probability `randomness`, pick a random valid direction instead of optimal
  if (Math.random() < randomness) {
    const shuffled = [...DIRS].sort(() => Math.random() - 0.5);
    for (const [dr, dc] of shuffled) {
      const nr = dragonPos[0] + dr, nc = dragonPos[1] + dc;
      if (isWalkable(nr, nc, true)) return [nr, nc];
    }
    return dragonPos;
  }

  // 1) Try the trained Q-table policy first
  if (state.activePolicy) {
    const key = `(${dragonPos[0]}, ${dragonPos[1]}, ${state.playerPos[0]}, ${state.playerPos[1]}, ${state.playerPos[0]-dragonPos[0]}, ${state.playerPos[1]-dragonPos[1]}, ${Math.abs(state.playerPos[0]-dragonPos[0])+Math.abs(state.playerPos[1]-dragonPos[1])})`;
    const qValues = state.activePolicy[key];
    if (qValues) {
      const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
      const sorted = qValues.map((q,i) => ({q,i})).sort((a,b) => b.q-a.q);
      for (const {i} of sorted) {
        const [dr,dc] = dirs[i];
        const nr = dragonPos[0]+dr, nc = dragonPos[1]+dc;
        if (isWalkable(nr, nc, true)) { agentStats.policy++; return [nr, nc]; }
      }
    }
  }

  // 2) Fallback: BFS toward target (player or last known position)
  agentStats.fallback++;
  const best = bfsStep(dragonPos, target);
  return best || dragonPos;
}

// ── BFS: returns the first step toward target ─────────────
function bfsStep(from, to) {
  const S = LEVELS[state.level].size;
  const visited = Array.from({length: S}, () => Array(S).fill(false));
  const queue   = [[...from, null]]; // [r, c, firstStep]
  visited[from[0]][from[1]] = true;

  while (queue.length) {
    const [r, c, first] = queue.shift();
    for (const [dr, dc] of DIRS) {
      const nr = r + dr, nc = c + dc;
      if (!inBounds(nr, nc) || visited[nr][nc]) continue;
      if (!isWalkable(nr, nc, true) &&
          !(nr === to[0] && nc === to[1])) continue; // allow stepping on player
      visited[nr][nc] = true;
      const step = first || [nr, nc];
      if (nr === to[0] && nc === to[1]) return step;
      queue.push([nr, nc, step]);
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════
//  CONFETTI  (canvas-based, no libraries)
// ═══════════════════════════════════════════════════════════
const confettiCanvas = (() => {
  const c = document.createElement('canvas');
  c.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:50;';
  document.body.appendChild(c);
  return c;
})();
const confettiCtx = confettiCanvas.getContext('2d');

let confettiPieces = [];
let confettiFrame  = null;

const CONFETTI_COLORS = [
  '#f5c842','#4cff91','#4ca8ff','#ff4c6a',
  '#ff9f43','#a29bfe','#fd79a8','#55efc4',
];

function launchConfetti() {
  confettiCanvas.width  = window.innerWidth;
  confettiCanvas.height = window.innerHeight;

  confettiPieces = Array.from({length: 180}, () => ({
    x:     Math.random() * window.innerWidth,
    y:     -20 - Math.random() * 200,
    w:     6 + Math.random() * 10,
    h:     4 + Math.random() * 6,
    color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    vx:    -2 + Math.random() * 4,
    vy:    3  + Math.random() * 5,
    spin:  Math.random() * Math.PI * 2,
    spinV: 0.05 + Math.random() * 0.15,
    life:  1.0,
    decay: 0.005 + Math.random() * 0.005,
  }));

  cancelAnimationFrame(confettiFrame);
  animateConfetti();
}

function animateConfetti() {
  confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
  confettiPieces = confettiPieces.filter(p => p.life > 0);

  confettiPieces.forEach(p => {
    p.x    += p.vx;
    p.y    += p.vy;
    p.spin += p.spinV;
    p.vy   += 0.12;  // gravity
    p.vx   *= 0.99;  // drag
    if (p.y > confettiCanvas.height * 0.7) p.life -= p.decay;

    confettiCtx.save();
    confettiCtx.globalAlpha = p.life;
    confettiCtx.translate(p.x, p.y);
    confettiCtx.rotate(p.spin);
    confettiCtx.fillStyle = p.color;
    confettiCtx.fillRect(-p.w/2, -p.h/2, p.w, p.h);
    confettiCtx.restore();
  });

  if (confettiPieces.length > 0) {
    confettiFrame = requestAnimationFrame(animateConfetti);
  } else {
    confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
  }
}

function stopConfetti() {
  cancelAnimationFrame(confettiFrame);
  confettiPieces = [];
  confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
}

// ═══════════════════════════════════════════════════════════
//  WIN / LOSE DETECTION
// ═══════════════════════════════════════════════════════════
function checkCaught() {
  const [pr, pc] = state.playerPos;
  for (const [dr, dc] of state.dragonPositions) {
    if (dr === pr && dc === pc) { triggerGameOver(); return; }
  }
}

// Per-level win emojis
const WIN_EMOJIS = ['🎉','⚔️','🌟','🗝️','💨','🌙','🏆'];

function triggerWin() {
  state.running  = false;
  state.gameOver = true;
  clearInterval(state.timerInterval);
  drawAll();

  const isLastLevel = state.level >= LEVELS.length - 1;

  if (isLastLevel) {
    Audio.legendary();
    setTimeout(() => { launchConfetti(); populateAndShowWin(true); }, 400);
  } else {
    Audio.win();
    setTimeout(() => populateAndShowWin(false), 600);
  }
}

function populateAndShowWin(isLast) {
  const lvl = state.level;

  // Emoji — trophy for last level, per-level otherwise
  document.getElementById('win-emoji').textContent   = WIN_EMOJIS[lvl] || '🎉';
  // Title
  document.getElementById('win-title').textContent   = isLast
    ? 'YOU ESCAPED THE DRAGON\'S MAZE!'
    : 'YOU ESCAPED!';
  // Subtitle message
  document.getElementById('win-message').textContent = WIN_MESSAGES[lvl] || 'Amazing!';
  // Stats — level always just the number
  document.getElementById('win-time').textContent    = hudTimer.textContent;
  document.getElementById('win-level').textContent   = lvl + 1;
  document.getElementById('win-rewards').textContent = state.rewardsCollected;

  // Buttons — Next Level hidden on last level
  document.getElementById('next-level-btn').style.display = isLast ? 'none' : 'inline-block';
  document.getElementById('start-over-btn').style.display = isLast ? 'inline-block' : 'none';

  showScreen(winScreen);
}

function showLegendaryScreen() {} // kept for safety, no longer used

function triggerGameOver() {
  state.running  = false;
  state.gameOver = true;
  clearInterval(state.timerInterval);
  Audio.gameover();
  drawAll();
  setTimeout(() => showScreen(gameoverScreen), 500);
}

// ═══════════════════════════════════════════════════════════
//  SURPRISE BANNER
// ═══════════════════════════════════════════════════════════
let bannerTimeout = null;
function showSurpriseBanner(msg) {
  surpriseBanner.textContent = msg;
  surpriseBanner.classList.remove('hidden');
  Audio.surprise();
  clearTimeout(bannerTimeout);
  bannerTimeout = setTimeout(() => surpriseBanner.classList.add('hidden'), 2800);
}

// ═══════════════════════════════════════════════════════════
//  RENDERING
// ═══════════════════════════════════════════════════════════
function renderLoop() {
  state.glowPhase = (state.glowPhase + 0.05) % (Math.PI * 2);
  drawAll();
  state.animFrame = requestAnimationFrame(renderLoop);
}

function drawAll() {
  if (!state.grid.length) return;   // no level loaded yet (e.g. window resized on the intro screen)
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();
  drawDoor();
  drawRewards();
  if (state.fallingReward) drawFallingReward();
  drawObstacles();
  drawPlayer();
  drawDragons();
  if (state.fogActive) drawFog();
}

// ── Ground grid ───────────────────────────────────────────
function drawGrid() {
  const S = LEVELS[state.level].size;
  for (let r = 0; r < S; r++) {
    for (let c = 0; c < S; c++) {
      const x = c * CELL, y = r * CELL;
      ctx.fillStyle = COL.ground;
      ctx.fillRect(x, y, CELL, CELL);
      ctx.strokeStyle = COL.groundLine;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);

      // Safe flash
      if (state.dragonFrozen && state.safeMovesLeft > 0) {
        ctx.fillStyle = COL.safeFlash;
        ctx.fillRect(x, y, CELL, CELL);
      }
    }
  }
}

// ── Door ──────────────────────────────────────────────────
function drawDoor() {
  const [r, c] = state.doorPos;
  const x = c * CELL, y = r * CELL;
  const pulse = 0.7 + 0.3 * Math.sin(state.glowPhase);

  // Glow
  ctx.fillStyle = `rgba(245,200,66,${0.15 * pulse})`;
  ctx.fillRect(x - 4, y - 4, CELL + 8, CELL + 8);

  // Door frame
  ctx.fillStyle = COL.door;
  ctx.fillRect(x + CELL*0.1, y + CELL*0.05, CELL*0.8, CELL*0.9);

  // Door arch
  ctx.fillStyle = '#c8a020';
  ctx.fillRect(x + CELL*0.1, y + CELL*0.05, CELL*0.8, CELL*0.2);

  // Door knob
  ctx.fillStyle = '#0d0d1a';
  ctx.beginPath();
  ctx.arc(x + CELL*0.75, y + CELL*0.55, CELL*0.06, 0, Math.PI*2);
  ctx.fill();

  // Emoji label
  ctx.font = `${Math.floor(CELL * 0.38)}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🚪', x + CELL/2, y + CELL/2);
}

// ── Rewards ───────────────────────────────────────────────
function drawRewards() {
  const pulse = 0.6 + 0.4 * Math.abs(Math.sin(state.glowPhase));
  state.rewardPositions.forEach(([r, c]) => {
    const x = c * CELL + CELL/2, y = r * CELL + CELL/2;
    // Glow
    ctx.fillStyle = `rgba(255,220,102,${0.2 * pulse})`;
    ctx.beginPath();
    ctx.arc(x, y, CELL*0.4, 0, Math.PI*2);
    ctx.fill();
    // Star emoji
    ctx.font = `${Math.floor(CELL * 0.45)}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⭐', x, y);
  });
}

// ── Falling reward ────────────────────────────────────────
function drawFallingReward() {
  const {pos, turnsLeft} = state.fallingReward;
  const [r, c] = pos;
  const x = c * CELL + CELL/2, y = r * CELL + CELL/2;
  const alpha = turnsLeft / 3;
  // Urgent red glow
  ctx.fillStyle = `rgba(255,80,80,${0.3 * alpha})`;
  ctx.beginPath();
  ctx.arc(x, y, CELL*0.45, 0, Math.PI*2);
  ctx.fill();
  ctx.font = `${Math.floor(CELL * 0.45)}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('💫', x, y);
  // Countdown
  ctx.fillStyle = '#ff4c6a';
  ctx.font = `bold ${Math.floor(CELL * 0.22)}px monospace`;
  ctx.fillText(turnsLeft, x + CELL*0.28, y - CELL*0.25);
}

// ── Obstacles (pixel trees) ───────────────────────────────
function drawObstacles() {
  const S = LEVELS[state.level].size;
  for (let r = 0; r < S; r++) {
    for (let c = 0; c < S; c++) {
      if (state.grid[r][c] !== OBSTACLE) continue;
      const x = c * CELL, y = r * CELL;
      // Trunk
      ctx.fillStyle = '#5c3317';
      ctx.fillRect(x + CELL*0.38, y + CELL*0.55, CELL*0.24, CELL*0.4);
      // Canopy layers
      ctx.fillStyle = COL.obstacle;
      ctx.beginPath();
      ctx.moveTo(x + CELL*0.5, y + CELL*0.05);
      ctx.lineTo(x + CELL*0.85, y + CELL*0.5);
      ctx.lineTo(x + CELL*0.15, y + CELL*0.5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = COL.obstacleTop;
      ctx.beginPath();
      ctx.moveTo(x + CELL*0.5, y + CELL*0.02);
      ctx.lineTo(x + CELL*0.78, y + CELL*0.42);
      ctx.lineTo(x + CELL*0.22, y + CELL*0.42);
      ctx.closePath();
      ctx.fill();
    }
  }
}

// ── Player ────────────────────────────────────────────────
function drawPlayer() {
  const [r, c] = state.playerPos;
  const x = c * CELL, y = r * CELL;
  const cx = x + CELL/2, cy = y + CELL/2;
  const P = CELL * 0.38; // half-size

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(cx, y + CELL*0.9, P*0.6, P*0.15, 0, 0, Math.PI*2);
  ctx.fill();

  // Body (blue tunic)
  ctx.fillStyle = COL.playerBody;
  ctx.fillRect(cx - P*0.5, cy - P*0.1, P, P*0.7);

  // Head (skin)
  ctx.fillStyle = COL.playerSkin;
  ctx.fillRect(cx - P*0.38, cy - P*0.9, P*0.75, P*0.7);

  // Hair
  ctx.fillStyle = '#3d1a00';
  ctx.fillRect(cx - P*0.38, cy - P*0.9, P*0.75, P*0.2);

  // Eyes
  ctx.fillStyle = '#0d0d1a';
  ctx.fillRect(cx - P*0.22, cy - P*0.55, P*0.14, P*0.14);
  ctx.fillRect(cx + P*0.08, cy - P*0.55, P*0.14, P*0.14);

  // Sword
  ctx.fillStyle = '#c0c0c0';
  ctx.fillRect(cx - P*0.75, cy - P*0.1, P*0.12, P*0.6);
  ctx.fillStyle = '#8b4513';
  ctx.fillRect(cx - P*0.82, cy + P*0.1, P*0.26, P*0.12);

  // Legs
  ctx.fillStyle = '#8b4513';
  ctx.fillRect(cx - P*0.42, cy + P*0.58, P*0.3, P*0.38);
  ctx.fillRect(cx + P*0.12, cy + P*0.58, P*0.3, P*0.38);
}

// ── Dragon(s) ─────────────────────────────────────────────
function drawDragons() {
  state.dragonPositions.forEach(([r, c]) => drawDragon(r, c));
}

function drawDragon(r, c) {
  const x = c * CELL, y = r * CELL;
  const cx = x + CELL/2, cy = y + CELL/2;
  const P = CELL * 0.4;
  const wing = 0.6 + 0.4 * Math.abs(Math.sin(state.glowPhase * 2));

  // Speed burst flash
  if (state.speedBurstActive) {
    ctx.fillStyle = 'rgba(255,100,0,0.3)';
    ctx.beginPath();
    ctx.arc(cx, cy, P * 1.3, 0, Math.PI*2);
    ctx.fill();
  }

  // Wings (animated flap)
  ctx.fillStyle = COL.dragonWing;
  // Left wing
  ctx.beginPath();
  ctx.moveTo(cx - P*0.3, cy);
  ctx.lineTo(cx - P*1.1, cy - P*wing);
  ctx.lineTo(cx - P*0.6, cy + P*0.2);
  ctx.closePath();
  ctx.fill();
  // Right wing
  ctx.beginPath();
  ctx.moveTo(cx + P*0.3, cy);
  ctx.lineTo(cx + P*1.1, cy - P*wing);
  ctx.lineTo(cx + P*0.6, cy + P*0.2);
  ctx.closePath();
  ctx.fill();

  // Body
  ctx.fillStyle = COL.dragonBody;
  ctx.beginPath();
  ctx.ellipse(cx, cy + P*0.1, P*0.45, P*0.55, 0, 0, Math.PI*2);
  ctx.fill();

  // Head
  ctx.beginPath();
  ctx.ellipse(cx, cy - P*0.55, P*0.38, P*0.3, 0, 0, Math.PI*2);
  ctx.fill();

  // Eyes (glowing yellow)
  ctx.fillStyle = '#ffcc00';
  ctx.beginPath();
  ctx.arc(cx - P*0.15, cy - P*0.6, P*0.1, 0, Math.PI*2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + P*0.15, cy - P*0.6, P*0.1, 0, Math.PI*2);
  ctx.fill();
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(cx - P*0.15, cy - P*0.6, P*0.05, 0, Math.PI*2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + P*0.15, cy - P*0.6, P*0.05, 0, Math.PI*2);
  ctx.fill();

  // Horns
  ctx.fillStyle = '#660000';
  ctx.beginPath();
  ctx.moveTo(cx - P*0.2, cy - P*0.82);
  ctx.lineTo(cx - P*0.3, cy - P*1.1);
  ctx.lineTo(cx - P*0.08, cy - P*0.82);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx + P*0.2, cy - P*0.82);
  ctx.lineTo(cx + P*0.3, cy - P*1.1);
  ctx.lineTo(cx + P*0.08, cy - P*0.82);
  ctx.closePath();
  ctx.fill();

  // Tail
  ctx.strokeStyle = COL.dragonBody;
  ctx.lineWidth = P * 0.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, cy + P*0.6);
  ctx.quadraticCurveTo(cx + P*0.8, cy + P*1.0, cx + P*0.5, cy + P*1.3);
  ctx.stroke();
}

// ── Fog of war (level 6) ──────────────────────────────────
function drawFog() {
  if (!state.fogActive) return;
  const wrap = document.getElementById('game-wrap');
  const wRect = wrap.getBoundingClientRect();
  const cRect = canvas.getBoundingClientRect();
  const offsetX = cRect.left - wRect.left;
  const offsetY = cRect.top  - wRect.top;

  fogCanvas.width  = wRect.width;
  fogCanvas.height = wRect.height;
  fogCtx.clearRect(0, 0, fogCanvas.width, fogCanvas.height);

  // Fill everything dark
  fogCtx.fillStyle = '#0d0d1a';
  fogCtx.fillRect(0, 0, fogCanvas.width, fogCanvas.height);

  // Cut out circle around player
  const [pr, pc] = state.playerPos;
  const cx = offsetX + (pc + 0.5) * CELL;
  const cy = offsetY + (pr + 0.5) * CELL;
  const radius = (state.FOG_RADIUS + 0.5) * CELL;

  const grad = fogCtx.createRadialGradient(cx, cy, radius*0.4, cx, cy, radius);
  grad.addColorStop(0,   'rgba(13,13,26,0)');
  grad.addColorStop(1,   'rgba(13,13,26,1)');

  fogCtx.globalCompositeOperation = 'destination-out';
  fogCtx.fillStyle = 'rgba(255,255,255,1)';
  fogCtx.beginPath();
  fogCtx.arc(cx, cy, radius, 0, Math.PI*2);
  fogCtx.fill();

  fogCtx.globalCompositeOperation = 'source-over';
  fogCtx.fillStyle = grad;
  fogCtx.beginPath();
  fogCtx.arc(cx, cy, radius, 0, Math.PI*2);
  fogCtx.fill();
}

// ═══════════════════════════════════════════════════════════
//  KEYBOARD INPUT
// ═══════════════════════════════════════════════════════════
document.addEventListener('keydown', e => {
  if (!state.running) return;
  switch(e.key) {
    case 'ArrowUp':    case 'w': case 'W': e.preventDefault(); movePlayer(-1, 0); break;
    case 'ArrowDown':  case 's': case 'S': e.preventDefault(); movePlayer( 1, 0); break;
    case 'ArrowLeft':  case 'a': case 'A': e.preventDefault(); movePlayer( 0,-1); break;
    case 'ArrowRight': case 'd': case 'D': e.preventDefault(); movePlayer( 0, 1); break;
  }
});

// ── Touch / swipe ─────────────────────────────────────────
let touchStartX = 0, touchStartY = 0;

document.addEventListener('touchstart', e => {
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
}, {passive: true});

document.addEventListener('touchend', e => {
  if (!state.running) return;
  const dx = e.changedTouches[0].clientX - touchStartX;
  const dy = e.changedTouches[0].clientY - touchStartY;
  if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return; // tap, not swipe
  if (Math.abs(dx) > Math.abs(dy)) {
    movePlayer(0, dx > 0 ? 1 : -1);
  } else {
    movePlayer(dy > 0 ? 1 : -1, 0);
  }
}, {passive: true});

// ── On-screen touch buttons ───────────────────────────────
document.getElementById('tc-up').addEventListener('click',    () => movePlayer(-1, 0));
document.getElementById('tc-down').addEventListener('click',  () => movePlayer( 1, 0));
document.getElementById('tc-left').addEventListener('click',  () => movePlayer( 0,-1));
document.getElementById('tc-right').addEventListener('click', () => movePlayer( 0, 1));

// ═══════════════════════════════════════════════════════════
//  SCREEN BUTTON HANDLERS
// ═══════════════════════════════════════════════════════════

// Intro → Instructions
document.getElementById('start-btn').addEventListener('click', () => {
  hideScreen(introScreen);
  // Detect touch device for instructions hint
  const hint = document.getElementById('controls-hint');
  if (window.matchMedia('(pointer: coarse)').matches) {
    hint.textContent = 'Swipe or use the on-screen arrows to move';
  }
  showScreen(instructionsScreen);
});

// Instructions → Game
document.getElementById('play-btn').addEventListener('click', () => {
  hideScreen(instructionsScreen);
  initLevel(0);
});

// Win → Next level
document.getElementById('next-level-btn').addEventListener('click', () => {
  hideScreen(winScreen);
  const next = state.level + 1;
  if (next < LEVELS.length) initLevel(next);
});

// Win → Replay same level
document.getElementById('replay-level-btn').addEventListener('click', () => {
  stopConfetti();
  hideScreen(winScreen);
  initLevel(state.level);
});

document.getElementById('start-over-btn').addEventListener('click', () => {
  stopConfetti();
  hideScreen(winScreen);
  initLevel(0);
});

// Win → Share (clipboard only — replace placeholder with real URL after hosting)
document.getElementById('win-share-btn').addEventListener('click', () => {
  const GAME_URL = 'https://d1czf247jnlvka.cloudfront.net';
  const msg = `🐉 I beat Dragon's Maze level ${state.level + 1}! Can you escape the dragon? ${GAME_URL}`;
  navigator.clipboard.writeText(msg).then(() => {
    const btn = document.getElementById('win-share-btn');
    const orig = btn.textContent;
    btn.textContent = '✅ COPIED!';
    setTimeout(() => btn.textContent = orig, 2000);
  });
});

// Game over → Retry
document.getElementById('retry-btn').addEventListener('click', () => {
  hideScreen(gameoverScreen);
  initLevel(state.level);
});

// Game over → Menu
document.getElementById('menu-btn').addEventListener('click', () => {
  hideScreen(gameoverScreen);
  cancelAnimationFrame(state.animFrame);
  clearInterval(state.timerInterval);
  state.running = false;
  showScreen(introScreen);
});

// ═══════════════════════════════════════════════════════════
//  INITIAL LOAD
// ═══════════════════════════════════════════════════════════
// Show intro screen (already visible from HTML)
// Game starts only when player clicks Start → Instructions → Play