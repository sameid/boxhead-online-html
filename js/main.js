// App shell: screens (menu, instructions, game, pause, game over), input and
// the main loop. Replaces MainApplet's run()/checkOptions()/paint() menu logic.
// The multiplayer lobby screens live in lobby.js.

'use strict';

const TICK_MS = 20; // the applet ran gameplay() then delay(20)

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const buttons = {
  online: new Button(95, 245, 'btnMultiplayer'),
  startSolo: new Button(395, 245, 'btnStartSolo'),
  options: new Button(695, 245, 'btnOptions'),
  instructionsReturn: new Button(628, 550, 'btnReturn'),
  ok: new Button(634, 34, 'btnOk'),
  // Game over: "POST TO FB!" slot becomes Play Again
  playAgain: new Button(343, 345, null, 'PLAY AGAIN'),
  gameOverReturn: new Button(403, 420, 'btnReturn'),
  // Pause: fills the two slots in the (previously unused) pause.png panel
  resume: new Button(433, 291, null, 'RESUME'),
  pauseReturn: new Button(433, 361, 'btnReturn'),
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const app = {
  screen: 'loading', // loading | menu | instructions | game | gameOver | mp* (lobby)
  loadProgress: 0,
  popup: null, // message string when the pop-up is open
  game: null, // Game (solo/host) or ClientGame
  paused: false,
  best: loadBest(),
  lastResult: null,
};

const input = {
  mouseX: SCREEN_WIDTH / 2,
  mouseY: SCREEN_HEIGHT / 2,
  mousePressed: false,
  up: false,
  down: false,
  left: false,
  right: false,
  rotateWeapon: false,
  rotateWeaponReverse: false,
};

function loadBest() {
  try {
    return JSON.parse(localStorage.getItem('boxhead.best')) || { score: 0, level: 0 };
  } catch (e) {
    return { score: 0, level: 0 };
  }
}

function saveBest() {
  try {
    localStorage.setItem('boxhead.best', JSON.stringify(app.best));
  } catch (e) {}
}

function releaseInputs() {
  input.mousePressed = false;
  input.up = input.down = input.left = input.right = false;
  input.rotateWeapon = input.rotateWeaponReverse = false;
}

function beginGame(game) {
  app.game = game;
  app.paused = false;
  app.screen = 'game';
  accumulator = 0;
  releaseInputs();
  Sound.playMusic('game');
}

function startSolo() {
  beginGame(new Game());
}

function returnToMenu() {
  if (Lobby.active) Lobby.leave();
  app.game = null;
  app.paused = false;
  app.screen = 'menu';
  Sound.playMusic('menu');
}

function endGame() {
  const g = app.game;
  app.lastResult = { level: g.level, score: g.currentScore };
  // The online build saved these to your profile; keep them locally instead
  app.best.score = Math.max(app.best.score, g.currentScore);
  app.best.level = Math.max(app.best.level, g.level);
  saveBest();
  app.screen = 'gameOver';
  releaseInputs();
  Sound.playMusic('gameOver');
}

// In multiplayer, pausing pauses both players (remote = the partner asked)
function setPaused(paused, remote = false) {
  if (app.screen !== 'game' || app.paused === paused) return;
  app.paused = paused;
  releaseInputs();
  if (Lobby.active && !remote) Net.send({ t: 'pause', v: paused });
}

// ---------------------------------------------------------------------------
// Clicks (checkOptions)
// ---------------------------------------------------------------------------
function handleClick(mx, my) {
  if (app.popup) {
    if (buttons.ok.checkHover(mx, my)) app.popup = null;
    return;
  }
  if (Lobby.isLobbyScreen(app.screen)) {
    Lobby.handleClick(mx, my);
    return;
  }
  switch (app.screen) {
    case 'menu':
      if (buttons.startSolo.checkHover(mx, my)) startSolo();
      else if (buttons.online.checkHover(mx, my)) Lobby.open();
      else if (buttons.options.checkHover(mx, my)) app.screen = 'instructions';
      break;
    case 'instructions':
      if (buttons.instructionsReturn.checkHover(mx, my)) app.screen = 'menu';
      break;
    case 'gameOver':
      if (buttons.playAgain.checkHover(mx, my)) {
        if (!Lobby.active) startSolo();
        else if (Lobby.role === 'host') Lobby.startHostGame(); // the client follows along
      } else if (buttons.gameOverReturn.checkHover(mx, my)) returnToMenu();
      break;
    case 'game':
      if (app.paused) {
        if (buttons.resume.checkHover(mx, my)) setPaused(false);
        else if (buttons.pauseReturn.checkHover(mx, my)) returnToMenu();
      } else {
        input.mousePressed = true;
      }
      break;
  }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
function toGameCoords(e) {
  const rect = canvas.getBoundingClientRect();
  return [((e.clientX - rect.left) * SCREEN_WIDTH) / rect.width, ((e.clientY - rect.top) * SCREEN_HEIGHT) / rect.height];
}

canvas.addEventListener('mousemove', (e) => {
  [input.mouseX, input.mouseY] = toGameCoords(e);
});

canvas.addEventListener('mousedown', (e) => {
  Sound.unlock();
  Sound.resumeMusic();
  [input.mouseX, input.mouseY] = toGameCoords(e);
  const inGame = app.screen === 'game' && !app.paused && !app.popup;
  if (e.button === 0) {
    handleClick(input.mouseX, input.mouseY);
  } else if (inGame && e.button === 2) {
    // right click: jump to strongest weapon
    const w = app.game.player.weapon;
    w.chooseWeapon(0);
    w.rotateWeaponReverse(NUM_WEAPON_TYPES);
  } else if (inGame && e.button === 1) {
    // middle click: weakest non-pistol weapon
    const w = app.game.player.weapon;
    w.chooseWeapon(0);
    w.rotateWeapon(NUM_WEAPON_TYPES);
    e.preventDefault();
  }
});

window.addEventListener('mouseup', (e) => {
  if (e.button === 0) input.mousePressed = false;
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

let wheelAccum = 0;
let wheelLast = 0;
canvas.addEventListener(
  'wheel',
  (e) => {
    if (app.screen !== 'game' || app.paused) return;
    e.preventDefault();
    const now = performance.now();
    if (now - wheelLast > 250) wheelAccum = 0;
    wheelLast = now;
    // one weapon per notch; trackpads send lots of small deltas
    wheelAccum += e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY;
    const w = app.game.player.weapon;
    while (Math.abs(wheelAccum) >= 50) {
      if (wheelAccum < 0) {
        w.rotateWeaponReverse(NUM_WEAPON_TYPES);
        wheelAccum += 50;
      } else {
        w.rotateWeapon(NUM_WEAPON_TYPES);
        wheelAccum -= 50;
      }
    }
  },
  { passive: false }
);

const MOVE_KEYS = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
};

window.addEventListener('keydown', (e) => {
  Sound.unlock();
  Sound.resumeMusic();
  if (app.popup) {
    if (e.code === 'Enter' || e.code === 'Escape') app.popup = null;
    return;
  }
  if (Lobby.handleKey(e)) return; // text entry takes priority
  if (e.code === 'KeyM') {
    Sound.toggleMute();
    return;
  }
  if (app.screen === 'instructions' && e.code === 'Escape') {
    app.screen = 'menu';
    return;
  }
  if (app.screen !== 'game') return;

  if (e.code === 'Escape' || e.code === 'KeyP') {
    setPaused(!app.paused);
    e.preventDefault();
    return;
  }
  if (app.paused) return;

  if (MOVE_KEYS[e.code]) {
    input[MOVE_KEYS[e.code]] = true;
    e.preventDefault();
  } else if (e.code === 'KeyE' && !e.repeat) {
    input.rotateWeapon = true;
  } else if (e.code === 'KeyQ' && !e.repeat) {
    input.rotateWeaponReverse = true;
  } else if (/^Digit[1-8]$/.test(e.code)) {
    app.game.player.weapon.chooseWeapon(Number(e.code.slice(5)) - 1);
  }
});

window.addEventListener('keyup', (e) => {
  if (MOVE_KEYS[e.code]) input[MOVE_KEYS[e.code]] = false;
});

window.addEventListener('paste', (e) => {
  Lobby.handlePaste(e.clipboardData?.getData('text') || '');
});

// Don't let the zombies eat you while you're in another tab. Losing focus only
// pauses solo games, so two windows side by side can play co-op on one machine.
window.addEventListener('blur', () => {
  releaseInputs();
  if (!Lobby.active) setPaused(true);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) setPaused(true);
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function drawLoading() {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
  drawImg(ctx, loadingImage, 0, 0);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.fillRect(24, 356, 300, 4);
  ctx.fillStyle = '#fff';
  ctx.fillRect(24, 356, 300 * app.loadProgress, 4);
}

function drawMenuBase(mx, my, interactive) {
  drawImg(ctx, IMG.film, 0, 0);
  drawImg(ctx, IMG.mainMenu, 0, 0);
  buttons.startSolo.draw(ctx, mx, my, { hover: interactive });
  buttons.online.draw(ctx, mx, my, { hover: interactive });
  buttons.options.draw(ctx, mx, my, { hover: interactive });
  if (app.screen !== 'menu') return; // overlays sit on top of the bare menu

  if (app.best.score > 0 || app.best.level > 0) {
    drawText(ctx, `HIGH SCORE  ${app.best.score}      LEVEL REACHED  ${app.best.level}`, SCREEN_WIDTH / 2, 380, 30, '#fff', 'center');
  }
  drawText(ctx, Sound.isMuted() ? 'SOUND OFF (M)' : 'SOUND ON (M)', SCREEN_WIDTH - 16, 24, 20, 'rgba(255,255,255,0.7)', 'right');
}

function drawPopup(mx, my) {
  drawImg(ctx, IMG.popUpMessage, 15, 15);
  let size = 35;
  ctx.font = `${size}px ${FONT}`;
  while (size > 18 && ctx.measureText(app.popup).width > 570) ctx.font = `${--size}px ${FONT}`;
  drawText(ctx, app.popup, 40, 70, size);
  buttons.ok.draw(ctx, mx, my, { alwaysAnimate: true });
}

function drawGameOver(mx, my) {
  drawMenuBase(mx, my, false);
  drawImg(ctx, IMG.gameOver, 258, 200);
  const waiting = Lobby.active && Lobby.role !== 'host';
  buttons.playAgain.draw(ctx, mx, my, { hover: !app.popup && !waiting, label: waiting ? 'WAITING FOR HOST' : 'PLAY AGAIN' });
  buttons.gameOverReturn.draw(ctx, mx, my, { hover: !app.popup });
  const r = app.lastResult;
  drawText(ctx, String(r.level), 258 + 370, 200 + 60, 24);
  drawText(ctx, String(r.score), 258 + 370, 200 + 95, 24);
}

function render() {
  const mx = input.mouseX;
  const my = input.mouseY;
  ctx.clearRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

  if (Lobby.isLobbyScreen(app.screen)) {
    Lobby.draw(ctx, mx, my);
  } else {
    switch (app.screen) {
      case 'loading':
        drawLoading();
        break;
      case 'menu':
        drawMenuBase(mx, my, !app.popup);
        break;
      case 'instructions':
        drawMenuBase(mx, my, false);
        drawImg(ctx, IMG.instructions, 108, 30);
        buttons.instructionsReturn.draw(ctx, mx, my);
        drawText(ctx, '1–8 PICK WEAPON   ·   SCROLL WHEEL CYCLES   ·   RIGHT CLICK BEST WEAPON   ·   ESC PAUSE   ·   M SOUND', SCREEN_WIDTH / 2, 652, 18, 'rgba(255,255,255,0.8)', 'center');
        break;
      case 'gameOver':
        drawGameOver(mx, my);
        break;
      case 'game':
        app.game.render(ctx, mx, my);
        if (app.paused) {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
          ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
          drawImg(ctx, IMG.pause, 308, 231);
          buttons.resume.draw(ctx, mx, my, { hover: !app.popup });
          buttons.pauseReturn.draw(ctx, mx, my, { hover: !app.popup });
        }
        break;
    }
  }

  if (app.popup) drawPopup(mx, my);

  // The crosshair replaces the cursor while playing
  canvas.style.cursor = app.screen === 'game' && !app.paused ? 'none' : 'default';
}

// ---------------------------------------------------------------------------
// Sizing: fit the 1016x662 playfield to the window, crisp on hi-dpi screens
// ---------------------------------------------------------------------------
function resize() {
  const scale = Math.min(window.innerWidth / SCREEN_WIDTH, window.innerHeight / SCREEN_HEIGHT);
  const cssW = Math.floor(SCREEN_WIDTH * scale);
  const cssH = Math.floor(SCREEN_HEIGHT * scale);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(canvas.width / SCREEN_WIDTH, 0, 0, canvas.height / SCREEN_HEIGHT, 0, 0);
  ctx.imageSmoothingQuality = 'high';
}
window.addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
let lastFrame = performance.now();
let accumulator = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const elapsed = Math.min(now - lastFrame, 250);
  lastFrame = now;

  if (app.screen === 'game' && !app.paused) {
    accumulator += elapsed;
    while (accumulator >= TICK_MS) {
      const g = app.game;
      if (g instanceof ClientGame) {
        Net.send(g.tick(input));
      } else {
        g.tick(input);
        if (g.multiplayer) Lobby.afterTick(g);
      }
      accumulator -= TICK_MS;
      if (g.isOver) {
        endGame();
        accumulator = 0;
        break;
      }
    }
  } else {
    accumulator = 0;
  }

  render();
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
let loadingImage = null;

async function boot() {
  requestAnimationFrame(frame);
  loadingImage = await Assets.loadImage('assets/loading.png');

  const font = new FontFace('BigNoodle', "url('assets/big_noodle_titling.ttf')");
  const fontReady = font
    .load()
    .then((f) => document.fonts.add(f))
    .catch(() => console.warn('Could not load Big Noodle Titling; using a fallback font'));

  await Promise.all([Assets.loadAll((p) => (app.loadProgress = p)), fontReady]);
  app.screen = 'menu';
  Lobby.afterBoot();
  Sound.playMusic('menu'); // starts once the browser allows audio (first click/key)
}

boot();

// Exposed for debugging from the console
window.boxhead = { app, input, Lobby, Net };
