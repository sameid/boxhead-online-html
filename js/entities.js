// Game entities, ported from the original Java classes
// (Character, Enemy, Bullet, Weapon, Turret, Explosion, Item, Obstacle, Crosshair).
// Constants and quirks are kept as-is so the game plays like the applet did.

'use strict';

const SCREEN_WIDTH = 1016;
const SCREEN_HEIGHT = 662;
const CHAR_SIZE = 30;
const HEALTH_POWERUP = 50;
const NUM_WEAPON_TYPES = 8;
const NUM_ITEM_TYPES = 8;

// Weapon / item ids (MainApplet constants)
const PISTOL = 0;
const MACHINE = 1;
const SHOTGUN = 2;
const GRENADE = 3;
const TURRET = 4;
const SNIPER = 5;
const RPG = 6;
const RPG_TURRET = 7;
const ENEMY_SHOT = 8;

const HEALTH_PICKUP = 0;

// Java int helpers
const trunc = Math.trunc;
const half = (n) => trunc(n / 2);
const randInt = (n) => Math.floor(Math.random() * n);
const toRadians = (deg) => (deg * Math.PI) / 180;
const toDegrees = (rad) => (rad * 180) / Math.PI;

// ---------------------------------------------------------------------------
// Character
// ---------------------------------------------------------------------------
class Character {
  static FRAME_PER_DISTANCE = 40;

  constructor() {
    this.x = 0;
    this.y = 0;
    this.health = 100;
    this.speedX = 0;
    this.speedY = 0;
    this.aimX = 0;
    this.aimY = 0;
    this.width = 0;
    this.height = 0;
    this.direction = 0; // walking direction (degrees, clockwise from up)
    this.aimDirection = 0; // aiming direction (-1 when not aiming)
    this.radian = false;
    this.weapon = null;
    this.distanceTravelled = 0;
  }

  calculateMove(magnitude, direction) {
    this.speedX = 10 * magnitude * Math.sin(toRadians(direction));
    this.speedY = 10 * magnitude * Math.cos(toRadians(direction));
    this.direction = direction;
  }

  getFrame(dir) {
    let tempNum = 0;
    for (let i = 0; i < 4; i++) {
      if (this.distanceTravelled - Character.FRAME_PER_DISTANCE * i > 0) tempNum = i;
    }
    return dir * 4 + tempNum;
  }

  moveCharacter() {
    this.x += this.speedX;
    this.y -= this.speedY;

    this.distanceTravelled += Math.sqrt(this.speedX ** 2 + this.speedY ** 2);
    if (this.distanceTravelled - Character.FRAME_PER_DISTANCE * 4 > 0) {
      this.distanceTravelled -= Character.FRAME_PER_DISTANCE * 4;
    }

    const hw = half(this.width);
    const hh = half(this.height);
    if (this.x < hw) this.x = hw;
    else if (this.x > SCREEN_WIDTH - hw) this.x = SCREEN_WIDTH - hw;
    if (this.y < hh) this.y = hh;
    else if (this.y > SCREEN_HEIGHT - hh) this.y = SCREEN_HEIGHT - hh;

    this.speedX = 0;
    this.speedY = 0;
  }

  aimRadians(magnitude, direction) {
    this.aimX = Math.sin(direction) * magnitude * 100 + this.x;
    this.aimY = Math.cos(direction) * magnitude * -100 + this.y;
    this.aimDirection = direction;
    this.radian = true;
  }

  damageCharacter(damage) {
    this.health -= damage;
  }

  healCharacter(heal) {
    this.health = Math.min(100, this.health + heal);
  }

  getXAsInt() {
    return trunc(this.x) - half(this.width);
  }

  getYAsInt() {
    return trunc(this.y) - half(this.height);
  }

  shootWeaponRadians(direction, currentTime) {
    return this.weapon.shootWeapon(this.x, this.y, direction, currentTime);
  }

