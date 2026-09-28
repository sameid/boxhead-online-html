// Gameplay: a port of MainApplet.gameplay() (update) and the in-game half of
// MainApplet.paint() (render). Runs on a fixed 20ms tick like the applet's
// run() loop (gameplay(); delay(20);).
//
// Multiplayer follows the applet's host/client split:
//  - Game (mode 'host') runs the whole world. The partner's character is a
//    "networkPlayer" whose position comes from the client, and whose freshly
//    fired bullets/turrets are handed over to the host to simulate.
//  - ClientGame moves its own character locally and renders the host's
//    snapshots (the old ServerPacket).
// Health and score are shared between partners, as in the original.

'use strict';

const LEVEL_1_NUM_ENEMIES = 20;
const ENEMY_MULTIPLIER = 1.5;
const LEVEL_1_SPAWN_DELAY = 1;

const HOST_NAME_COLOR = 'rgb(200, 200, 250)';
const CLIENT_NAME_COLOR = 'rgb(200, 250, 200)';

const round1 = (v) => Math.round(v * 10) / 10;
const round3 = (v) => Math.round(v * 1000) / 1000;

function makeCharacter(x, y) {
  const c = new Character();
  c.width = CHAR_SIZE;
  c.height = CHAR_SIZE;
  c.x = x;
  c.y = y;
  c.aimX = x;
  c.aimY = y;
  c.aimDirection = -1;
  return c;
}

// Character <-> compact array for the wire
function packPose(c) {
  return [round1(c.x), round1(c.y), round3(c.direction), round3(c.aimDirection), round1(c.aimX), round1(c.aimY), round1(c.distanceTravelled)];
}

function applyPose(c, p) {
  [c.x, c.y, c.direction, c.aimDirection, c.aimX, c.aimY, c.distanceTravelled] = p;
  c.radian = true;
}

// Keyboard/mouse handling from the top of gameplay(), shared by host, client and solo
function applyPlayerInput(player, input, crosshair, currentTime) {
  const weapon = player.weapon;
  let dir = 0;
  if (input.up) dir = input.left ? 315 : input.right ? 45 : 0;
  else if (input.down) dir = input.left ? 225 : input.right ? 135 : 180;
  else if (input.left) dir = 270;
  else if (input.right) dir = 90;

  if (input.rotateWeapon) {
    weapon.rotateWeapon(NUM_WEAPON_TYPES);
    input.rotateWeapon = false;
  } else if (input.rotateWeaponReverse) {
    weapon.rotateWeaponReverse(NUM_WEAPON_TYPES);
    input.rotateWeaponReverse = false;
  }
  const moving = input.up || input.down || input.left || input.right;
  if (moving) player.calculateMove(1, dir);

  if (input.mousePressed) {
    const dx = player.x - input.mouseX;
    const dy = player.y - input.mouseY;
    let angle = Math.atan(dx / dy);
    if (angle < 0) angle *= -1;
    if (dx <= 0) {
      if (dy < 0) angle = Math.PI - angle;
    } else if (dx > 0) {
      if (dy <= 0) angle = Math.PI + angle;
      else if (dy > 0) angle = 2 * Math.PI - angle;
    }
    if (Number.isNaN(angle)) angle = 0; // clicked dead centre on the player

    player.shootWeaponRadians(angle, currentTime);
    player.aimRadians(1, angle);
    if (!moving) player.direction = toDegrees(angle);
    crosshair.checkFrameTime(currentTime);
  } else {
    player.aimRadians(0, 0);
    player.aimDirection = -1;
    crosshair.freeze(currentTime);
  }
}

