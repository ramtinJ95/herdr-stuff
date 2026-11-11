# Cosy café

A whole-window layout for the Herdr app, built around one painting: a lofi winter café, evening, snow outside. You sit by the window. Everything on screen is something in that room.

- **The window** (the middle): your terminals are its glass. Each pane is one light of the window in a wooden frame, and behind the text is the snowy street: the lamp post, the bookshop across the road. A pane's top rail names its program, folder and branch, says what its agent is doing, and on hover has knobs to split, zoom and close.
- **The beam** (top): tabs hang from it as pendant lamps, and the lit one is the tab you're in. Click to go there, drag one onto another to move it, double-click to rename, right-click for its menu, scroll to step through them. On the left hangs the **Menu**; on the right are a new tab and find.
- **The bookshelf** (left): spaces are a stack of books, the one you're in pulled out. Under them every agent is a cup. It steams while the agent works, gets a note leaning on it when the agent needs you, a green mark when it finished while you were away, and stands empty while it rests. Cups that need you come first. Click one to go there. At the foot is the table with the bun and the lamp, and a string of fairy lights runs down the post beside it.
- **The menu card**: a paper menu, commands as dishes with their keys where the prices go. Right-clicking a book, a lamp, a pane or a cup opens a small card for it; the + on the beam opens one that starts a terminal or any agent installed here.
- **Notes**: notifications arrive as a paper note. Click one to go where it points. An agent that finished while you were away leaves no note: the green mark on its cup says so.

## Install

```sh
mods/cosy/install.sh                                # the mod, the layout, its theme
herdr-app do layout.switch --name cosy
```

Then merge `mods/cosy/keys.json` into `~/.config/herdr-app/keys.json` (Ctrl-f m opens the menu; Ctrl-f b / a / Tab go to the navigation mod), and bind a key to get back, for example `"layout:cosy": { "ctrl-shift-l": "layout.switch:main" }`.

`install.sh` copies the mod as a real folder, since the app hot-reloads real folders and not linked ones; run it again after a change. It also copies the navigation mod's `controller.js` and `model.js` beside the beam when that mod is installed, because a mod can't import another mod's code. Without them the layout works and Ctrl-f b / a / Tab do nothing.

## The art

Every picture is cut from the wallpaper the layout is built around, by `art/make.sh <wallpaper>` (ImageMagick): the room out of focus behind everything, the street behind the glass, the shelf and the table. The script expects that painting (1586x992); another one needs its crop boxes changed. The wallpaper is not in this repo, and its license is unknown to me: check it before publishing `art/`.

The cups, notes, bulbs and icons in `icons/` are drawn for this layout. Instrument Serif (`fonts/`) is by The Instrument Serif Project Authors, under the SIL Open Font License (`fonts/LICENSE-InstrumentSerif.txt`).

## The look

The layout brings its own theme, `themes/cosy.json`: espresso, cream and lamplight for the panels, and terminal colors picked from the painting (berries, ivy, lamp, dusk). The terminal's own background is transparent (`terminal_opacity: 0`), so the pane frame's tinted glass and the street show behind the text. The glass is walnut, not night blue: `art/make.sh` tones the street in the room's wood and amber, and a pane's `background` in `layouts/cosy.json` is the tint over it (`#2a1a10c2`: lower the last two digits to see more of the street, raise them for a flatter, darker terminal).

## What moves

Only what tells you something: steam over the cups of working agents, the note on a cup that needs you and the dot in a pane's status tag. Each is a native loop, which redraws the window while it runs, so a café with nobody working is still.

## Not there yet

- Sub-agents without a pane get no cup.
- Dialogs (rename, confirm), the command palette and settings are Herdr's own, in the café's colors but not its materials.
