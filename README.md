# herdr-stuff

Mods for the [Herdr app](https://herdr.dev), one folder each under `mods/`.

| Mod | What it does |
| --- | --- |
| [nexus](mods/nexus) | Nexus threads beside your terminals: what waits on you, live conversations, answering questions, reviews and landing, pipeline items, the cluster and usage |
| [cabin](mods/cabin) | A whole-window winter cabin café layout (`layouts/cabin.json`): agents as pixel pets on a rug by the fire, spaces on a chalkboard, panes as wooden windows, a counter of tabs below; every color from your theme |
| [cosy](mods/cosy) | A whole-window lofi café layout (`layouts/cosy.json`) cut from one painting: terminals as the window onto a snowy street, tabs as pendant lamps, spaces as a stack of books with the agents as cups under them, a paper menu card with keys as prices |
| [tuido](mods/tuido) | Your tuido todo lists in a floating window: complete, add, open in your editor, sort, archive and sync |

## Install

Clone the repo and link a mod into the app's mods:

```sh
git clone https://github.com/ramtinJ95/herdr-stuff.git
ln -s "$PWD/herdr-stuff/mods/<mod>" ~/.config/herdr-app/mods/<mod>
```

A mod's `keys.json` holds the keys it expects; merge its sections into `~/.config/herdr-app/keys.json`, keeping any key you already use. A `git pull` updates it. The app does not hot-reload a linked mod, so close and reopen it after a change.

## Develop

Check a mod with `herdr-app check mods/<mod>`, and run every mod's tests with `npm test`. To add a mod, create `mods/<mod>/` with its `mod.json` and `main.js`, and list it in the table above.