class Game {
  // mode: 'solo' | 'host'. names: { host, client } nicknames for multiplayer
  constructor({ mode = 'solo', names = null } = {}) {
    this.mode = mode;
    this.multiplayer = mode === 'host';
    this.names = names;

    this.currentTime = 0;
    this.level = 0;
    this.newLevel = true;
    this.currentScore = 0;
    this.spawningEnemies = LEVEL_1_NUM_ENEMIES;
    this.spawningEnemies2 = 0; // fast / explosive zombies
    this.spawningEnemies3 = 0; // large zombies
    this.spawningBoss = 0;
    this.timeLastSpawn = 0;

    this.enemies = [];
    this.obstacles = [];
    this.itemDrops = [];
    this.explosions = [];
    this.crosshair = new Crosshair(this.currentTime);

    // Solo starts in the middle; the host takes the left third, the client the right
    this.player = makeCharacter(this.multiplayer ? SCREEN_WIDTH / 3 : SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2);
    this.player.weapon = new Weapon(NUM_WEAPON_TYPES, (w) => this.emit(Sound.shotSlot(w)));

    if (this.multiplayer) {
      this.networkPlayer = makeCharacter((2 * SCREEN_WIDTH) / 3, SCREEN_HEIGHT / 2);
      this.clientPose = null;
      this.pendingBullets = [];
      this.pendingTurrets = [];
      this.clientPickups = []; // items the partner walked over (itemsTouched)
      this.clientStuck = false; // partner is caught in sticky goo
      this.outSfx = [];
    }

    // random.nextInt(8) + 5 is re-rolled every iteration in the original loop
    for (let i = 0; i < randInt(8) + 5; i++) this.obstacles.push(new Obstacle());
  }

  get isOver() {
    return this.player.health <= 0;
  }

  // Plays a sound here and, when hosting, on the partner's machine too
  emit(slot) {
    if (slot < 0) return;
    Sound.play(slot);
    if (this.multiplayer) this.outSfx.push(slot);
  }

  // ---- multiplayer plumbing (host side) ------------------------------------

  startMessage() {
    return { t: 'start', obstacles: this.obstacles.map((o) => [o.x, o.y, o.width]) };
  }

  onClientInput(msg) {
    this.clientPose = msg.p;
    this.pendingBullets.push(...msg.b);
    this.pendingTurrets.push(...msg.tu);
    for (const s of msg.sfx) Sound.play(s); // partner's gunfire
  }

  // The ServerPacket. Events (pickups, sounds) are cleared once taken.
  takeSnapshot() {
    const weapon = this.player.weapon;
    const msg = {
      t: 'state',
      time: this.currentTime,
      level: this.level,
      score: this.currentScore,
      hp: this.player.health,
      p: packPose(this.player),
      e: this.enemies.map((e) => [round1(e.x), round1(e.y), round3(e.direction), e.type, e.startTime]),
      b: weapon.bullets.map((b) => [round1(b.x), round1(b.y), b.gunType]),
      tu: weapon.turrets.map((t) => [t.x, t.y, t.type, round3(t.direction), t.ammo]),
      i: this.itemDrops.map((i) => [i.x, i.y, i.type]),
      x: this.explosions.map((x) => [round1(x.x), round1(x.y), x.type, x.startTime]),
      got: this.clientPickups,
      stuck: this.clientStuck,
      sfx: this.outSfx,
    };
    this.clientPickups = [];
    this.outSfx = [];
    return msg;
  }

  // ---------------------------------------------------------------------------

