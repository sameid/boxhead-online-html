# Boxhead (HTML5 canvas port)

A port of the 2012 Boxhead Online Java applet (`../boxheadonline`) to plain
JavaScript and `<canvas>`, using the original sprites, menu art, font and music.

## Running

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000   # then visit http://localhost:8000
```

## Multiplayer (2-player co-op)

The flow is the same as the original. Click **Multiplayer**, pick a temporary gamertag, then **Host** or **Join**.
The host gets a 5-letter room code (or clicks to copy an invite link). The other player
types the code in, or opens the link. The game starts two seconds after both are connected.

Rules are the same as the applet's LAN co-op:

- **Shared:** health and score (there's no revive).
- **Enemies:** chase whichever player is closer.
- **Weapons:** each player has their own, and picks up their own drops.
- **Pausing:** either player can pause, which pauses both.
- **Rematch:** after a game over, the host starts the next round.

**How it works:**

- **Connection:** the browsers connect peer-to-peer over WebRTC ([PeerJS](https://peerjs.com), vendored in
  `js/vendor/`). The free public PeerJS broker only exchanges the handshake; gameplay traffic goes directly
  between the two players (about 20–30 KB/s).
- **Simulation:** the host's browser runs the world (`Game` in host mode) and sends a snapshot every
  tick. The client moves its own character locally and sends its position plus any bullets or turrets it
  just fired (`ClientGame`). That's the same split as the applet's `ServerPacket`/`ClientPacket`.
- **Firewalls:** connections go straight between browsers without a relay (TURN) server. Players on the
  same network or ordinary home connections are fine, but some strict corporate or mobile networks
  can't connect directly.
- **Running your own broker:** start one with `npx peer --port 9000` and open the game with
  `?peerHost=localhost&peerPort=9000&peerSecure=0` (both players need the same parameters).

## Controls

| Input | Action |
| --- | --- |
| WASD / arrow keys | Move |
| Mouse (hold left button) | Aim and fire |
| Q / E, scroll wheel | Cycle weapons |
| 1–8 | Pick a weapon |
| Right click / middle click | Strongest / weakest weapon |
| Esc or P | Pause |
| M | Sound on/off |

## Layout

| File | Ported from |
| --- | --- |
| `js/net.js` | `Server`, `Client`, `NetworkThread` (now WebRTC via PeerJS) |
| `js/lobby.js` | Host/join screens and session handling in `checkOptions()` |
| `js/ui.js` | `CustomButton`, and a canvas text field in place of AWT `TextField` |
| `js/entities.js` | `Character`, `Enemy`, `Bullet`, `Weapon`, `Turret`, `Explosion`, `Item`, `Obstacle`, `Crosshair` |
| `js/collision.js` | `MainApplet.collisionDetection` (branch-for-branch) |
| `js/game.js` | `MainApplet.gameplay()` (solo and host), the client side of co-op, and the in-game half of `paint()` |
| `js/main.js` | Menus, input, and the `run()` loop (fixed 20ms tick, as in the applet) |
| `js/assets.js` | Image loading (same `boxhead/...` paths as the applet) |
| `js/audio.js` | Sound effects and music |

## Differences from the applet

- **Facebook login and friends are not included.** Multiplayer uses room codes
  instead of LAN discovery. `host.png` and `join.png` were edited into `hostCode.png`/`joinCode.png`
  to say "room code" instead of "IP address" and to drop the Refresh button.
- **Co-op fixes:** the applet re-created the client's bullets with the wrong constructor, which
  turned its grenades into sniper shots. The port hands them over intact. Sticky goo now slows the
  client as well as the host.
- **Sound effects are synthesized** with Web Audio, because the original
  `boxhead/Sounds/*.wav` files are not in the project. Music comes from the `MUSIC` folder (the applet had music disabled).
- **Button hover images** (`menubuttons/cursor/`) were also missing. Hovered buttons are lightened
  and play the original `buttoneffect1Sec.gif` sweep, pre-rendered to a sprite sheet.
- **Game over:** "Post to FB!" is now **Play Again**. The pause screen uses the
  previously unused `pause.png` panel with Resume/Return buttons.
- **High score and level reached** are saved in `localStorage` (they used to go to your online profile).
- **The game auto-pauses** when the window loses focus (solo), or when a player switches tabs (co-op;
  this pauses both players, because background tabs stop running the game).
