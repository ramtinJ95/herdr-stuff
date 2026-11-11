# herdr-stuff repo rules

Mods and whole-window layouts for the Herdr app. The app's own guide to mods, layouts and themes is `~/.config/herdr-app/AGENTS.md`: read it before changing one.

## A layout covers everything we open in it

A new layout, or a change to a layout's look, is not done until everything of ours that can show in it fits it. Open each of these in the layout and look at a screenshot:

- our window mods here: `mods/nexus` (Ctrl-f e) and `mods/tuido` (Ctrl-f t);
- our mods in dotfiles (`~/dotfiles/common-config/herdr-app/mods`): the navigation lists (Ctrl-f a / b) and the look picker (Ctrl-f r);
- Herdr's own that we use every day: find anything (Ctrl-f w), the command palette, the rename and confirm dialogs, toasts.

How they are made to fit:

- A mod that draws with `theme()` follows the layout's theme and `colors`. Set the panel colors on the layout root (`colors`) as well as in `themes/<name>.json`: settings.json's `colors` fill whatever a layout leaves unset, and dotfiles' terminal-chrome mod saves the work theme's panel colors there, so without them another layout's panels show in every window and dialog.
- Where a layout has materials of its own (cosy's cards), a popup of ours that a layout key opens is drawn in them by the layout's mod, which reads its rows with the owning mod's `model.js` instead of copying its logic (`mods/cosy/find.js`, `mods/cosy/install.sh`).
- A layout's own cards stand on the ground its dialogs do (a light card among dark dialogs reads as two apps); a look that is set aside is kept as a named, working alternative, as cosy's `paper` stock is in `mods/cosy/look.js`.
- The layout's README says what is left as Herdr's own.