  // input: { up, down, left, right, mousePressed, mouseX, mouseY, rotateWeapon, rotateWeaponReverse }
  tick(input) {
    this.currentTime += TICK_MS;
    const currentTime = this.currentTime;
    const player = this.player;
    const weapon = player.weapon;
    const np = this.multiplayer ? this.networkPlayer : null;

    applyPlayerInput(player, input, this.crosshair, currentTime);

    const allBullets = weapon.bullets;
    const turrets = weapon.turrets;
    const enemies = this.enemies;
    const explosions = this.explosions;
    const obstacles = this.obstacles;

    // --- partner's latest position, bullets and turrets (the ClientPacket) ------
    if (np) {
      if (this.clientPose) applyPose(np, this.clientPose);
      for (const [x, y, gunType, direction] of this.pendingBullets) {
        const b = new Bullet(x, y, PISTOL, direction);
        b.gunType = gunType;
        if (gunType === 5) b.startTime = currentTime; // grenade fuse starts now
        allBullets.push(b);
      }
      for (const [x, y, type] of this.pendingTurrets) turrets.push(new Turret(weapon, x, y, type));
      this.pendingBullets = [];
      this.pendingTurrets = [];
      this.clientStuck = false;
    }

    // --- turrets -------------------------------------------------------------
    for (const t of turrets) {
      t.enemiesInVicinity = 0;
      for (const e of enemies) t.aim(e.x, e.y);
      if (t.enemiesInVicinity === 0) t.resetTurret();
    }
    for (let i = 0; i < turrets.length; i++) {
      if (turrets[i].shoot(currentTime, (w) => this.emit(Sound.shotSlot(w)))) {
        turrets.splice(i, 1);
        i--;
      }
    }

    // --- level progression -----------------------------------------------------
    if (enemies.length === 0 && this.spawningEnemies === 0) this.newLevel = true;
    if (this.newLevel) {
      this.newLevel = false;
      this.level++;
      this.spawningEnemies = trunc(LEVEL_1_NUM_ENEMIES * Math.pow(ENEMY_MULTIPLIER, this.level - 1));
      this.spawningEnemies2 = this.level >= 3 ? trunc(this.spawningEnemies / 3) : 0;
      this.spawningEnemies3 = this.level >= 5 ? trunc(this.spawningEnemies / 4) : 0;
      if (this.level >= 11) this.spawningBoss = trunc((3 * this.spawningEnemies) / 12);
      player.recieveItem(HEALTH_PICKUP); // heal up before each level
      this.emit(Sound.SFX.HEALTH);
    }

    const addExplosion = (x, y, type) => {
      explosions.push(new Explosion(x, y, currentTime, type));
      if (type === Explosion.RPG_EXPLOSION) this.emit(Sound.SFX.EXPLOSION);
      else if (type === Explosion.GRENADE_EXPLOSION) this.emit(Sound.SFX.FRAG_OUT);
      else this.emit(Sound.SFX.GAS_EXPLOSION);
    };

    // --- bullets: movement, sticky shots, grenades, rockets ---------------------
    for (let i = 0; i < allBullets.length; i++) {
      const b = allBullets[i];
      let remove = false;
      let remove2 = false;
      let tempNum = 0;

      if (b.gunType !== 6 || b.startTime === 0) b.moveBullet(currentTime);
      else if (b.stopSticky(currentTime)) remove = true; // sticky goo wears off

      if (b.gunType === 6 && b.startTime === 0) {
        // health is shared, so hits on either partner come off the host's bar
        if (np && collisionDetection(b, np)[0]) {
          b.startTime = currentTime;
          player.damageCharacter(b.getBulletDamage());
        }
        if (collisionDetection(b, player)[0]) {
          b.startTime = currentTime;
          player.damageCharacter(b.getBulletDamage());
        }
      }
      if (b.gunType === 6 && b.startTime !== 0) {
        const reach = Bullet.STICKY_RADIUS + half(player.width);
        if (Math.sqrt((player.x - b.x) ** 2 + (player.y - b.y) ** 2) <= reach) {
          player.speedX = 0;
          player.speedY = 0;
        }
        if (np && Math.sqrt((np.x - b.x) ** 2 + (np.y - b.y) ** 2) <= reach) this.clientStuck = true;
      }

      const size = b.getSize();
      if (b.x > SCREEN_WIDTH + size || b.x < -size || b.y > SCREEN_HEIGHT + size || b.y < -size) remove = true;

      if (!remove && b.gunType === 5 && b.detonateGrenade(currentTime)) {
        remove = true;
        addExplosion(b.x, b.y, Explosion.GRENADE_EXPLOSION);
      }

      if (!remove && b.gunType === 4) {
        // rocket vs other bullets
        for (let j = 0; j < allBullets.length; j++) {
          if (i !== j && collisionDetection(b, allBullets[j])[0]) {
            addExplosion(allBullets[j].x, allBullets[j].y, Explosion.RPG_EXPLOSION);
            if (j > i) allBullets.splice(j, 1);
            else {
              remove2 = true;
              tempNum = j;
            }
            remove = true;
            break;
          }
        }
      }

      if (!remove) {
        // rockets and grenades caught in a blast chain-explode
        for (let j = 0; j < explosions.length; j++) {
          if (explosions[j].explosionPhase !== 1) continue;
          if (b.gunType === 4 && explosions[j].chainExplode(b)) {
            remove = true;
            addExplosion(b.x, b.y, Explosion.RPG_EXPLOSION);
          } else if (b.gunType === 5 && explosions[j].chainExplode(b)) {
            remove = true;
            addExplosion(b.x, b.y, Explosion.GRENADE_EXPLOSION);
          }
        }
      }

      if (remove) {
        allBullets.splice(i, 1);
        i--;
        if (remove2) {
          allBullets.splice(tempNum, 1);
          i--;
        }
      }
    }

    // --- obstacles vs character and bullets --------------------------------------
    for (const o of obstacles) {
      collisionDetection(player, o);
      for (let j = 0; j < allBullets.length; j++) {
        const b = allBullets[j];
        const bulletCollide = collisionDetection(b, o);
        if (!bulletCollide[0]) continue;
        if (b.gunType === 4) {
          addExplosion(b.x, b.y, Explosion.RPG_EXPLOSION);
        } else if (b.gunType === 5) {
          b.direction = Game.bounce(b.direction, bulletCollide[1]);
        } else if (b.gunType === 6 && b.startTime === 0) {
          b.startTime = currentTime;
        }
        if (b.gunType !== 5 && b.gunType !== 6) {
          allBullets.splice(j, 1);
          j--;
        }
      }
    }

    // --- spawning --------------------------------------------------------------
    if (this.spawningEnemies > 0) {
      const level = this.level;
      const spawnTime = this.timeLastSpawn + (LEVEL_1_SPAWN_DELAY / (Math.log10(level + 2) / Math.log10(3))) * 1000;
      if (spawnTime <= currentTime) {
        let enemyRandom;
        if (level >= 3 && level <= 5) enemyRandom = 9; // fast zombies
        else if (level < 9) enemyRandom = 11; // big strong zombies
        else if (level < 11) enemyRandom = 14; // explosive zombies
        else if (level < 12) enemyRandom = 15;
        else if (level < 13) enemyRandom = 17;
        else enemyRandom = 18;

        const r = randInt(enemyRandom);
        let type = 0;
        if (this.spawningEnemies2 > 0 && r >= 5 && r <= 8) {
          this.spawningEnemies2--;
          type = 1;
        } else if (this.spawningEnemies3 > 0 && r >= 9 && r <= 10) {
          this.spawningEnemies3--;
          type = 2;
        } else if (this.spawningEnemies2 > 0 && r >= 11 && r <= 13) {
          this.spawningEnemies2--;
          type = 3;
        } else if (this.spawningBoss > 0 && r >= 14 && r <= 15) {
          this.spawningBoss--;
          type = 4;
        } else if (this.spawningBoss > 0 && r === 16) {
          this.spawningBoss--;
          type = 5;
        } else if (this.spawningBoss > 0 && r === 17) {
          this.spawningBoss--;
          type = 6;
        }

        const e = new Enemy(type, level);
        e.enemySpawn(SCREEN_WIDTH, SCREEN_HEIGHT, currentTime);
        enemies.push(e);
        this.spawningEnemies--;
        this.timeLastSpawn = currentTime;
      }
    }

    // --- enemies -----------------------------------------------------------------
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      e.checkFrameTime(currentTime);
      let temp = null;

      // Zombies go after whichever partner is closer
      let target = player;
      if (np && Math.hypot(np.x - e.x, np.y - e.y) <= Math.hypot(player.x - e.x, player.y - e.y)) target = np;

      if (e.enemyCalculateMove(target.x, target.y, currentTime)) {
        if (e.type !== 4) {
          player.damageCharacter(e.getDamage());
        } else {
          // shooter: fires an immobilising goo ball at the player
          const angle = -e.direction + (3 * Math.PI) / 2;
          allBullets.push(new Bullet(e.x, e.y, ENEMY_SHOT, angle));
        }
      }

      for (let j = 0; j < enemies.length; j++) {
        if (j !== i) collisionDetection(e, enemies[j]);
        if (e.moveX === 0 && e.moveY === 0) break;
      }
      for (let j = 0; j < obstacles.length; j++) {
        collisionDetection(e, obstacles[j]);
        if (e.moveX === 0 && e.moveY === 0) break;
      }
      for (const t of turrets) collisionDetection(e, t);

      e.move();

      for (const ex of explosions) {
        if (ex.explosionPhase === 1) temp = e.damageEnemy(ex.damageEnemy(e));
      }

      for (let j = 0; j < allBullets.length; j++) {
        const b = allBullets[j];
        const bulletCollide = collisionDetection(b, e);
        if (!e.alive || !bulletCollide[0] || b.gunType === 6) continue;

        let removeBullet = true;
        if (e.type !== 6) temp = e.damageEnemy(b.getBulletDamage());

        if (b.gunType === 4) {
          addExplosion(b.x, b.y, Explosion.RPG_EXPLOSION);
        } else if (b.gunType === 5) {
          addExplosion(b.x, b.y, Explosion.GRENADE_EXPLOSION);
        } else if (e.type === 6) {
          // armoured boss: bullets ricochet
          b.direction = Game.bounce(b.direction, bulletCollide[1]);
          removeBullet = false;
        } else if (b.gunType === 3) {
          removeBullet = false; // sniper rounds pierce
        }
        if (removeBullet) {
          allBullets.splice(j, 1);
          j--;
        }
      }

      collisionDetection(player, e);

      if (!e.alive) {
        if (e.type === 3) {
          addExplosion(e.x, e.y, Explosion.ENEMY_EXPLOSION);
        } else if (e.type === 5) {
          // splits into four fast zombies
          for (let j = 0; j < 4; j++) {
            const split = new Enemy(1, this.level);
            split.startTime = currentTime;
            split.x = e.x + 20 * Math.cos(e.direction + j * (Math.PI / 2));
            split.y = e.y + 20 * Math.sin(e.direction + j * (Math.PI / 2));
            split.alive = true;
            enemies.push(split);
          }
        }
        if (temp && temp[0] === 1) {
          this.itemDrops.push(new Item(temp, NUM_ITEM_TYPES, currentTime, this.level));
        }
        this.currentScore += (e.type + 1) * 10 + (e.type + 1) * randInt(5);
        enemies.splice(i, 1);
        i--;
      }
    }

