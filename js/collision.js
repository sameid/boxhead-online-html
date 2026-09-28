// Port of MainApplet.collisionDetection.
//
// Checks whether a moving object (Enemy, Character or Bullet) overlaps a
// stationary one once its pending move is applied. Which axis is blocked
// depends on where the other object sits and the direction of travel, so this
// is kept branch-for-branch identical to the Java original.
//
// Returns [collided, hitTopOrBottom]. For enemies/characters the blocked axis
// of movement is zeroed as a side effect.

'use strict';

function collisionDetection(movingObject, stationaryObject) {
  const temp = [false, false];

  let enemy1 = null;
  let character1 = null;
  let bullet = null;
  let item = null;

  let currentX = 0, currentY = 0, currentMoveX = 0, currentMoveY = 0, currentDirection = 0;
  let currentWidth = 0, currentHeight = 0;
  let comparedX = 0, comparedY = 0, comparedWidth = 0, comparedHeight = 0;

  if (movingObject instanceof Enemy) {
    enemy1 = movingObject;
    currentX = enemy1.x;
    currentY = enemy1.y;
    currentDirection = enemy1.direction;
    currentMoveX = enemy1.moveX;
    currentMoveY = enemy1.moveY;
    currentWidth = enemy1.getWidth();
    currentHeight = enemy1.getHeight();
  } else if (movingObject instanceof Character) {
    character1 = movingObject;
    currentX = character1.x;
    currentY = character1.y;
    currentMoveX = character1.speedX;
    currentMoveY = character1.speedY;
    currentWidth = CHAR_SIZE;
    currentHeight = CHAR_SIZE;

    const dirRad = toRadians(character1.direction);
    if (dirRad <= Math.PI) currentDirection = (3 * Math.PI) / 2 - dirRad;
    else if (dirRad < (3 * Math.PI) / 2) currentDirection = dirRad - Math.PI;
    else currentDirection = 2 * Math.PI - (dirRad - (3 * Math.PI) / 2);
    if (dirRad >= 2 * Math.PI) currentDirection = character1.direction - 2 * Math.PI;
  } else if (movingObject instanceof Bullet) {
    bullet = movingObject;
    currentX = bullet.x;
    currentY = bullet.y;
    // direction conversion from joystick
    const d = bullet.direction;
    if (d <= Math.PI) currentDirection = (3 * Math.PI) / 2 - d;
    else if (d < (3 * Math.PI) / 2) currentDirection = d - Math.PI;
    else currentDirection = 2 * Math.PI - (d - (3 * Math.PI) / 2);
    if (d >= 2 * Math.PI) currentDirection = d - 2 * Math.PI;
    currentWidth = bullet.getSize();
    currentHeight = bullet.getSize();
  }

  if (stationaryObject instanceof Enemy) {
    comparedX = stationaryObject.x;
    comparedY = stationaryObject.y;
    comparedWidth = stationaryObject.getWidth();
    comparedHeight = stationaryObject.getHeight();
  } else if (stationaryObject instanceof Character) {
    comparedX = stationaryObject.x;
    comparedY = stationaryObject.y;
    comparedWidth = CHAR_SIZE;
    comparedHeight = CHAR_SIZE;
  } else if (stationaryObject instanceof Obstacle) {
    comparedX = stationaryObject.x;
    comparedY = stationaryObject.y;
    comparedWidth = stationaryObject.width;
    comparedHeight = stationaryObject.height;
  } else if (stationaryObject instanceof Item) {
    item = stationaryObject;
    comparedX = item.x;
    comparedY = item.y;
    comparedWidth = Item.ITEM_SIZE;
    comparedHeight = Item.ITEM_SIZE;
  } else if (stationaryObject instanceof Turret) {
    comparedX = stationaryObject.x;
    comparedY = stationaryObject.y;
    comparedWidth = Turret.SIZE;
    comparedHeight = Turret.SIZE;
  }

  // Java int division on the sizes
  const cw = half(currentWidth);
  const ch = half(currentHeight);
  const ow = half(comparedWidth);
  const oh = half(comparedHeight);

  const PI = Math.PI;
  let scenario = 0; // 1 = blocked horizontally, 2 = blocked vertically
  let allow = false;

  if (comparedX >= currentX && comparedY <= currentY) {
    // compared object is right and above
    const hit = currentX + cw + currentMoveX >= comparedX - ow && currentY - ch - currentMoveY <= comparedY + oh;
    if (currentDirection <= PI) {
      if (hit) { allow = true; scenario = 1; }
    } else if (currentDirection <= (3 * PI) / 2) {
      if (hit) {
        allow = true;
        scenario = currentX + cw + currentMoveX - (comparedX - ow) > comparedY + oh - (currentY - ch - currentMoveY) ? 2 : 1;
      }
    } else if (currentDirection <= 2 * PI) {
      if (hit) { allow = true; scenario = 2; }
    }
  } else if (comparedX < currentX && comparedY > currentY) {
    // compared object is left and below
    const hit = currentX - cw + currentMoveX <= comparedX + ow && currentY + ch - currentMoveY >= comparedY - oh;
    if (currentDirection <= PI / 2) {
      if (hit) {
        allow = true;
        scenario = comparedX + ow - (currentX - cw + currentMoveX) > currentY + ch - currentMoveY - (comparedY - oh) ? 2 : 1;
      }
    } else if (currentDirection <= PI) {
      if (hit) { allow = true; scenario = 2; }
    } else if (currentDirection <= 2 * PI) {
      if (hit) { allow = true; scenario = 1; }
    }
  } else if (comparedX < currentX && comparedY < currentY) {
    // compared object is left and above
    const hit = currentX - cw + currentMoveX <= comparedX + ow && currentY - ch - currentMoveY <= comparedY + oh;
    if (currentDirection <= PI / 2) {
      if (hit) { allow = true; scenario = 1; }
    } else if (currentDirection <= (3 * PI) / 2) {
      if (hit) { allow = true; scenario = 2; }
    } else if (currentDirection <= 2 * PI) {
      if (hit) {
        allow = true;
        scenario = comparedX + ow - (currentX - cw + currentMoveX) > comparedY + oh - (currentY - ch - currentMoveY) ? 2 : 1;
      }
    }
  } else if (comparedX > currentX && comparedY > currentY) {
    // compared object is right and below
    const hit = currentX + cw + currentMoveX >= comparedX - ow && currentY + ch - currentMoveY >= comparedY - oh;
    if (currentDirection <= PI / 2) {
      if (hit) { allow = true; scenario = 2; }
    } else if (currentDirection <= PI) {
      if (hit) {
        allow = true;
        scenario = currentX + cw + currentMoveX - (comparedX - ow) > currentY + ch - currentMoveY - (comparedY - oh) ? 2 : 1;
      }
    } else if (currentDirection <= (3 * PI) / 2) {
      if (hit) { allow = true; scenario = 1; }
    }
  }

  if (allow) {
    const blocks = item === null && bullet === null;
    if (scenario === 1) {
      temp[1] = false;
      if (blocks) {
        if (enemy1) enemy1.moveX = 0;
        else if (character1) character1.speedX = 0;
      }
    } else if (scenario === 2) {
      temp[1] = true;
      if (blocks) {
        if (enemy1) enemy1.moveY = 0;
        else if (character1) character1.speedY = 0;
      }
    }
  }
  temp[0] = allow;
  return temp;
}
