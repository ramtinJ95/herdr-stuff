// What the café is made of: its wood, brass, cards and lamplight, its one
// display face, and the few helpers every part shares. The art is cut from
// one painting (art/make.sh), so the materials are that painting's colors;
// text and status colors come from the layout's theme (themes/cosy.json).

import { div } from "gpui-kit";
import { theme, keys } from "herdr";
import { keyLabel, alpha } from "./util.js";

export { mix, alpha, hash, ago } from "./util.js";

/** Instrument Serif (fonts/, SIL OFL): titles and the menu. */
export const SERIF = "Instrument Serif";
export const ART = "mods/cosy/art";
export const ICON = "mods/cosy/icons";

// What a card is made of: the menu, a question, a list, a note. There are
// two stocks, and CARD picks the one every card is cut from.
//   board  walnut, lettered in cream and gilt, on the ground Herdr's own
//          dialogs stand on, so the café's cards, Herdr's and other mods'
//          windows read as one set. The one in use.
//   paper  the first look: a cream printed menu in dark ink. Kept whole, to
//          build on: set CARD to "paper" and every card is paper again (in a
//          room of dark dialogs, which is why it isn't the one in use).
// `wash` is the color a card's hover, selection and dotted leaders are thin
// layers of; `status` is what an agent is doing, in colors that read on the
// ground.
export const CARD = "board";
const STOCK = {
  board: (t) => ({
    ground: t.popover, edge: "#5b4330", lift: t.raised, radius: 8,
    title: "#e6cd92", rule: alpha("#e6cd92", 0.4), text: t.foreground, key: t.muted, dim: t.dim, wash: t.foreground,
    solid: t.solid, solidText: t.solid_foreground,
    field: t.background, fieldEdge: t.input, fieldText: t.foreground,
    status: { blocked: t.blocked, done: t.done, working: t.working, idle: t.idle },
  }),
  paper: (t) => ({
    ground: "#efe2c6", edge: "#cbb68c", lift: "#fbf1d9", radius: 6,
    title: "#2b1f17", rule: alpha("#2b1f17", 0.45), text: "#2b1f17", key: "#806a52", dim: "#806a52", wash: "#2b1f17",
    solid: "#2b1f17", solidText: "#efe2c6",
    // Dark as an inkwell: the theme's selection color is made for dark
    // ground and would hide ink text on the paper.
    field: "#1c120c", fieldEdge: "#2b1f17", fieldText: t.foreground,
    status: { blocked: "#a23b2a", done: "#4f6b2c", working: "#9a5f14", idle: "#806a52" },
  }),
};

export function look() {
  const t = theme();
  return {
    t,
    card: STOCK[CARD](t),
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

/** The stock a card is cut from: its ground, edge and shadow. */
export const onCard = (L, el) => el.rounded(L.card.radius).bg(L.card.ground).border(1).border_color(L.card.edge).shadow_lg();

/** A card's title over a double rule, as on a café's menu. */
export const heading = (L, text, size = 30) => div().flex().flex_col().flex_none().w_full()
  .child(div().w_full().truncate().text_center().font_family(SERIF).italic().text_size(size).line_height(`${size + 4}px`).text_color(L.card.title).child(text))
  .child(div().mt(6).w_full().h(3).border_t(1).border_b(1).border_color(L.card.rule));

/** A text field on a card. */
export const field = (L, input) => input.flex_none().h(36).px(10).rounded(6).border_1().border_color(L.card.fieldEdge).bg(L.card.field)
  .text_size(13).text_color(L.card.fieldText);

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