    // --- explosions --------------------------------------------------------------
    for (const ex of explosions) {
      if (ex.explosionPhase !== 1) continue;
      player.damageCharacter(ex.damageCharacter(player));
      if (np) player.damageCharacter(ex.damageCharacter(np));
    }
    for (let i = 0; i < explosions.length; i++) {
      const ex = explosions[i];
      if (ex.startDamage(currentTime) && ex.explosionPhase === 0) ex.explosionPhase = 1;
      else if (ex.explosionPhase === 1) ex.explosionPhase = 2;
      if (ex.toRemove(currentTime)) {
        explosions.splice(i, 1);
        i--;
      }
    }

    if (np) collisionDetection(player, np);

    // --- items -------------------------------------------------------------------
    for (let i = 0; i < this.itemDrops.length; i++) {
      const item = this.itemDrops[i];
      if (collisionDetection(player, item)[0]) {
        player.recieveItem(item.type);
        Sound.play(Sound.pickupSlot(item.type));
        this.itemDrops.splice(i, 1);
        i--;
      } else if (np && collisionDetection(np, item)[0]) {
        // weapons go to the partner; health is shared so it heals here
        if (item.type === HEALTH_PICKUP) player.recieveItem(HEALTH_PICKUP);
        this.clientPickups.push(item.type);
        this.itemDrops.splice(i, 1);
        i--;
      }
    }
    for (let i = 0; i < this.itemDrops.length; i++) {
      if (this.itemDrops[i].addTimer(currentTime)) {
        this.itemDrops.splice(i, 1);
        i--;
      }
    }

