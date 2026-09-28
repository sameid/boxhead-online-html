// Image loading. Paths mirror the original applet's "boxhead/..." resource layout.

'use strict';

const IMG = {};

const Assets = (() => {
  const BASE = 'assets/boxhead/';
  // Sprite folders are indexed exactly like the Java arrays: type[i / 4] + "Walk" + (i % 4)
  const WALK_DIRS = ['up', 'down', 'left', 'right', 'upRight', 'upLeft', 'downRight', 'downLeft'];
  const SPRITE_SETS = ['enemies', 'enemies2', 'enemies3', 'enemies4', 'boss', 'boss2', 'boss3', 'main', 'main2', 'main3', 'main4'];
  const TURRET_DIRS = ['up', 'down', 'left', 'right', 'downRight', 'downLeft'];

  const WEAPON_FILES = {
    [PISTOL]: 'pistol',
    [MACHINE]: 'machine',
    [SHOTGUN]: 'shotGun',
    [SNIPER]: 'sniper',
    [TURRET]: 'turret',
    [GRENADE]: 'grenadeWeapon',
    [RPG]: 'rpg',
    [RPG_TURRET]: 'rocketTurret',
  };
  const ITEM_FILES = {
    [HEALTH_PICKUP]: 'health',
    [MACHINE]: 'machine',
    [SHOTGUN]: 'shotgun',
    [SNIPER]: 'sniper',
    [TURRET]: 'turret',
    [GRENADE]: 'grenade',
    [RPG]: 'rpg',
    [RPG_TURRET]: 'rocketTurret',
  };

  const range = (n, fn) => Array.from({ length: n }, (_, i) => fn(i));

  function manifest() {
    const m = {
      background: 'GameImages/sprites/Background.png',
      obstacle: 'GameImages/sprites/environment/tree.png',
      hud: 'GameImages/hud3.png',
      pause: 'GameImages/pause.png',
      infinity: 'GameImages/sprites/weapons/i.png',
      bullet: 'GameImages/sprites/weapons/bullet.png',
      stickyBullet: 'GameImages/sprites/boss/enemyBullet.png',
      rocket: 'GameImages/sprites/weapons/rocket.png',
      grenade: 'GameImages/sprites/weapons/grenade.png',

      film: 'MenuImages/film.png',
      mainMenu: 'MenuImages/mainMenu.png',
      instructions: 'MenuImages/instructions2.png',
      gameOver: 'MenuImages/gameOver.png',
      popUpMessage: 'MenuImages/popUpMessage.png',
      buttonEffect: 'MenuImages/buttonEffect/buttoneffect1Sec_sheet.png',
      btnStartSolo: 'MenuImages/menubuttons/noCursor/mainMenu/startSolo.png',
      btnMultiplayer: 'MenuImages/menubuttons/noCursor/mainMenu/multiplayer.png',
      btnOptions: 'MenuImages/menubuttons/noCursor/mainMenu/options.png',
      btnReturn: 'MenuImages/menubuttons/noCursor/signInMenu/returnToMenu.png',
      btnOk: 'MenuImages/menubuttons/noCursor/popUpMessage/ok.png',

      // multiplayer lobby
      blank: 'MenuImages/blank.png',
      loader: 'MenuImages/loader.png',
      tg: 'MenuImages/tg.png',
      hostorjoin: 'MenuImages/hostorjoin.png',
      hostCode: 'MenuImages/hostCode.png', // host.png with "IP ADDRESS" -> "ROOM CODE"
      joinCode: 'MenuImages/joinCode.png', // join.png with a room code label, no Refresh slot
      connected: 'MenuImages/connected.png',
      btnJoin: 'MenuImages/menubuttons/noCursor/networkScreen/join.png',
      btnHost: 'MenuImages/menubuttons/noCursor/networkScreen/host.png',

      crosshairOuter: range(9, (i) => `GameImages/sprites/crosshair/outerCrosshair${i}.png`),
      crosshairInner: range(18, (i) => `GameImages/sprites/crosshair/innerCrosshair${i}.png`),
      explosion: range(24, (i) => `GameImages/sprites/explosion/explosion${i}.png`),
      // The last frame of each of these never existed; Java drew nothing for it.
      fragOut: range(33, (i) => `GameImages/sprites/fragOut/frag${i}.png`),
      enemyExplosion: range(14, (i) => `GameImages/sprites/enemyExplosion/explosion${i}.png`),
      turret: TURRET_DIRS.map((d) => `GameImages/sprites/turret/${d}.png`),
      turret2: TURRET_DIRS.map((d) => `GameImages/sprites/turret2/${d}.png`),
      weapons: range(NUM_WEAPON_TYPES, (i) => `GameImages/sprites/weapons/${WEAPON_FILES[i]}.png`),
      items: range(NUM_ITEM_TYPES, (i) => `GameImages/sprites/items/${ITEM_FILES[i]}.png`),
    };
    for (const set of SPRITE_SETS) {
      m[set] = range(32, (i) => `GameImages/sprites/${set}/${WALK_DIRS[Math.floor(i / 4)]}Walk${i % 4}.png`);
    }
    return m;
  }

  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => {
        console.warn('Failed to load', src);
        resolve(null);
      };
      img.src = src;
    });
  }

  async function loadAll(onProgress) {
    const m = manifest();
    const jobs = [];
    for (const [key, value] of Object.entries(m)) {
      if (Array.isArray(value)) {
        IMG[key] = new Array(value.length).fill(null);
        value.forEach((p, i) => jobs.push([p, (img) => (IMG[key][i] = img)]));
      } else {
        jobs.push([value, (img) => (IMG[key] = img)]);
      }
    }
    let done = 0;
    await Promise.all(
      jobs.map(([path, assign]) =>
        loadImage(BASE + path).then((img) => {
          assign(img);
          onProgress(++done / jobs.length);
        })
      )
    );
  }

  return { loadAll, loadImage };
})();

// Safe draw: missing frames are simply skipped, like Java's drawImage(null)
function drawImg(ctx, img, x, y, w, h) {
  if (!img) return;
  if (w === undefined) ctx.drawImage(img, x, y);
  else ctx.drawImage(img, x, y, w, h);
}