  recieveItem(itemType) {
    if (itemType === HEALTH_PICKUP) this.healCharacter(HEALTH_POWERUP);
    else this.weapon.recieveItem(itemType);
  }
}

// ---------------------------------------------------------------------------
// Enemy
// ---------------------------------------------------------------------------
// 0 - normal hp, normal speed - orange
// 1 - normal hp, fast speed - red
// 2 - high hp, slow speed, high damage - brown
// 3 - normal hp, fast speed, explosive - white
// 4 - normal hp, normal speed, shoots immobilising projectile - orange w/ green
// 5 - high hp, fast speed, double damage, splits into reds on death - red w/ green
// 6 - high hp, slow speed, high damage, bullets deflect - brown w/ green
class Enemy {
  static WIDTH = [20, 20, 40, 20, 20, 20, 40];
  static HEIGHT = [20, 20, 40, 20, 20, 20, 40];
  static ATTACKING_DISTANCE = [30, 30, 30, 30, 400, 30, 30];
  static MAX_HP = [100, 100, 300, 100, 100, 200, 500];
  static ENEMY_DAMAGE = [5, 5, 15, 5, 5, 10, 30];
  static ATTACK_DELAY = [300, 300, 600, 300, 2000, 300, 600];
  static IMAGE_FRAME_DELAY_1 = 20; // normal
  static IMAGE_FRAME_DELAY_2 = 10; // fast
  static IMAGE_FRAME_DELAY_3 = 30; // slow

  constructor(type, level) {
    this.speed = 1.0;
    this.direction = 0;
    this.moveX = 0;
    this.moveY = 0;
    this.attackCounter = 0;
    this.startTime = 0;

    if (type === 0 || type === 4) {
      this.setSpeed(Math.min(7, 1 + (level - 1) * 0.3));
    } else if (type === 1 || type === 3 || type === 5) {
      this.setSpeed(Math.min(10, 4 + (level - 1) * 0.3));
    } else if (type === 2 || type === 6) {
      if (this.speed + (level - 1) * 0.3 > 5) this.setSpeed(5);
      else this.setSpeed(-0.5 + (level - 1) * 0.3);
    }

    this.type = type;
    this.hp = Enemy.MAX_HP[type];
    this.x = -50;
    this.y = -50;
    this.alive = false;
  }

  setSpeed(speed) {
    this.speed = Math.min(10, speed);
  }

  frameDelay() {
    const t = this.type;
    if (t === 0 || t === 4) return Enemy.IMAGE_FRAME_DELAY_1;
    if (t === 1 || t === 3 || t === 5) return Enemy.IMAGE_FRAME_DELAY_2;
    return Enemy.IMAGE_FRAME_DELAY_3;
  }

  checkFrameTime(currentTime) {
    const time = Math.floor((currentTime - this.startTime) / 10); // centiseconds
    const animationLength = this.frameDelay() * 4;
    if (time - animationLength > 0) this.startTime += animationLength * 10;
  }

  getFrame(dir, currentTime) {
    const time = Math.floor((currentTime - this.startTime) / 10);
    const delay = this.frameDelay();
    let tempNum = 0;
    for (let i = 0; i < 4; i++) {
      if (time - delay * i > 0) tempNum = i;
    }
    return dir * 4 + tempNum;
  }

  // Spawns on a circle around the centre of the map, just off screen
  enemySpawn(maxX, maxY, currentTime) {
    const hx = half(maxX);
    const hy = half(maxY);
    const radius = 10 + trunc(Math.sqrt(hx ** 2 + hy ** 2));
    let tempX = randInt(radius);
    if (randInt(2) === 0) tempX *= -1;
    let tempY = trunc(Math.sqrt(radius ** 2 - tempX ** 2));
    if (randInt(2) === 0) tempY *= -1;
    this.x = hx + tempX;
    this.y = hy + tempY;
    this.alive = true;
    this.startTime = currentTime;
  }

