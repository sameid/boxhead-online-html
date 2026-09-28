// Peer-to-peer connection between two players, replacing the applet's LAN
// sockets (Server/Client/NetworkThread). Uses WebRTC data channels via PeerJS;
// the public PeerJS broker is only used to exchange the connection handshake.
//
// A self-hosted broker (npx peer --port 9000) can be used instead by adding
// ?peerHost=localhost&peerPort=9000&peerSecure=0 to the page URL.

'use strict';

const Net = (() => {
  const PROTOCOL = 1;
  const PREFIX = `boxhead-p${PROTOCOL}-`;
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
  const CODE_LENGTH = 5;
  const CONNECT_TIMEOUT_MS = 15000;
  const HEARTBEAT_MS = 1000;
  const SILENCE_LIMIT_MS = 15000; // no traffic for this long = partner gone
  const MAX_BUFFERED = 256 * 1024;

  let peer = null;
  let conn = null;
  let handlers = {};
  let heartbeat = null;
  let lastHeard = 0;

  function peerOptions() {
    const q = new URLSearchParams(location.search);
    const opts = { debug: 0 };
    if (q.get('peerHost')) {
      opts.host = q.get('peerHost');
      opts.port = Number(q.get('peerPort') || 9000);
      opts.path = q.get('peerPath') || '/';
      opts.secure = q.get('peerSecure') === '1';
    }
    return opts;
  }

  function randomCode() {
    let code = '';
    const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
    for (const b of bytes) code += CODE_CHARS[b % CODE_CHARS.length];
    return code;
  }

  function normalizeCode(str) {
    return str.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);
  }

  function describeError(err) {
    switch (err && err.type) {
      case 'peer-unavailable':
        return 'NO GAME FOUND WITH THAT CODE';
      case 'browser-incompatible':
        return "THIS BROWSER DOESN'T SUPPORT ONLINE PLAY";
      case 'network':
      case 'server-error':
      case 'socket-error':
      case 'socket-closed':
        return 'COULD NOT REACH THE MATCHMAKING SERVER';
      default:
        return 'UNABLE TO JOIN GAME.';
    }
  }

  function attach(c) {
    conn = c;
    c.on('open', () => {
      lastHeard = performance.now();
      clearInterval(heartbeat);
      heartbeat = setInterval(() => {
        send({ t: 'ping' });
        if (performance.now() - lastHeard > SILENCE_LIMIT_MS) dropped();
      }, HEARTBEAT_MS);
      handlers.onOpen?.();
    });
    c.on('data', (msg) => {
      lastHeard = performance.now();
      if (msg && msg.t !== 'ping') handlers.onMessage?.(msg);
    });
    c.on('close', () => {
      if (conn === c) dropped();
    });
    c.on('error', () => {
      if (conn === c) dropped();
    });
  }

  function dropped() {
    const h = handlers;
    close();
    h.onClose?.();
  }

  // Resolves with the room code once registered with the broker
  function host(h) {
    close();
    handlers = h;
    return new Promise((resolve, reject) => {
      const tryCode = (attempt) => {
        const code = randomCode();
        const p = new Peer(PREFIX + code, peerOptions());
        peer = p;
        p.on('open', () => resolve(code));
        p.on('connection', (c) => {
          if (conn) {
            // Two-player game, like the original
            c.on('open', () => {
              c.send({ t: 'full' });
              setTimeout(() => c.close(), 500);
            });
            return;
          }
          attach(c);
        });
        p.on('disconnected', () => {
          // Lost the broker while waiting for a partner; established games don't need it
          if (!conn && peer === p && !p.destroyed) p.reconnect();
        });
        p.on('error', (err) => {
          if (peer !== p) return;
          if (err.type === 'unavailable-id' && attempt < 5) {
            p.destroy();
            tryCode(attempt + 1);
          } else if (!p.open) {
            close();
            reject(new Error(describeError(err)));
          }
        });
      };
      tryCode(0);
    });
  }

  // Resolves once the data channel to the host is open
  function join(code, h) {
    close();
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (message) => {
        if (settled) return;
        settled = true;
        close();
        reject(new Error(message));
      };
      handlers = {
        ...h,
        onOpen: () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          handlers = h;
          h.onOpen?.();
          resolve();
        },
        onClose: () => fail('UNABLE TO JOIN GAME.'),
      };
      const timer = setTimeout(() => fail('UNABLE TO JOIN GAME.'), CONNECT_TIMEOUT_MS);
      const p = new Peer(peerOptions());
      peer = p;
      p.on('open', () => attach(p.connect(PREFIX + normalizeCode(code), { reliable: true, serialization: 'json' })));
      p.on('error', (err) => {
        if (peer === p) fail(describeError(err));
      });
    });
  }

  function send(msg) {
    if (conn && conn.open) conn.send(msg);
  }

  // World snapshots are skipped rather than queued when the link falls behind
  function canSendState() {
    return !!(conn && conn.open && conn.dataChannel && conn.dataChannel.bufferedAmount < MAX_BUFFERED && !conn.bufferSize);
  }

  // Tell the partner we're going, give the message a moment to flush, then hang up
  function leave() {
    send({ t: 'bye' });
    handlers = {};
    clearInterval(heartbeat);
    const c = conn;
    const p = peer;
    conn = null;
    peer = null;
    setTimeout(() => {
      try {
        c?.close();
      } catch (e) {}
      try {
        p?.destroy();
      } catch (e) {}
    }, 250);
  }

  function close() {
    clearInterval(heartbeat);
    heartbeat = null;
    const c = conn;
    const p = peer;
    conn = null;
    peer = null;
    handlers = {};
    try {
      c?.close();
    } catch (e) {}
    try {
      p?.destroy();
    } catch (e) {}
  }

  return {
    PROTOCOL,
    CODE_LENGTH,
    CODE_CHARS,
    host,
    join,
    send,
    canSendState,
    leave,
    close,
    normalizeCode,
    get connected() {
      return !!(conn && conn.open);
    },
  };
})();