    for (const t of turrets) collisionDetection(player, t);

    player.moveCharacter();
  }

  // Grenade / ricochet reflection
  static bounce(dir, hitTopOrBottom) {
    if (dir <= Math.PI) return hitTopOrBottom ? Math.PI - dir : 2 * Math.PI - dir;
    if (dir <= 2 * Math.PI) return hitTopOrBottom ? 3 * Math.PI - dir : 2 * Math.PI - dir;
    return dir;
  }

  view() {
    const characters = [{ c: this.player, sprite: 'main', dot: '#0000ff' }];
    if (this.multiplayer) {
      characters[0].name = this.names.host;
      characters[0].nameColor = HOST_NAME_COLOR;
      characters.push({ c: this.networkPlayer, sprite: 'main2', dot: '#00ff00', name: this.names.client, nameColor: CLIENT_NAME_COLOR });
    }
    return {
      time: this.currentTime,
      crosshair: this.crosshair,
      crosshairTime: this.currentTime,
      items: this.itemDrops,
      explosions: this.explosions,
      enemies: this.enemies,
      obstacles: this.obstacles,
      turrets: this.player.weapon.turrets,
      bullets: this.player.weapon.bullets,
      characters,
      level: this.level,
      score: this.currentScore,
      health: this.player.health,
      weapon: this.player.weapon,
    };
  }

  render(ctx, mouseX, mouseY) {
    renderWorld(ctx, this.view(), mouseX, mouseY);
  }
}