  // Heads towards the character; returns true when an attack lands this tick
  enemyCalculateMove(charX, charY, currentTime) {
    let attacked = false;
    const xDistance = charX - this.x;
    const yDistance = charY - this.y;
    const hypotenuse = Math.sqrt(xDistance ** 2 + yDistance ** 2);
    let relatedAngle = Math.atan(yDistance / xDistance);
    if (relatedAngle < 0) relatedAngle *= -1;

    if (xDistance < 0) {
      if (yDistance < 0) this.direction = 2 * Math.PI - relatedAngle;
      else if (yDistance > 0) this.direction = relatedAngle;
    } else if (xDistance > 0) {
      if (yDistance < 0) this.direction = Math.PI + relatedAngle;
      else if (yDistance > 0) this.direction = Math.PI - relatedAngle;
    }

    this.moveX = -this.speed * Math.cos(this.direction);
    this.moveY = -this.speed * Math.sin(this.direction);

    if (hypotenuse <= Enemy.ATTACKING_DISTANCE[this.type]) {
      if (this.attackCounter === 0) this.attackCounter = currentTime;
      if (this.type === 4) {
        // shooters keep walking until they're in melee range
        if (hypotenuse <= Enemy.ATTACKING_DISTANCE[0]) {
          this.moveX = 0;
          this.moveY = 0;
        }
      } else {
        this.moveX = 0;
        this.moveY = 0;
      }
      if (this.attackCounter + Enemy.ATTACK_DELAY[this.type] <= currentTime) {
        this.attackCounter = 0;
        attacked = true;
      }
    }
    return attacked;
  }

  move() {
    this.x += this.moveX;
    this.y -= this.moveY;
  }

  // Returns [dropsItem, x, y]
  damageEnemy(damage) {
    this.hp = trunc(this.hp - damage);
    const enemyStat = [0, trunc(this.x), trunc(this.y)];
    if (this.hp <= 0) {
      this.alive = false;
      if (randInt(4) === 1) enemyStat[0] = 1;
    }
    return enemyStat;
  }

  getWidth() {
    return Enemy.WIDTH[this.type];
  }

  getHeight() {
    return Enemy.HEIGHT[this.type];
  }

  getDamage() {
    return Enemy.ENEMY_DAMAGE[this.type];
  }
}

// ---------------------------------------------------------------------------
// Bullet
// ---------------------------------------------------------------------------
// Internal gun types:
// 0 - pistol, 1 - uzi (turret), 2 - shotgun, 3 - sniper, 4 - rpg (rpg turret),
// 5 - grenade, 6 - enemy projectile
class Bullet {
  static BULLET_SPEED = [15, 15, 15, 15, 15, 10, 10];
  static BULLET_DAMAGE = [50, 25, 100, 150, 0, 0, 5];
  static BULLET_SIZE = [10, 10, 10, 10, 10, 10, 30];
  static GRENADE_TIME_LIMIT = 2000;
  static STICKY_TIME_LIMIT = 1000;
  static STICKY_RADIUS = 20;

  // Java had two constructors; passing currentTime selects the second one.
  constructor(x, y, gunType, direction, currentTime) {
    this.startTime = 0;
    if (currentTime === undefined) {
      if (gunType === RPG) gunType = 4;
      else if (gunType === SNIPER) gunType = 3;
      else if (gunType === GRENADE) gunType = 5;
      else if (gunType === ENEMY_SHOT) gunType = 6;
    } else {
      if (gunType === GRENADE) {
        gunType = 5;
        this.startTime = currentTime;
      }
      if (gunType === ENEMY_SHOT) gunType = 6;
    }
    this.gunType = gunType;
    this.x = x;
    this.y = y;
    this.direction = direction;
  }

  detonateGrenade(currentTime) {
    return this.startTime + Bullet.GRENADE_TIME_LIMIT < currentTime;
  }

