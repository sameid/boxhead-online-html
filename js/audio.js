// Sound. The applet's .wav effects (boxhead/Sounds/...) weren't in the project,
// so each effect slot is synthesized with Web Audio instead. Slot numbers match
// MainApplet.soundEffects[] so the gameplay code reads the same.
// Music uses the original soundtrack from the MUSIC folder.

'use strict';

const Sound = (() => {
  let ctx = null;
  let master = null;
  let noiseBuffer = null;
  let muted = false;
  const lastPlayed = {};

  // soundEffects[] slots in the original
  const SFX = {
    PISTOL: 0,
    MACHINE: 1,
    SHOTGUN: 2,
    MACHINE_EQUIP: 3,
    SHOTGUN_EQUIP: 4,
    HEALTH: 5,
    TURRET_EQUIP: 6,
    SNIPER_EQUIP: 7,
    SNIPER: 8,
    EXPLOSION: 9,
    GRENADE_THROW: 10,
    RPG: 11,
    GRENADE_EQUIP: 12,
    RPG_EQUIP: 13,
    FRAG_OUT: 14,
    GAS_EXPLOSION: 15,
  };

  function unlock() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.ratio.value = 6;
      comp.connect(ctx.destination);
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(comp);

      noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  function env(gainNode, t, attack, peak, decay) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(peak, t + attack);
    g.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  function noise({ t, dur, peak, type = 'lowpass', freq = 1000, freqEnd, q = 1, attack = 0.002 }) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    if (freqEnd) filter.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    filter.Q.value = q;
    const g = ctx.createGain();
    env(g, t, attack, peak, dur);
    src.connect(filter).connect(g).connect(master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + attack + dur + 0.05);
  }

  function tone({ t, dur, peak, type = 'sine', freq, freqEnd, attack = 0.003 }) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain();
    env(g, t, attack, peak, dur);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + attack + dur + 0.05);
  }

  function blips(t, freqs, step, type = 'square', peak = 0.12) {
    freqs.forEach((f, i) => tone({ t: t + i * step, dur: step * 1.4, peak, type, freq: f }));
  }

  const RECIPES = {
    [SFX.PISTOL]: (t) => {
      noise({ t, dur: 0.09, peak: 0.5, type: 'bandpass', freq: 1800, freqEnd: 500, q: 0.8 });
      tone({ t, dur: 0.08, peak: 0.35, freq: 180, freqEnd: 60 });
    },
    [SFX.MACHINE]: (t) => {
      noise({ t, dur: 0.05, peak: 0.28, type: 'bandpass', freq: 2200, freqEnd: 800, q: 1 });
      tone({ t, dur: 0.04, peak: 0.18, freq: 150, freqEnd: 70 });
    },
    [SFX.SHOTGUN]: (t) => {
      noise({ t, dur: 0.35, peak: 0.8, type: 'lowpass', freq: 3500, freqEnd: 200 });
      tone({ t, dur: 0.18, peak: 0.5, freq: 120, freqEnd: 40 });
      noise({ t: t + 0.4, dur: 0.05, peak: 0.15, type: 'highpass', freq: 3000 }); // pump
      noise({ t: t + 0.52, dur: 0.05, peak: 0.15, type: 'highpass', freq: 2500 });
    },
    [SFX.SNIPER]: (t) => {
      noise({ t, dur: 0.05, peak: 0.9, type: 'highpass', freq: 2500 });
      noise({ t, dur: 0.6, peak: 0.4, type: 'lowpass', freq: 2000, freqEnd: 120 });
      tone({ t, dur: 0.25, peak: 0.4, freq: 220, freqEnd: 45 });
    },
    [SFX.GRENADE_THROW]: (t) => {
      noise({ t, dur: 0.25, peak: 0.25, type: 'bandpass', freq: 600, freqEnd: 2400, q: 2, attack: 0.05 });
    },
    [SFX.RPG]: (t) => {
      noise({ t, dur: 0.45, peak: 0.45, type: 'bandpass', freq: 400, freqEnd: 3000, q: 1.2, attack: 0.02 });
      tone({ t, dur: 0.12, peak: 0.3, freq: 90, freqEnd: 50 });
    },
    [SFX.EXPLOSION]: (t) => {
      noise({ t, dur: 1.1, peak: 0.9, type: 'lowpass', freq: 2500, freqEnd: 80, attack: 0.005 });
      tone({ t, dur: 0.7, peak: 0.7, freq: 110, freqEnd: 30 });
    },
    [SFX.FRAG_OUT]: (t) => {
      noise({ t, dur: 0.9, peak: 0.85, type: 'lowpass', freq: 4000, freqEnd: 120, attack: 0.003 });
      tone({ t, dur: 0.5, peak: 0.6, freq: 140, freqEnd: 35 });
    },
    [SFX.GAS_EXPLOSION]: (t) => {
      noise({ t, dur: 0.8, peak: 0.7, type: 'bandpass', freq: 900, freqEnd: 150, q: 0.7, attack: 0.02 });
      tone({ t, dur: 0.5, peak: 0.35, type: 'triangle', freq: 70, freqEnd: 35 });
    },
    [SFX.HEALTH]: (t) => blips(t, [523, 659, 784, 1047], 0.07, 'triangle', 0.2),
    [SFX.MACHINE_EQUIP]: (t) => blips(t, [440, 880], 0.06),
    [SFX.SHOTGUN_EQUIP]: (t) => {
      noise({ t, dur: 0.05, peak: 0.25, type: 'highpass', freq: 2500 });
      noise({ t: t + 0.12, dur: 0.05, peak: 0.25, type: 'highpass', freq: 2000 });
    },
    [SFX.TURRET_EQUIP]: (t) => blips(t, [330, 330, 660], 0.05, 'square', 0.1),
    [SFX.SNIPER_EQUIP]: (t) => blips(t, [660, 990], 0.08, 'triangle', 0.18),
    [SFX.GRENADE_EQUIP]: (t) => blips(t, [392, 523], 0.07),
    [SFX.RPG_EQUIP]: (t) => blips(t, [262, 392, 523], 0.07),
  };

  // Keep rapid-fire sounds (uzi, turrets) from stacking into mush
  const MIN_GAP = { [SFX.MACHINE]: 0.045, [SFX.TURRET_EQUIP]: 0.04 };

  function play(slot) {
    if (!ctx || muted || !RECIPES[slot]) return;
    const t = ctx.currentTime;
    const gap = MIN_GAP[slot] || 0.02;
    if (lastPlayed[slot] !== undefined && t - lastPlayed[slot] < gap) return;
    lastPlayed[slot] = t;
    RECIPES[slot]?.(t + 0.005);
  }

  // MainApplet.shotSound
  function shotSlot(gunType) {
    if (gunType === PISTOL) return SFX.PISTOL;
    if (gunType === MACHINE) return SFX.MACHINE;
    if (gunType === SHOTGUN) return SFX.SHOTGUN;
    if (gunType === SNIPER) return SFX.SNIPER;
    if (gunType === TURRET || gunType === RPG_TURRET) return SFX.TURRET_EQUIP;
    if (gunType === GRENADE) return SFX.GRENADE_THROW;
    if (gunType === RPG) return SFX.RPG;
    return -1;
  }

  function pickupSlot(itemType) {
    if (itemType === HEALTH_PICKUP) return SFX.HEALTH;
    if (itemType === MACHINE) return SFX.MACHINE_EQUIP;
    if (itemType === SHOTGUN) return SFX.SHOTGUN_EQUIP;
    if (itemType === TURRET || itemType === RPG_TURRET) return SFX.TURRET_EQUIP;
    if (itemType === SNIPER) return SFX.SNIPER_EQUIP;
    if (itemType === GRENADE) return SFX.GRENADE_EQUIP;
    if (itemType === RPG) return SFX.RPG_EQUIP;
    return -1;
  }

  // ---- Music ------------------------------------------------------------
  const TRACKS = {
    menu: ['assets/music/start-clock.mp3'],
    game: ['assets/music/battle-theme-1.mp3', 'assets/music/battle-theme-2.mp3', 'assets/music/battle-theme-3.mp3'],
    gameOver: ['assets/music/i-won-and-died.mp3'],
  };
  const music = new Audio();
  music.volume = 0.45;
  let playlist = null;
  let trackIndex = 0;

  music.addEventListener('ended', () => {
    if (!playlist) return;
    trackIndex = (trackIndex + 1) % playlist.length;
    music.src = playlist[trackIndex];
    if (!muted) music.play().catch(() => {});
  });

  function playMusic(name) {
    const list = TRACKS[name];
    if (playlist === list) return;
    playlist = list;
    trackIndex = Math.floor(Math.random() * list.length);
    music.src = list[trackIndex];
    if (!muted) music.play().catch(() => {});
  }

  function resumeMusic() {
    if (!muted && playlist && music.paused) music.play().catch(() => {});
  }

  function setMuted(value) {
    muted = value;
    if (master) master.gain.value = muted ? 0 : 0.5;
    if (muted) music.pause();
    else resumeMusic();
    try {
      localStorage.setItem('boxhead.muted', muted ? '1' : '0');
    } catch (e) {}
  }

  try {
    muted = localStorage.getItem('boxhead.muted') === '1';
  } catch (e) {}

  return {
    SFX,
    unlock,
    play,
    shotSlot,
    pickupSlot,
    playMusic,
    resumeMusic,
    toggleMute: () => setMuted(!muted),
    isMuted: () => muted,
  };
})();