// ---------------------------------------------------------------------------
// Client side of a multiplayer game
// ---------------------------------------------------------------------------
class ClientGame {
  constructor(start, names) {
    this.multiplayer = true;
    this.names = names;
    this.currentTime = 0; // local clock: weapon cooldowns, crosshair
    this.crosshair = new Crosshair(0);
    this.outSfx = [];

    this.player = makeCharacter((2 * SCREEN_WIDTH) / 3, SCREEN_HEIGHT / 2);
    this.player.weapon = new Weapon(NUM_WEAPON_TYPES, (w) => {
      const slot = Sound.shotSlot(w);
      Sound.play(slot);
      this.outSfx.push(slot);
    });
    this.host = makeCharacter(SCREEN_WIDTH / 3, SCREEN_HEIGHT / 2);

    this.obstacles = start.obstacles.map(([x, y, w]) => Object.assign(Object.create(Obstacle.prototype), { x, y, width: w, height: w }));
    this.enemies = [];
    this.bullets = [];
    this.turrets = [];
    this.items = [];
    this.explosions = [];
    this.worldTime = 0; // host clock: enemy and explosion animation
    this.level = 0;
    this.currentScore = 0;
    this.hp = 100;
    this.stuck = false;
  }

  get isOver() {
    return this.hp <= 0;
  }

  applySnapshot(s) {
    const make = (proto, fields) => Object.assign(Object.create(proto), fields);
    this.worldTime = s.time;
    this.level = s.level;
    this.currentScore = s.score;
    this.hp = s.hp;
    this.stuck = s.stuck;
    applyPose(this.host, s.p);
    this.enemies = s.e.map(([x, y, direction, type, startTime]) => make(Enemy.prototype, { x, y, direction, type, startTime, moveX: 0, moveY: 0 }));
    this.bullets = s.b.map(([x, y, gunType]) => make(Bullet.prototype, { x, y, gunType, direction: 0, startTime: 0 }));
    this.turrets = s.tu.map(([x, y, type, direction, ammo]) => make(Turret.prototype, { x, y, type, direction, ammo }));
    this.items = s.i.map(([x, y, type]) => make(Item.prototype, { x, y, type }));
    this.explosions = s.x.map(([x, y, type, startTime]) => make(Explosion.prototype, { x, y, type, startTime }));

    for (const type of s.got) {
      if (type !== HEALTH_PICKUP) this.player.recieveItem(type); // health is applied on the host
      Sound.play(Sound.pickupSlot(type));
    }
    for (const slot of s.sfx) Sound.play(slot);
  }

  // Moves our own character and returns the ClientPacket for the host
  tick(input) {
    this.currentTime += TICK_MS;
    const player = this.player;
    applyPlayerInput(player, input, this.crosshair, this.currentTime);
    if (this.stuck) {
      player.speedX = 0;
      player.speedY = 0;
    }
    for (const o of this.obstacles) collisionDetection(player, o);
    for (const e of this.enemies) collisionDetection(player, e);
    collisionDetection(player, this.host);
    for (const t of this.turrets) collisionDetection(player, t);
    player.moveCharacter();

    // Hand freshly fired bullets and turrets to the host, which simulates them
    const w = player.weapon;
    const msg = {
      t: 'input',
      p: packPose(player),
      b: w.bullets.map((b) => [round1(b.x), round1(b.y), b.gunType, b.direction]),
      tu: w.turrets.map((t) => [t.x, t.y, t.type]),
      sfx: this.outSfx,
    };
    w.bullets = [];
    w.turrets = [];
    this.outSfx = [];
    return msg;
  }

