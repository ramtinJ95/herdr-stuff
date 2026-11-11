// What the café is made of: its wood, brass, paper and lamplight, its one
// display face, and the few helpers every part shares. The art is cut from
// one painting (art/make.sh), so the materials are that painting's colors;
// text and status colors come from the layout's theme (themes/cosy.json).

import { div } from "gpui-kit";
import { theme, keys } from "herdr";
import { keyLabel } from "./util.js";

export { mix, alpha, hash, ago } from "./util.js";

/** Instrument Serif (fonts/, SIL OFL): titles and the menu. */
export const SERIF = "Instrument Serif";
export const ART = "mods/cosy/art";
export const ICON = "mods/cosy/icons";

export function look() {
  const t = theme();
  return {
    t,
    cream: t.foreground,
    muted: t.muted,
    dim: t.dim,
    wood: "#4a3324",
    woodHi: "#7b563a",
    woodLo: "#2b1c13",
    brass: "#c9a25e",
    gilt: "#e6cd92",
    paper: "#efe2c6",
    paperEdge: "#cbb68c",
    ink: "#2b1f17",
    inkDim: "#806a52",
    lamp: t.accent,
    lampHi: "#ffe3ad",
    unlit: "#35251b",
  };
}

/** The café's words for what an agent is doing. */
export const MOOD = { blocked: "needs you", done: "ready", working: "brewing", idle: "resting" };
export const URGENCY = { blocked: 3, done: 2, working: 1, idle: 0 };

/** Text in the display face. */
export const serif = (text, size, color) =>
  div().font_family(SERIF).text_size(size).line_height(`${Math.round(size * 1.15)}px`).text_color(color).child(text);

/** A press that stays with the control (the bars drag the window). */
export const stop = (_e, cx) => cx.stop_propagation();

/** The key that runs `action` here ("Ctrl+F C"), the shortest one bound, or "". */
export function keyFor(action) {
  const bound = keys().filter((k) => k.action === action && (k.section === "global" || k.section === "layout:cosy"));
  bound.sort((a, b) => a.keys.length - b.keys.length);
  return bound[0] ? keyLabel(bound[0].keys) : "";
}

/** A program's icon at `size`: tinted when it's a one-color glyph. */
export function programIcon(program, size, color, svg, image) {
  if (!program?.icon) return null;
  return program.tint ? svg(program.icon).size(size).flex_none().text_color(color) : image(program.icon).w(size).h(size).flex_none();
}