  stopSticky(currentTime) {
    return this.startTime + Bullet.STICKY_TIME_LIMIT < currentTime;
  }

  moveBullet(currentTime) {
    let value = 1;
    if (this.gunType === 5) {
      // grenades slow down as they roll
      value = Math.pow(0.984, Math.floor((currentTime - this.startTime) / 10));
    }
    const speed = value * Bullet.BULLET_SPEED[this.gunType];
    this.x += speed * Math.sin(this.direction);
    this.y -= speed * Math.cos(this.direction);
  }

  getXAsInt() {
    return trunc(this.x) - half(this.getSize());
  }

  getYAsInt() {
    return trunc(this.y) - half(this.getSize());
  }

  getBulletDamage() {
    return Bullet.BULLET_DAMAGE[this.gunType];
  }

  getSize() {
    return Bullet.BULLET_SIZE[this.gunType];
  }
}

// ---------------------------------------------------------------------------
// Weapon
// ---------------------------------------------------------------------------
class Weapon {
  static MAX_AMMO = [-1, 200, 12, 6, 1, 6, 6, 1];
  static DELAY = [350, 1, 1000, 700, 1000, 1000, 1000, 1000]; // indexed by weapon id

  constructor(numWeaponTypes, onShot) {
    this.availableWep = new Array(numWeaponTypes).fill(false);
    this.ammo = new Array(numWeaponTypes).fill(0);
    this.bullets = [];
    this.turrets = [];
    // The applet's clock was already large when a game began, so the first
    // shot was never on cooldown; our clock starts at 0.
    this.timeLastShot = -Infinity;
    this.onShot = onShot || (() => {});
    this.resetWeapons(numWeaponTypes);
  }

  rotateWeapon(numWeaponTypes) {
    do {
      this.currentWeapon++;
      if (this.currentWeapon === numWeaponTypes) this.currentWeapon = 0;
    } while (!this.availableWep[this.currentWeapon]);
  }

  rotateWeaponReverse(numWeaponTypes) {
    do {
      this.currentWeapon--;
      if (this.currentWeapon < 0) this.currentWeapon = numWeaponTypes - 1;
    } while (!this.availableWep[this.currentWeapon]);
  }

  chooseWeapon(weapon) {
    if (this.availableWep[weapon]) this.currentWeapon = weapon;
  }

  getWeapon() {
    return this.currentWeapon;
  }

  resetWeapons(numWeaponTypes) {
    this.availableWep[0] = true;
    for (let i = 1; i < numWeaponTypes; i++) this.availableWep[i] = false;
    this.currentWeapon = 0;
    this.ammo[0] = Weapon.MAX_AMMO[0];
  }

  shootWeapon(x, y, direction, currentTime) {
    const w = this.currentWeapon;
    if (this.timeLastShot + Weapon.DELAY[w] > currentTime) return false;

    if (w === SHOTGUN) {
      for (let i = 0; i < 7; i++) {
        this.bullets.push(new Bullet(x, y, w, direction - (Math.random() - 0.5) / 3));
      }
    } else if (w === TURRET) {
      this.turrets.push(new Turret(this, trunc(x), trunc(y), 0));
    } else if (w === RPG_TURRET) {
      this.turrets.push(new Turret(this, trunc(x), trunc(y), 1));
    } else if (w === GRENADE) {
      this.bullets.push(new Bullet(x, y, w, direction, currentTime));
    } else {
      this.bullets.push(new Bullet(x, y, w, direction));
    }

    this.timeLastShot = currentTime;
    this.onShot(w);
    if (w !== PISTOL) this.ammo[w]--;
    if (this.ammo[w] === 0) {
      this.availableWep[w] = false;
      this.rotateWeapon(this.availableWep.length);
      if (this.currentWeapon === 0) {
        // skip pistol if anything else is left
        let others = 0;
        for (let i = 1; i < this.availableWep.length; i++) if (this.availableWep[i]) others++;
        if (others > 0) this.rotateWeapon(this.availableWep.length);
      }
    }
    return true;
  }