  view() {
    return {
      time: this.worldTime,
      crosshair: this.crosshair,
      crosshairTime: this.currentTime,
      items: this.items,
      explosions: this.explosions,
      enemies: this.enemies,
      obstacles: this.obstacles,
      turrets: this.turrets,
      bullets: this.bullets,
      characters: [
        { c: this.host, sprite: 'main', dot: '#0000ff', name: this.names.host, nameColor: HOST_NAME_COLOR },
        { c: this.player, sprite: 'main2', dot: '#00ff00', name: this.names.client, nameColor: CLIENT_NAME_COLOR },
      ],
      level: this.level,
      score: this.currentScore,
      health: this.hp,
      weapon: this.player.weapon,
    };
  }

  render(ctx, mouseX, mouseY) {
    renderWorld(ctx, this.view(), mouseX, mouseY);
  }
}

// ---------------------------------------------------------------------------
// Rendering (paint)
// ---------------------------------------------------------------------------

function sortY(obj) {
  if (obj instanceof Bullet) return obj.y + 5 - (obj.gunType === 6 ? 35 : 0);
  return obj.y;
}

// Maps a compass angle (radians, clockwise from up) to the sprite row
function characterDir(angle) {
  const P = Math.PI;
  if (angle <= P / 8 || angle >= (15 * P) / 8) return 0; // up
  if (angle <= (3 * P) / 8) return 4; // upRight
  if (angle <= (5 * P) / 8) return 3; // right
  if (angle <= (7 * P) / 8) return 6; // downRight
  if (angle <= (9 * P) / 8) return 1; // down
  if (angle <= (11 * P) / 8) return 7; // downLeft
  if (angle <= (13 * P) / 8) return 2; // left
  return 5; // upLeft
}

// Enemy direction points from the player to the enemy (math angle), so the
// sprite row is the opposite way. Offsets are the original hand-tuned nudges.
function enemyDir(angle) {
  const P = Math.PI;
  if (angle <= P / 8 || angle >= (15 * P) / 8) return [2, 0, 0];
  if (angle <= (3 * P) / 8) return [7, 0, -3];
  if (angle <= (5 * P) / 8) return [1, 6, -2];
  if (angle <= (7 * P) / 8) return [6, 5, -3];
  if (angle <= (9 * P) / 8) return [3, 5, 0];
  if (angle <= (11 * P) / 8) return [4, 5, -5];
  if (angle <= (13 * P) / 8) return [0, 6, -3];
  return [5, 0, -3];
}

function turretDir(angle) {
  const P = Math.PI;
  if (angle >= (3 * P) / 8 && angle <= (5 * P) / 8) return 3; // right
  if (angle >= (5 * P) / 8 && angle <= (7 * P) / 8) return 4; // downRight
  if (angle >= (7 * P) / 8 && angle <= (9 * P) / 8) return 1; // down
  if (angle >= (9 * P) / 8 && angle <= (11 * P) / 8) return 5; // downLeft
  if (angle >= (11 * P) / 8 && angle <= (13 * P) / 8) return 2; // left
  return 0; // up
}

const ENEMY_SPRITES = ['enemies', 'enemies2', 'enemies3', 'enemies4', 'boss', 'boss2', 'boss3'];

