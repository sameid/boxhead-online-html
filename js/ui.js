// Shared UI pieces: buttons (CustomButton), the button hover sweep, text
// drawing and a canvas text field (the applet used AWT TextFields).

'use strict';

const FONT = "'BigNoodle', 'Impact', 'Arial Narrow', sans-serif";

function drawText(g, str, x, y, size, color = '#fff', align = 'left') {
  g.font = `${size}px ${FONT}`;
  g.fillStyle = color;
  g.textAlign = align;
  g.fillText(str, x, y);
  g.textAlign = 'left';
}

const EFFECT_FRAMES = 32;
const EFFECT_FRAME_MS = 31; // "buttoneffect1Sec": one sweep per second

function drawButtonEffect(g, x, y) {
  const sheet = IMG.buttonEffect;
  if (!sheet) return;
  const frame = Math.floor(performance.now() / EFFECT_FRAME_MS) % EFFECT_FRAMES;
  g.drawImage(sheet, frame * 250, 0, 250, 50, x, y, 250, 50);
}

class Button {
  // image: an IMG key, or null to draw a text button in the same style
  constructor(x, y, image, label) {
    this.x = x;
    this.y = y;
    this.width = 250;
    this.height = 50;
    this.image = image;
    this.label = label;
  }

  checkHover(mx, my) {
    return mx >= this.x && mx <= this.x + this.width && my >= this.y && my <= this.y + this.height;
  }

  draw(g, mx, my, { hover = true, alwaysAnimate = false, label = this.label } = {}) {
    if (this.image) {
      drawImg(g, IMG[this.image], this.x, this.y);
    } else {
      // Same look as the menubuttons/noCursor art: translucent black, 1px white edge
      g.fillStyle = 'rgba(0, 0, 0, 0.65)';
      g.fillRect(this.x, this.y, this.width, this.height);
      g.strokeStyle = 'rgba(254, 254, 254, 0.65)';
      g.lineWidth = 1;
      g.strokeRect(this.x + 0.5, this.y + 0.5, this.width - 1, this.height - 1);
      g.font = `34px ${FONT}`;
      let size = 34;
      while (size > 16 && g.measureText(label).width > this.width - 24) g.font = `${--size}px ${FONT}`;
      g.fillStyle = hover ? '#fff' : 'rgba(255, 255, 255, 0.6)';
      g.textAlign = 'center';
      g.fillText(label, this.x + this.width / 2, this.y + 25 + size * 0.35);
      g.textAlign = 'left';
    }
    const hovered = hover && this.checkHover(mx, my);
    if (hovered) {
      // The hover-state art (menubuttons/cursor/) wasn't in the project; lift
      // the button slightly and run the original sweep effect over it.
      g.fillStyle = 'rgba(255, 255, 255, 0.12)';
      g.fillRect(this.x, this.y, this.width, this.height);
    }
    if (hovered || alwaysAnimate) drawButtonEffect(g, this.x, this.y);
  }
}

// Single-line text entry drawn on the canvas
class TextField {
  constructor(x, y, width, height, { maxLength = 20, allowed = /^[\x20-\x7e]$/, transform = (s) => s } = {}) {
    Object.assign(this, { x, y, width, height, maxLength, allowed, transform });
    this.value = '';
  }

  insert(str) {
    for (const ch of this.transform(str)) {
      if (this.value.length >= this.maxLength) break;
      if (this.allowed.test(ch)) this.value += ch;
    }
  }

  // Returns true if the key was consumed
  handleKey(e) {
    if (e.key === 'Backspace') {
      this.value = this.value.slice(0, -1);
      return true;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      this.insert(e.key);
      return true;
    }
    return false;
  }

  draw(g, { size = 22, color = '#111', background = '#fff', align = 'left' } = {}) {
    if (background) {
      g.fillStyle = background;
      g.fillRect(this.x, this.y, this.width, this.height);
    }
    g.font = `${size}px ${FONT}`;
    g.fillStyle = color;
    g.textAlign = align;
    const baseline = this.y + this.height / 2 + size * 0.35;
    const tx = align === 'center' ? this.x + this.width / 2 : this.x + 6;
    g.fillText(this.value, tx, baseline);
    if (Math.floor(performance.now() / 500) % 2 === 0) {
      const w = g.measureText(this.value).width;
      const cx = align === 'center' ? tx + w / 2 + 2 : tx + w + 2;
      g.fillRect(cx, baseline - size * 0.72, 2, size * 0.8);
    }
    g.textAlign = 'left';
  }
}

async function copyText(str) {
  try {
    await navigator.clipboard.writeText(str);
    return true;
  } catch (e) {
    // file:// and older browsers: fall back to a hidden textarea
    const ta = document.createElement('textarea');
    ta.value = str;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (err) {}
    ta.remove();
    return ok;
  }
}