  recieveItem(itemType) {
    this.availableWep[itemType] = true;
    this.ammo[itemType] = Weapon.MAX_AMMO[itemType];
  }

  getAmmo() {
    return this.ammo[this.currentWeapon];
  }
}

// ---------------------------------------------------------------------------
// Turret
// ---------------------------------------------------------------------------
class Turret {
  static SIZE = 30;
  static WEAPON_1_DELAY = 100;
  static WEAPON_2_DELAY = 1500;
  static MAX_AMMO = [100, 10];
  static SHOOTING_DISTANCE = 200;

  constructor(weapon, x, y, type) {
    this.x = x;
    this.y = y;
    this.weapon = weapon;
    this.direction = Math.PI;
    this.type = type;
    this.ammo = Turret.MAX_AMMO[type];
    this.shortestDistance = Turret.SHOOTING_DISTANCE;
    this.timeLastShot = -Infinity;
    this.allowShoot = false;
    this.enemiesInVicinity = 0;
  }

  // Called for every enemy; locks on to the nearest one in range
  aim(x, y) {
    const hypotenuse = Math.sqrt((x - this.x) ** 2 + (y - this.y) ** 2);
    let set = false;
    if (x >= 0 && x <= SCREEN_WIDTH && y >= 0 && y <= SCREEN_HEIGHT) {
      if (hypotenuse <= Turret.SHOOTING_DISTANCE && hypotenuse < this.shortestDistance) {
        set = true;
        this.enemiesInVicinity++;
      }
    }

    if (set) {
      const dx = this.x - x;
      const dy = this.y - (y + 10);
      let angle = Math.atan(dx / dy);
      if (angle < 0) angle *= -1;
      if (dx <= 0) {
        if (dy < 0) angle = Math.PI - angle;
      } else if (dx > 0) {
        if (dy <= 0) angle = Math.PI + angle;
        else if (dy > 0) angle = 2 * Math.PI - angle;
      }
      this.allowShoot = true;
      this.direction = angle;
      this.shortestDistance = hypotenuse;
    }
  }

  resetTurret() {
    this.shortestDistance = Turret.SHOOTING_DISTANCE;
    this.allowShoot = false;
  }