function renderWorld(ctx, view, mouseX, mouseY) {
  const time = view.time;

  drawImg(ctx, IMG.background, 0, 0);

  const items = [...view.items].sort((a, b) => a.y - b.y);
  for (const item of items) {
    drawImg(ctx, IMG.items[item.type], item.x - Item.ITEM_SIZE / 2, item.y - Item.ITEM_SIZE / 2);
  }

  const charInfo = new Map(view.characters.map((info) => [info.c, info]));
  const drawing = [...view.enemies, ...view.obstacles, ...view.turrets, ...view.bullets, ...charInfo.keys()];
  drawing.sort((a, b) => sortY(a) - sortY(b));

  ctx.font = `20px ${FONT}`;
  for (const obj of drawing) {
    if (obj instanceof Character) {
      const info = charInfo.get(obj);
      let angle = obj.aimDirection;
      if (angle === -1) angle = toRadians(obj.direction);
      ctx.fillStyle = info.dot;
      ctx.beginPath();
      ctx.arc(trunc(obj.aimX), trunc(obj.aimY), 3, 0, Math.PI * 2);
      ctx.fill();
      drawImg(ctx, IMG[info.sprite][obj.getFrame(characterDir(angle))], obj.getXAsInt(), obj.getYAsInt() - 10);
    } else if (obj instanceof Enemy) {
      const [dir, extra, extra2] = enemyDir(obj.direction);
      const big = obj.type === 2 || obj.type === 6 ? 2 : 1;
      const frames = IMG[ENEMY_SPRITES[obj.type]];
      drawImg(ctx, frames[obj.getFrame(dir, time)], trunc(obj.x) - obj.getWidth() + extra * big, trunc(obj.y) - obj.getHeight() + extra2 * big);
    } else if (obj instanceof Obstacle) {
      drawImg(ctx, IMG.obstacle, obj.getXAsInt() - 57 + half(obj.width), obj.getYAsInt() - 154 + obj.height);
    } else if (obj instanceof Bullet) {
      const img = obj.gunType === 4 ? IMG.rocket : obj.gunType === 5 ? IMG.grenade : obj.gunType === 6 ? IMG.stickyBullet : IMG.bullet;
      drawImg(ctx, img, obj.getXAsInt(), obj.getYAsInt());
    } else if (obj instanceof Turret) {
      const frames = obj.type === 0 ? IMG.turret : IMG.turret2;
      drawImg(ctx, frames[turretDir(obj.direction)], obj.x - Turret.SIZE / 2, obj.y - Turret.SIZE / 2 - 20);
      const ammo = String(obj.ammo);
      ctx.fillStyle = '#fff';
      ctx.fillText(ammo, obj.x - 10 - 3 * (ammo.length - 3), obj.y - Turret.SIZE / 2 - 5);
    }
  }

  for (const ex of view.explosions) {
    const set = ex.type === Explosion.RPG_EXPLOSION ? IMG.explosion : ex.type === Explosion.GRENADE_EXPLOSION ? IMG.fragOut : IMG.enemyExplosion;
    const size = set[0] ? half(set[0].width) : 0;
    drawImg(ctx, set[ex.getFrame(time)], trunc(ex.x - size), trunc(ex.y - size));
  }

  // Gamertags over each partner's head
  for (const info of view.characters) {
    if (!info.name) continue;
    drawText(ctx, info.name, info.c.getXAsInt() - 5, info.c.getYAsInt() - CHAR_SIZE + 10, 24, info.nameColor);
  }

  const ct = view.crosshairTime;
  drawImg(ctx, IMG.crosshairOuter[view.crosshair.getOuterFrame(ct)], mouseX - 60, mouseY - 60);
  drawImg(ctx, IMG.crosshairInner[view.crosshair.getInnerFrame(ct)], mouseX - 60, mouseY - 60);

  renderHud(ctx, view);
}

function renderHud(ctx, view) {
  const weapon = view.weapon;
  const w = weapon.getWeapon();

  drawImg(ctx, IMG.hud, 0, 0);
  drawText(ctx, String(view.level), 70, 44, 52);
  drawText(ctx, String(view.score), 200, 44, 52);

  ctx.fillStyle = 'rgb(65, 105, 225)';
  ctx.fillRect(334, 16, Math.max(0, trunc(3.48 * view.health)), 18);

  const img = IMG.weapons[w];
  const iw = img ? img.width : 0;
  drawImg(ctx, img, SCREEN_WIDTH - iw - 15, w === TURRET || w === RPG_TURRET ? 0 : 5);

  ctx.fillStyle = '#fff';
  ctx.font = `52px ${FONT}`;
  const ammo = weapon.getAmmo();
  const max = Weapon.MAX_AMMO[w];
  if (w === MACHINE) ctx.fillText(`${ammo}/200`, SCREEN_WIDTH - iw - 180, 42);
  else if (w === PISTOL) drawImg(ctx, IMG.infinity, SCREEN_WIDTH - iw - 120, 0);
  else if (w === SHOTGUN || w === GRENADE) ctx.fillText(`${ammo}/${max}`, SCREEN_WIDTH - iw - 120, 42);
  else if (w === TURRET || w === RPG_TURRET) ctx.fillText(String(ammo), SCREEN_WIDTH - iw - 50, 42);
  else if (w === SNIPER || w === RPG) ctx.fillText(`${ammo}/${max}`, SCREEN_WIDTH - iw - 90, 42);
}
