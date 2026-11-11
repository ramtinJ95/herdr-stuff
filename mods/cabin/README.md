# Cabin café

A whole-window layout for the Herdr app: a winter cabin café by the fire.

- **Beam** (top): the sign, where you are, find / fold / settings, the window's buttons; bunting and string lights.
- **Wall** (left): today's spaces on a chalkboard (key, name, branch, tabs, agents); a window onto a snowy night (moon, stars, a lit cabin in the pines, two layers of falling snow) with a candle; the fire; the den, a woven kilim the pets sit on.
- **Den**: every agent is a pixel pet on the rug. It spawns as one of six species (fox, cat, owl, penguin, bunny, bear) with its own fur and name, kept for that agent. Its scarf is its status color, and it acts the status out: napping, busy, hopping with a `!` (needs you), a pleased `✓` (done). Click: go there; right-click: the pane menu.
- **Windows**: panes in wooden frames (lit when focused); each title bar is a beam with snow lying on it: pet, a nameplate (program, folder, branch), a tag when its agent needs you or is done, split / zoom / close knobs.
- **Counter** (bottom): the beam's twin. MENU (every everyday command, with keys); tabs as wooden buttons with their key and a status dot (drag to reorder, double-click to rename); new tab, Files, Changes; the agents' news and the clock.
- **No popups**: every notification, Herdr's own included, closes as it opens. The den, board and counter already show what agents are doing, and the sounds still play.

Every color is mixed from the current theme (`palette.js`). Layout files can only name theme colors, so `tailor.js` writes the frame colors into the shown layout and paints the back wall as `backgrounds/cabin-wall-<hash>.svg` at the window's size (so its planks line up behind every panel) whenever the theme or the window size changes. It changes only those fields: sizes and panels stay as you left them.

## Install

```sh
cp layouts/cabin.json ~/.config/herdr-app/layouts/cabin.json   # a copy: the mod rewrites its look
mods/cabin/dev-sync.sh                                         # the mod, as a real folder
python3 ~/dotfiles/scripts/herdr-mod-keys.py ~/.config/herdr-app/keys.json mods/cabin/keys.json
herdr-app do layout.switch --name cabin
```

`dev-sync.sh` copies the mod rather than linking it: the app hot-reloads a real folder, not a linked one. Run it after each change. It also copies dotfiles' navigation model beside the counter, which hosts Ctrl-f navigation here (`keys.json`: `layout:cabin` sends Ctrl-f b / a / Tab / m to `cabin.tabs`, `cabin.agents`, `cabin.back`, `cabin.motion`). Without it the café works, and Ctrl-f Tab does nothing (the app log says why).

The layout mounts `terminal-chrome` like `main-personal` does. `gallery` is a mod pane with every pet in every fur and status:

```sh
herdr-app do pane.split --direction right --mod cabin --props '{"role":"gallery"}'
```

Silkscreen (`fonts/`) is by The Silkscreen Project Authors, under the SIL Open Font License (`fonts/LICENSE-Silkscreen.txt`).

The snow on the beams and sill (`snow/*.svg`) and the rug's weave (`rug/*.svg`) are one-color layers tinted from the theme at runtime; `snow/gen.mjs` and `rug/gen.mjs` draw them (`node mods/cabin/snow/gen.mjs mods/cabin/snow`).

## Motion

Every animation frame redraws the whole window, terminals included, so how much the café moves is its CPU knob. Pick it on the MENU (**Motion**, under THE HOUSE: each order steps to the next) or press Ctrl-f m. It's kept in shared `cabin.motion`:

| Motion | Window and fire | Pets and lights | Board steam | herdr-app CPU (one machine) |
| --- | --- | --- | --- | --- |
| still | — | — | — | 12% |
| light | 4 fps | 2 | 1 | 24% |
| cosy (default) | 8 | 4 | 2 | 31–33% |
| smooth | 12 | 6 | 3 | 42% |

The levels live in `kit.js` (`MOTIONS`); add one there to get it on the MENU. Animations are timed in seconds, so any rate works; a scene rate divisible by 4 keeps every view's beat on the scene's frames.

## Keeping it light

Measured on one machine (herdr-app's CPU, one core = 100%): at cosy the café went from about 82% to about 31%; the main layout sits near 17% with the same terminals. What made the difference:

- No native `loop` / `transition`: while one runs, the whole window (terminals too) redraws about 30 times a second. Everything moves in steps on `kit.beat` instead, at shares of the motion's rate lined up with the wall clock so they share frames. Nothing ticks while the window isn't focused.
- Sprites are one-color SVG layers per role (`pixel.js` writes them once to `data/cabin/sprites`), a handful of elements each instead of a div per run; the string of lights is seven grouped sprites.
- Large art is an `image()` (rasterized once): a big `svg()` is redrawn every frame. The rug's lattice is the one case.
