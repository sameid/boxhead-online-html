// Multiplayer lobby and session, following the applet's flow:
//   MULTIPLAYER -> (button grows to fill the screen) -> temp gamertag
//   -> host or join -> hosting (show room code) / join (enter room code)
//   -> "You are now connected with ..." -> 2s later the co-op game starts.
//
// Messages between the two browsers (JSON):
//   hello {nick, v}      both, once the channel opens
//   start {obstacles}    host -> client, begins a game (also used for rematches)
//   state {...}          host -> client every tick (the old ServerPacket)
//   input {...}          client -> host every tick (the old ClientPacket)
//   over {level, score}  host -> client when the shared health runs out
//   pause {v}            either way; pausing pauses both players
//   bye / full           leaving / game already has two players

'use strict';

const Lobby = (() => {
  const ANIM_MS = 450;

  const nickField = new TextField(518, 316, 200, 25, { maxLength: 20 });
  const codeField = new TextField(316, 241, 384, 80, {
    maxLength: Net.CODE_LENGTH,
    allowed: /^[A-Z0-9]$/,
    transform: (s) => s.toUpperCase(),
  });

  const buttons = {
    join: new Button(243, 300, 'btnJoin'),
    host: new Button(528, 300, 'btnHost'),
    choiceReturn: new Button(358, 375, 'btnReturn'),
    hostReturn: new Button(568, 320, 'btnReturn'),
    joinGo: new Button(93, 516, 'btnJoin'),
    joinReturn: new Button(678, 516, 'btnReturn'),
  };

  const session = {
    role: null, // 'host' | 'client' while connected or connecting
    code: null,
    nick: '',
    partner: null,
    names: null,
    startTimer: null,
    pendingJoinCode: null,
    copiedAt: -Infinity,
    animStart: 0,
  };

  try {
    nickField.value = localStorage.getItem('boxhead.nick') || '';
  } catch (e) {}

  const inviteMatch = location.hash.match(/join=([A-Za-z0-9]+)/);
  if (inviteMatch) {
    session.pendingJoinCode = Net.normalizeCode(inviteMatch[1]);
    history.replaceState(null, '', location.pathname + location.search);
  }

  const isLobbyScreen = (s) => s.startsWith('mp');

  function activeField() {
    if (app.popup) return null;
    if (app.screen === 'mpNick') return nickField;
    if (app.screen === 'mpJoin') return codeField;
    return null;
  }

  function inviteLink(code) {
    return `${location.href.split('#')[0]}#join=${code}`;
  }

  // ---- flow ---------------------------------------------------------------

  function open() {
    app.screen = 'mpAnim';
    session.animStart = performance.now();
  }

  function afterBoot() {
    // Opened from an invite link: straight to the gamertag screen
    if (session.pendingJoinCode) app.screen = 'mpNick';
  }

  function submitNick() {
    const nick = nickField.value.trim();
    if (nick.length < 6 || nick.length > 20) {
      app.popup = 'GAMERTAG MUST BE AT LEAST 6 CHARACTERS.';
      return;
    }
    session.nick = nick;
    try {
      localStorage.setItem('boxhead.nick', nick);
    } catch (e) {}
    if (session.pendingJoinCode) {
      codeField.value = session.pendingJoinCode;
      session.pendingJoinCode = null;
      app.screen = 'mpJoin';
    } else {
      app.screen = 'mpChoice';
    }
  }

  async function startHosting() {
    session.role = 'host';
    session.code = null;
    app.screen = 'mpHosting';
    try {
      const code = await Net.host(netHandlers());
      if (session.role === 'host' && app.screen === 'mpHosting') session.code = code;
    } catch (err) {
      if (session.role !== 'host') return;
      reset();
      app.screen = 'mpChoice';
      app.popup = err.message;
    }
  }

  async function joinGame() {
    const code = Net.normalizeCode(codeField.value);
    if (code.length !== Net.CODE_LENGTH) {
      app.popup = 'ENTER THE 5-LETTER ROOM CODE.';
      return;
    }
    session.role = 'client';
    session.code = code;
    app.screen = 'mpConnecting';
    try {
      await Net.join(code, netHandlers());
    } catch (err) {
      if (session.role !== 'client' || app.screen !== 'mpConnecting') return; // cancelled
      reset();
      app.screen = 'mpJoin';
      app.popup = err.message;
    }
  }

  function netHandlers() {
    return {
      onOpen: () => Net.send({ t: 'hello', nick: session.nick, v: Net.PROTOCOL }),
      onMessage,
      onClose: () => partnerLeft('YOUR PARTNER LEFT THE GAME'),
    };
  }

  function onMessage(msg) {
    const game = app.game;
    switch (msg.t) {
      case 'hello':
        if (msg.v !== Net.PROTOCOL) {
          partnerLeft("YOUR PARTNER'S GAME IS A DIFFERENT VERSION");
          return;
        }
        session.partner = String(msg.nick).slice(0, 20);
        session.names = session.role === 'host' ? { host: session.nick, client: session.partner } : { host: session.partner, client: session.nick };
        app.screen = 'mpConnected';
        if (session.role === 'host') {
          // The applet sat on this screen for delay(2000) before starting
          session.startTimer = setTimeout(startHostGame, 2000);
        }
        break;
      case 'full':
        partnerLeft('THAT GAME ALREADY HAS TWO PLAYERS');
        break;
      case 'start':
        if (session.role === 'client') startClientGame(msg);
        break;
      case 'state':
        if (game instanceof ClientGame && app.screen === 'game') game.applySnapshot(msg);
        break;
      case 'input':
        if (game instanceof Game && game.multiplayer && app.screen === 'game') game.onClientInput(msg);
        break;
      case 'over':
        if (game instanceof ClientGame && app.screen === 'game') {
          game.hp = Math.min(game.hp, 0);
          game.level = msg.level;
          game.currentScore = msg.score;
        }
        break;
      case 'pause':
        if (app.screen === 'game') setPaused(!!msg.v, true);
        break;
      case 'bye':
        partnerLeft('YOUR PARTNER LEFT THE GAME');
        break;
    }
  }

  function startHostGame() {
    session.startTimer = null;
    if (session.role !== 'host' || !Net.connected) return;
    const game = new Game({ mode: 'host', names: session.names });
    Net.send(game.startMessage());
    beginGame(game);
  }

  function startClientGame(msg) {
    beginGame(new ClientGame(msg, session.names));
  }

  // Called by the main loop after each tick
  function afterTick(game) {
    if (game instanceof ClientGame) return;
    if (Net.canSendState()) Net.send(game.takeSnapshot());
    if (game.isOver) Net.send({ t: 'over', level: game.level, score: game.currentScore });
  }

  function reset() {
    clearTimeout(session.startTimer);
    session.startTimer = null;
    session.role = null;
    session.code = null;
    session.partner = null;
  }

  // We chose to go
  function leave() {
    Net.leave();
    reset();
  }

  function partnerLeft(message) {
    if (!session.role) return;
    Net.close();
    const wasConnecting = app.screen === 'mpConnecting';
    reset();
    if (wasConnecting) {
      app.screen = 'mpJoin';
    } else {
      returnToMenu();
    }
    app.popup = message;
  }

  function back() {
    switch (app.screen) {
      case 'mpNick':
      case 'mpChoice':
        app.screen = 'menu';
        break;
      case 'mpHosting':
        leave();
        app.screen = 'mpChoice';
        break;
      case 'mpJoin':
        app.screen = 'mpChoice';
        break;
      case 'mpConnecting':
        leave();
        app.screen = 'mpJoin';
        break;
      case 'mpConnected':
        leave();
        app.screen = 'menu';
        break;
    }
  }

  // ---- input --------------------------------------------------------------

  function handleClick(mx, my) {
    switch (app.screen) {
      case 'mpChoice':
        if (buttons.host.checkHover(mx, my)) startHosting();
        else if (buttons.join.checkHover(mx, my)) app.screen = 'mpJoin';
        else if (buttons.choiceReturn.checkHover(mx, my)) back();
        break;
      case 'mpHosting':
        if (buttons.hostReturn.checkHover(mx, my)) back();
        else if (session.code && mx >= 183 && mx <= 700 && my >= 330 && my <= 372) {
          copyText(inviteLink(session.code)).then((ok) => ok && (session.copiedAt = performance.now()));
        }
        break;
      case 'mpJoin':
        if (buttons.joinGo.checkHover(mx, my)) joinGame();
        else if (buttons.joinReturn.checkHover(mx, my)) back();
        break;
    }
  }

  // Returns true if the key was handled
  function handleKey(e) {
    if (!isLobbyScreen(app.screen) || app.popup) return false;
    if (e.code === 'Escape') {
      back();
      return true;
    }
    if (e.code === 'Enter') {
      if (app.screen === 'mpNick') submitNick();
      else if (app.screen === 'mpJoin') joinGame();
      return true;
    }
    const field = activeField();
    if (field && field.handleKey(e)) {
      e.preventDefault();
      return true;
    }
    return false;
  }

  function handlePaste(text) {
    const field = activeField();
    if (!field) return;
    // Pasting a whole invite link works too
    const m = text.match(/join=([A-Za-z0-9]+)/);
    field.insert(field === codeField && m ? m[1] : text.trim());
  }

  // ---- drawing ------------------------------------------------------------

  function drawVeil(ctx) {
    drawImg(ctx, IMG.blank, 0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
  }

  // The MULTIPLAYER button slides to the corner, then stretches over the menu
  function drawAnim(ctx) {
    const t = performance.now() - session.animStart;
    const ease = (v) => Math.min(1, Math.max(0, v)) ** 2;
    const p1 = ease(t / (ANIM_MS / 3));
    const p2 = ease((t - ANIM_MS / 3) / (ANIM_MS / 3));
    const p3 = ease((t - (2 * ANIM_MS) / 3) / (ANIM_MS / 3));
    const x = 95 * (1 - p1);
    const y = 245 * (1 - p1);
    const w = 250 + (SCREEN_WIDTH - 250) * p2;
    const h = 50 + (SCREEN_HEIGHT - 50) * p3;
    drawImg(ctx, IMG.blank, x, y, w, h);
    if (t >= ANIM_MS) app.screen = 'mpNick';
  }

  function draw(ctx, mx, my) {
    const interactive = !app.popup;
    const opts = { hover: interactive };
    if (app.screen === 'mpConnecting') {
      drawImg(ctx, IMG.loader, 0, 0);
      drawText(ctx, `CONNECTING TO ${session.code}...   ESC TO CANCEL`, SCREEN_WIDTH / 2, 400, 24, 'rgba(255,255,255,0.8)', 'center');
      return;
    }

    drawMenuBase(mx, my, false);
    switch (app.screen) {
      case 'mpAnim':
        drawAnim(ctx);
        break;
      case 'mpNick':
        drawVeil(ctx);
        drawImg(ctx, IMG.tg, 258, 281);
        nickField.draw(ctx);
        drawText(ctx, 'PRESS ENTER TO CONTINUE', 283, 368, 20, 'rgba(255,255,255,0.7)');
        break;
      case 'mpChoice':
        drawVeil(ctx);
        drawImg(ctx, IMG.hostorjoin, 158, 200);
        buttons.join.draw(ctx, mx, my, opts);
        buttons.host.draw(ctx, mx, my, opts);
        buttons.choiceReturn.draw(ctx, mx, my, opts);
        drawText(ctx, `PLAYING AS ${session.nick}`, 158 + 350, 480, 24, 'rgba(255,255,255,0.75)', 'center');
        break;
      case 'mpHosting': {
        drawImg(ctx, IMG.hostCode, 158, 150);
        if (session.code) {
          drawText(ctx, session.code, 158 + 325, 150 + 125, 52);
          const copied = performance.now() - session.copiedAt < 2000;
          const hot = interactive && mx >= 183 && mx <= 700 && my >= 330 && my <= 372;
          drawText(ctx, copied ? 'INVITE LINK COPIED!' : 'CLICK TO COPY AN INVITE LINK', 189, 358, 24, hot || copied ? '#fff' : 'rgba(255,255,255,0.65)');
          if (hot && !copied) {
            ctx.fillStyle = '#fff';
            ctx.fillRect(189, 362, ctx.measureText('CLICK TO COPY AN INVITE LINK').width, 1);
          }
        } else {
          const dots = '.'.repeat(1 + (Math.floor(performance.now() / 400) % 3));
          drawText(ctx, dots, 158 + 325, 150 + 125, 52);
        }
        buttons.hostReturn.draw(ctx, mx, my, opts);
        break;
      }
      case 'mpJoin':
        drawImg(ctx, IMG.joinCode, 58, 81);
        drawJoinForm(ctx);
        buttons.joinGo.draw(ctx, mx, my, opts);
        buttons.joinReturn.draw(ctx, mx, my, opts);
        break;
      case 'mpConnected':
        drawImg(ctx, IMG.connected, 158, 150);
        drawText(ctx, session.partner || '', 158 + 300, 150 + 125, 52);
        break;
    }
  }

  function drawJoinForm(ctx) {
    drawText(ctx, "ENTER YOUR PARTNER'S ROOM CODE", 125, 189, 24);
    const value = codeField.value;
    const box = 64;
    const gap = 16;
    const x0 = SCREEN_WIDTH / 2 - (Net.CODE_LENGTH * box + (Net.CODE_LENGTH - 1) * gap) / 2;
    const blink = Math.floor(performance.now() / 500) % 2 === 0;
    for (let i = 0; i < Net.CODE_LENGTH; i++) {
      const x = x0 + i * (box + gap);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.fillRect(x, 241, box, 80);
      ctx.strokeStyle = i === value.length ? '#fff' : 'rgba(255, 255, 255, 0.45)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, 241.5, box - 1, 79);
      if (value[i]) drawText(ctx, value[i], x + box / 2, 303, 60, '#fff', 'center');
      else if (i === value.length && blink && !app.popup) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(x + 16, 306, box - 32, 3);
      }
    }
    drawText(ctx, 'OR JUST OPEN THE INVITE LINK THEY SENT YOU', 125, 429, 20, 'rgba(255,255,255,0.6)');
  }

  return {
    session,
    isLobbyScreen,
    open,
    afterBoot,
    draw,
    handleClick,
    handleKey,
    handlePaste,
    afterTick,
    leave,
    startHostGame,
    get active() {
      return !!session.role;
    },
    get role() {
      return session.role;
    },
  };
})();