  // Returns true when the turret is out of ammo and should be removed
  shoot(currentTime, onShot) {
    if (!this.allowShoot) return false;
    let shot = false;
    if (this.type === 0 && this.timeLastShot + Turret.WEAPON_1_DELAY <= currentTime) {
      this.weapon.bullets.push(new Bullet(this.x, this.y - 10, MACHINE, this.direction));
      onShot(MACHINE);
      shot = true;
    } else if (this.type === 1 && this.timeLastShot + Turret.WEAPON_2_DELAY <= currentTime) {
      this.weapon.bullets.push(new Bullet(this.x, this.y - 10, RPG, this.direction));
      onShot(RPG);
      shot = true;
    }
    if (shot) {
      this.timeLastShot = currentTime;
      this.ammo--;
      if (this.ammo === 0) return true;
      this.resetTurret();
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Explosion
// ---------------------------------------------------------------------------
class Explosion {
  static RADIUS = 100; // rpg instant-kill zone
  static RADIUS_2 = 135; // rpg damage zone
  static EXPLODE_LENGTH = 600;
  static DAMAGE = 300;
  static DAMAGE_2 = 75;
  static DAMAGE_TIME = 50; // ms before the explosion starts damaging
  static CHARACTER_DAMAGE_2 = 10;
  static CHARACTER_DAMAGE_3 = 5;

  static GRENADE_RADIUS = 80;
  static GRENADE_RADIUS_2 = 120;
  static GRENADE_RADIUS_3 = 170;
  static GRENADE_DAMAGE = 100;
  static GRENADE_DAMAGE_2 = 75;
  static GRENADE_DAMAGE_3 = 50;

  static ENEMY_RADIUS = 95;
  static ENEMY_DAMAGE = 50;

  static RPG_EXPLOSION = 0;
  static GRENADE_EXPLOSION = 1;
  static ENEMY_EXPLOSION = 2;

  constructor(x, y, currentTime, type) {
    this.x = x;
    this.y = y;
    this.startTime = currentTime;
    this.type = type;
    this.explosionPhase = 0; // 0 = warming up, 1 = damaging (one tick), 2 = done damaging
  }

  toRemove(currentTime) {
    return this.startTime + Explosion.EXPLODE_LENGTH < currentTime;
  }

  getFrame(currentTime) {
    const time = Math.floor((currentTime - this.startTime) / 10);
    const f = Math.floor;
    if (this.type === Explosion.RPG_EXPLOSION) {
      if (time < 16) return time;
      if (time < 20) return 16 + f((time - 16) / 2);
      if (time < 32) return 18 + f((time - 20) / 4);
      if (time < 50) return 21 + f((time - 32) / 6);
      return 24;
    }
    if (this.type === Explosion.GRENADE_EXPLOSION) {
      return time > 16 ? 33 : time * 2;
    }
    if (time < 6) return time;
    if (time < 12) return 6 + f((time - 6) / 2);
    if (time < 15) return 9 + f((time - 12) / 3);
    if (time < 19) return 10 + f((time - 15) / 4);
    if (time < 34) return 11 + f((time - 19) / 5);
    return 14;
  }

  startDamage(currentTime) {
    return this.startTime + Explosion.DAMAGE_TIME < currentTime;
  }

  damageEnemy(enemy) {
    if (!(enemy.x > 0 && enemy.x < SCREEN_WIDTH && enemy.y > 0 && enemy.y < SCREEN_HEIGHT)) return 0;
    const hypotenuse = Math.sqrt((enemy.x - this.x) ** 2 + (enemy.y - this.y) ** 2);
    const pad = trunc((enemy.getWidth() + enemy.getHeight()) / 4);
    if (this.type === Explosion.GRENADE_EXPLOSION) {
      if (hypotenuse <= Explosion.GRENADE_RADIUS + pad) return Explosion.GRENADE_DAMAGE;
      if (hypotenuse <= Explosion.GRENADE_RADIUS_2 + pad) return Explosion.GRENADE_DAMAGE_2;
      if (hypotenuse <= Explosion.GRENADE_RADIUS_3 + pad) return Explosion.GRENADE_DAMAGE_3;
    } else if (this.type === Explosion.RPG_EXPLOSION) {
      if (hypotenuse <= Explosion.RADIUS + pad) return Explosion.DAMAGE;
      if (hypotenuse <= Explosion.RADIUS_2 + pad) return Explosion.DAMAGE_2;
    } else if (this.type === Explosion.ENEMY_EXPLOSION) {
      if (hypotenuse <= Explosion.ENEMY_RADIUS + pad) return Explosion.ENEMY_DAMAGE;
    }
    return 0;
  }

  damageCharacter(character) {
    const hypotenuse = Math.sqrt((character.x - this.x) ** 2 + (character.y - this.y) ** 2);
    const pad = half(CHAR_SIZE);
    if (this.type === Explosion.GRENADE_EXPLOSION) {
      if (hypotenuse <= Explosion.GRENADE_RADIUS + pad) return Explosion.CHARACTER_DAMAGE_3;
    } else if (this.type === Explosion.RPG_EXPLOSION) {
      if (hypotenuse <= Explosion.RADIUS_2 + pad) return Explosion.CHARACTER_DAMAGE_3;
    } else if (this.type === Explosion.ENEMY_EXPLOSION) {
      if (hypotenuse <= Explosion.ENEMY_RADIUS + pad) return Explosion.CHARACTER_DAMAGE_2;
    }
    return 0;
  }

  // Rockets and grenades caught in a blast go off too
  chainExplode(bullet) {
    const hypotenuse = Math.sqrt((bullet.x - this.x) ** 2 + (bullet.y - this.y) ** 2);
    if (this.type === Explosion.RPG_EXPLOSION) return hypotenuse <= Explosion.RADIUS_2;
    if (this.type === Explosion.GRENADE_EXPLOSION) return hypotenuse <= Explosion.GRENADE_RADIUS_2;
    return false;
  }
}

// ---------------------------------------------------------------------------
// Item (pickups dropped by enemies)
// ---------------------------------------------------------------------------
class Item {
  static ITEM_SIZE = 20;
  static MAX_TIME = 30; // seconds on the field

  constructor(enemyStat, numItemTypes, currentTime, level) {
    this.x = enemyStat[1];
    this.y = enemyStat[2];
    // better weapons unlock as the levels go up
    const num = Math.min(numItemTypes, trunc(level / 2) + 1);
    this.type = randInt(num);
    this.timeLastChecked = currentTime;
  }

  addTimer(currentTime) {
    return this.timeLastChecked + 1000 * Item.MAX_TIME <= currentTime;
  }
}

// ---------------------------------------------------------------------------
// Obstacle (trees)
// ---------------------------------------------------------------------------
class Obstacle {
  static SIZES = [30, 35, 40];

  constructor() {
    this.x = randInt(SCREEN_WIDTH - 60) + 30;
    this.y = randInt(SCREEN_HEIGHT - 60) + 30;
    this.width = this.height = Obstacle.SIZES[randInt(3)];
  }

  getXAsInt() {
    return trunc(this.x - half(this.width));
  }

  getYAsInt() {
    return trunc(this.y - half(this.height));
  }
}

// ---------------------------------------------------------------------------
// Crosshair (animates while firing, freezes otherwise)
// ---------------------------------------------------------------------------
class Crosshair {
  static OUTSIDE_FRAME_LENGTH = 5;
  static INSIDE_FRAME_LENGTH = 6;
  static INSIDE_LENGTH = Crosshair.INSIDE_FRAME_LENGTH * 180;
  static OUTSIDE_LENGTH = Crosshair.OUTSIDE_FRAME_LENGTH * 90;

  constructor(startTime) {
    this.startTimeOuter = startTime;
    this.startTimeInner = 0;
    this.previousCurrent = 0;
  }

  static frameFor(currentTime, start, frames, frameLength) {
    const time = Math.floor((currentTime - start) / 10);
    let tempNum = 0;
    for (let i = 0; i < frames; i++) {
      if (time - frameLength * i > 0) tempNum = i;
    }
    return tempNum;
  }

  getOuterFrame(currentTime) {
    return Crosshair.frameFor(currentTime, this.startTimeOuter, 9, Crosshair.OUTSIDE_FRAME_LENGTH);
  }

  getInnerFrame(currentTime) {
    return Crosshair.frameFor(currentTime, this.startTimeInner, 18, Crosshair.INSIDE_FRAME_LENGTH);
  }

  freeze(currentTime) {
    const diff = currentTime - this.previousCurrent;
    this.startTimeInner += diff;
    this.startTimeOuter += diff;
    this.previousCurrent = currentTime;
  }

  checkFrameTime(currentTime) {
    let time = Math.floor((currentTime - this.startTimeOuter) / 10);
    if (time - Crosshair.OUTSIDE_LENGTH / 10 > 0) this.startTimeOuter += Crosshair.OUTSIDE_LENGTH;
    time = Math.floor((currentTime - this.startTimeInner) / 10);
    if (time - Crosshair.INSIDE_LENGTH / 10 > 0) this.startTimeInner += Crosshair.INSIDE_LENGTH;
    this.previousCurrent = currentTime;
  }
}
