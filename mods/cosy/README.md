# Cosy café

A whole-window layout for the Herdr app, built around one painting: a lofi winter café, evening, snow outside. You sit by the window. Everything on screen is something in that room.

- **The window** (the middle): your terminals are its glass. Each pane is one light of the window in a wooden frame, and behind the text is the snowy street: the lamp post, the bookshop across the road. A pane has no bar of its own, so the glass runs to the frame. The pane you're in has its lamp on: the others' glass is a shade of dusk darker, their text as bright as ever. What an agent is doing is on its cup and its tab's lamp; split, zoom and close are on the menu and its keys.
- **The beam** (top): a plank of the table's wood. Tabs hang from it as pendant lamps, and the lit one is the tab you're in. Click to go there, drag one onto another to move it, double-click to rename, right-click for its menu, scroll to step through them. On the left hangs the **Menu**; on the right are a new tab and find.
- **The bookshelf** (left): spaces are a stack of books, the one you're in pulled out. Under them every agent is a cup with its program's mark printed on it. It steams while the agent works, gets a note leaning on it when the agent needs you, a green mark when it finished while you were away, and stands empty while it rests. Cups that need you come first. Click one to go there. At the foot is the table with the bun and the lamp, and a string of fairy lights runs down the post beside it.
- **The menu card**: a café's menu on a walnut board, commands as dishes with their keys where the prices go. Right-clicking a book, a lamp or a cup opens a small card for it; the + on the beam opens one that starts a terminal or any agent installed here. A question comes on the same kind of card: naming a tab or a space from a card or a double-click, and the yes before a space is closed. Enter answers, Esc leaves it.
- **The lists**: Ctrl-f a lists every agent, Ctrl-f b this space's tabs and Ctrl-f r the looks, each on a card like the menu's. They are the navigation and appearance mods' lists (the same rows, order and keys: n / d jump to the next agent that needs you / is ready, w shows the ones brewing, / searches), drawn by this mod. Ctrl-f Tab goes back to where you were.
- **Notes**: notifications arrive as a small card of the same stock. Click one to go where it points. An agent that finished while you were away leaves no note: the green mark on its cup says so.

## Install

```sh
mods/cosy/install.sh                                # the mod, the layout, its theme
herdr-app do layout.switch --name cosy
```

Then merge `mods/cosy/keys.json` into `~/.config/herdr-app/keys.json` (Ctrl-f m opens the menu; Ctrl-f a / b / r open the lists and Ctrl-f Tab goes back), and bind a key to get back, for example `"layout:cosy": { "ctrl-shift-l": "layout.switch:main" }`.

`install.sh` copies the mod as a real folder, since the app hot-reloads real folders and not linked ones; run it again after a change. It also copies the navigation and appearance mods' `model.js` beside this mod when they are installed, because a mod can't import another mod's code and the lists are read with them. Without one the layout works, and its list (and, without navigation's, Ctrl-f Tab) says what is missing.

## The art

Every picture is cut from the wallpaper the layout is built around, by `art/make.sh <wallpaper>` (ImageMagick): the room out of focus behind everything, the street behind the glass, the shelf and the table, and one plank of the table top pulled out long for the beam (`wood.js` lays it from both ends, so it fits any width). The script expects that painting (1586x992); another one needs its crop boxes changed. The wallpaper is not in this repo, and its license is unknown to me: check it before publishing `art/`.

The cups, notes, bulbs and icons in `icons/` are drawn for this layout. Instrument Serif (`fonts/`) is by The Instrument Serif Project Authors, under the SIL Open Font License (`fonts/LICENSE-InstrumentSerif.txt`).

## The look

The layout brings its own theme, `themes/cosy.json`: espresso, cream and lamplight for the panels, and terminal colors picked from the painting (berries, ivy, lamp, dusk). The panel colors are also set on the layout itself (`colors` in `layouts/cosy.json`): settings.json's own `colors` fill whatever a layout leaves unset, so another layout's panel colors saved there would otherwise show in every window and dialog opened here (Nexus, the todos, find anything, Herdr's dialogs). Change a panel color in both places. The terminal's own background is transparent (`terminal_opacity: 0`), so the pane frame's tinted glass and the street show behind the text. The glass is walnut, not night blue: `art/make.sh` tones the street in the room's wood and amber, and a pane's `background` in `layouts/cosy.json` is the tint over it (`#2a1a10c2`: lower the last two digits to see more of the street, raise them for a flatter, darker terminal).

## The cards

Every card the mod draws (the menu, the lists, a question, a note) is cut from one stock, `CARD` in `look.js`. `board`, the one in use, is walnut lettered in cream and gilt on the ground Herdr's own dialogs stand on, so the café's cards, Herdr's dialogs and other mods' windows read as one set. `paper` is the first look, a cream printed menu in dark ink: it is kept whole to build on, and setting `CARD` to `"paper"` makes every card paper again. A new stock is one more entry in `STOCK` there.

## What moves

Only what tells you something: steam over the cups of working agents and the note on a cup that needs you. Each is a native loop, which redraws the window while it runs, so a café with nobody working is still.

## Not there yet

- Sub-agents without a pane get no cup.
- The command palette, find anything (the picker), the keys dialog, settings and the dialogs Herdr opens itself (a rename by its key, the yes before a busy tab or pane is closed) are Herdr's own, in the café's colors but not its materials.
