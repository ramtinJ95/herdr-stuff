// The café's scenery: snow past the window, the fire. It moves in steps:
// every function takes `t`, the view's beat in seconds (kit.beat), and draws
// that step.
// Specks (snow, stars, hills) are drawn as sprites, a few elements each.

import { div } from "gpui-kit";
import { sprite } from "./pixel.js";
import { alpha, mix } from "./palette.js";
import { step, wave } from "./kit.js";

// ---- snow ---------------------------------------------------------------

function rand(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

const grids = new Map();

/** A seeded grid of w×h cells, built once: fill(grid, rand) marks it. */
function cells(key, w, h, fill) {
  if (grids.has(key)) return grids.get(key);
  const g = Array.from({ length: h }, () => Array(w).fill("."));
  fill(g, rand(key.length * 7919 + [...key].reduce((x, c) => x + c.charCodeAt(0), 0)));
  const rows = g.map((r) => r.join(""));
  grids.set(key, rows);
  return rows;
}

/**
 * Snow falling over a w×h box, at t: a sheet of flakes ("f", big ones
 * "F") that repeats every `period` px down and slides `speed` px a second
 * (a whole number of px a step keeps it even), so it never shows a seam.
 * `sway` px: the sheet drifts side to side.
 */
export function snowfall(p, { w, h, period, flakes, big = 0, speed, sway = 0, seed, t }) {
  const copies = Math.ceil(h / period) + 1;
  const rows = cells(`snow-${seed}-${w}-${period}-${flakes}-${big}`, w + 2 * sway, period * copies, (g, r) => {
    for (let i = 0; i < flakes; i++) {
      const x = Math.floor(r() * (w + 2 * sway - 2));
      const y = Math.floor(r() * (period - 2));
      const size = r() < big ? 2 : 1;
      for (let k = 0; k < copies; k++)
        for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) g[y + k * period + dy][x + dx] = size > 1 ? "F" : "f";
    }
  });
  const fall = Math.round(t * speed) % period;
  const drift = sway ? Math.round(sway * Math.sin(t * 0.85)) - sway : 0;
  return div().absolute().top(fall - period).left(drift)
    .child(sprite(rows, { f: alpha(p.snow, 0.6), F: alpha(p.snow, 0.9) }, 1));
}

// ---- window -------------------------------------------------------------

const PINE = [
  "....w....",
  "...wpw...",
  "..wpppw..",
  "...ppp...",
  "..wpppw..",
  ".wpppppw.",
  "..ppppp..",
  ".wpppppw.",
  "ppppppppp",
  "....t....",
];

const MOON = [
  "...mmmmm...",
  "..mmmmmmm..",
  ".mmmmmmcmm.",
  "mmcmmmmmmmm",
  "mmccmmmmmmm",
  "mmmmmmmcmmm",
  "mmmmmmmccmm",
  "mmmcmmmmmmm",
  ".mmmmmmmmm.",
  "..mmmmmmm..",
  "...mmmmm...",
];

const CLOUD = [
  "....cccc.......",
  "..cccccccc.ccc.",
  ".ccccccccccccccc",
  "cccccccccccccccc",
];

const HUT = [
  "......sss.",
  "....sssss.",
  "..sssssssss",
  ".sssssssssss",
  "..wwwwwwww..",
  "..wwwwwlww..",
  "..wwdwwlww..",
  "..wwdwwwww..",
];

/** A ridge line of stepped columns, seeded: [x, height][]. */
function ridge(w, { step: dx, lo, hi, seed }) {
  const r = rand(seed);
  const cols = [];
  let y = lo + (hi - lo) / 2;
  for (let x = 0; x < w; x += dx) {
    y = Math.max(lo, Math.min(hi, y + (r() - 0.5) * (hi - lo) * 0.6));
    cols.push([x, Math.round(y)]);
  }
  return cols;
}

const TWINKLE = [0.2, 0.5, 0.9, 1, 0.9, 0.6, 0.35, 0.2, 0.2];
const GLOW = [0.55, 0.7, 0.85, 1, 0.9, 0.75, 0.6];

/**
 * The café window at t: a night sky with twinkling stars, the moon
 * with its halo and a cloud drifting past, snowy hills, a cabin with a lit
 * window among the pines, drifts, and snow falling in two layers.
 */
export function cafeWindow(p, { w = 160, h = 140, t = 0 } = {}) {
  const frame = mix(p.beam, p.fire, 0.15);
  const skyTop = mix(p.sky, "#000000", 0.25);
  const ground = h - 18;
  const pine = (x, scale, dark, bottom = h - ground - 2) =>
    div().absolute().bottom(bottom).left(x)
      .child(sprite(PINE, { p: dark ? p.pineDark : p.pine, w: alpha(p.snow, 0.85), t: p.log }, scale));
  // Stars in three groups that twinkle out of step, a third of a second a
  // step.
  const stars = [0, 1, 2].map((k) => div().absolute().top(0).left(0).opacity(step(TWINKLE, t + k / 2, 1 / 3))
    .child(sprite(cells(`stars-${k}-${w}-${h}`, w, Math.round(h * 0.45), (g, r) => {
      for (let i = 0; i < 6; i++) {
        const x = 2 + Math.floor(r() * (w - 6));
        const y = 2 + Math.floor(r() * (h * 0.42));
        g[y][x] = "s";
        if (i === 0) g[y][x + 1] = g[y + 1][x] = g[y + 1][x + 1] = "s";
      }
    }), { s: p.snow }, 1)));
  // Hills and the drifts in front, as one sprite.
  const land = cells(`land-${w}-${h}`, w, h, (g) => {
    const fillCol = (x0, wid, top, c) => { for (let x = x0; x < Math.min(w, x0 + wid); x++) for (let y = top; y < ground; y++) g[y][x] = c; };
    for (const [x, y] of ridge(w, { step: 4, lo: 22, hi: 40, seed: 3 })) fillCol(x, 4, ground - y, "h");
    for (const [x, y] of ridge(w, { step: 6, lo: 8, hi: 18, seed: 9 })) fillCol(x, 6, ground - y, "H");
    for (const [x, y] of ridge(w, { step: 8, lo: 1, hi: 5, seed: 17 })) for (let xx = x; xx < Math.min(w, x + 8); xx++) for (let yy = ground - y; yy < h; yy++) g[yy][xx] = "g";
    for (let x = 0; x < w; x++) for (let yy = h - 5; yy < h; yy++) g[yy][x] = "G";
  });
  const moonX = w - 42;
  const cloudX = Math.round(((t * 1.5) % (w + 48)) - 40);
  return div()
    .relative()
    .flex_none()
    .w(w)
    .h(h)
    .overflow_hidden()
    .bg(p.sky)
    // The sky deepens upward, in bands.
    .child(div().absolute().top(0).left(0).w_full().h(h * 0.18).bg(skyTop))
    .child(div().absolute().top(h * 0.18).left(0).w_full().h(h * 0.14).bg(mix(skyTop, p.sky, 0.5)))
    .child(div().absolute().top(h * 0.55).left(0).w_full().h(h * 0.45).bg(mix(p.sky, p.skyLow, 0.6)))
    .children(stars)
    // The moon, its halo breathing; a cloud wanders across it.
    .child(div().absolute().top(2).left(moonX - 14).size(50).rounded_full().bg(alpha(p.snow, 0.05)).opacity(step(GLOW, t, 0.85)))
    .child(div().absolute().top(10).left(moonX - 6).size(34).rounded_full().bg(alpha(p.snow, 0.08)))
    .child(div().absolute().top(16).left(moonX).child(sprite(MOON, { m: mix(p.snow, p.fire, 0.12), c: mix(p.snow, p.sky, 0.35) }, 2)))
    .child(div().absolute().top(30).left(cloudX).child(sprite(CLOUD, { c: alpha(mix(p.sky, p.snow, 0.3), 0.75) }, 2)))
    .child(div().absolute().top(0).left(0).child(sprite(land, {
      h: mix(p.sky, p.snow, 0.13), H: mix(p.sky, p.snow, 0.24), g: mix(p.snow, p.sky, 0.25), G: alpha(p.snow, 0.9),
    }, 1)))
    // Far snow, behind the trees.
    .child(snowfall(p, { w, h, period: Math.round(h / 2), flakes: 22, speed: 8, seed: 21, t }))
    .child(pine(4, 2, true))
    .child(pine(w * 0.62, 2, true))
    // A cabin across the snow, its window lit.
    .child(div().absolute().bottom(h - ground - 1).left(w * 0.26)
      .child(sprite(HUT, { s: alpha(p.snow, 0.9), w: mix(p.log, p.pineDark, 0.3), d: mix(p.log, "#000000", 0.4), l: p.flame }, 3))
      .child(div().absolute().top(10).left(14).size(20).rounded_full().bg(alpha(p.flame, 0.22)).opacity(step(GLOW, t + 0.33, 0.33))))
    .child(pine(w * 0.12, 3, false))
    .child(pine(w * 0.74, 3.5, false))
    .child(pine(w * 0.5, 2.5, false))
    // Near snow, in front, swaying.
    .child(snowfall(p, { w, h, period: h, flakes: 30, big: 0.4, speed: 24, sway: 3, seed: 13, t }))
    // Frost in the bottom corners.
    .child(div().absolute().bottom(0).left(0).w(14).h(6).bg(alpha(p.snow, 0.35)))
    .child(div().absolute().bottom(6).left(0).w(6).h(6).bg(alpha(p.snow, 0.25)))
    .child(div().absolute().bottom(0).right(0).w(14).h(6).bg(alpha(p.snow, 0.35)))
    .child(div().absolute().bottom(6).right(0).w(6).h(6).bg(alpha(p.snow, 0.25)))
    // Mullions: a cross of the frame's wood.
    .child(div().absolute().top(0).left(w / 2 - 2).w(4).h_full().bg(frame))
    .child(div().absolute().top(h * 0.45).left(0).w_full().h(4).bg(frame));
}

/** The window in its wooden frame: a bevel, a sill with snow banked on it. */
export function framedWindow(p, opts) {
  const inner = cafeWindow(p, opts);
  return div().flex().flex_none().bg(p.frameLo).pr(3).pb(3)
    .child(div().flex().bg(p.frameHi).pt(3).pl(3)
      .child(div().flex().bg(mix(p.beam, p.fire, 0.15)).p(3).child(inner)));
}

// ---- by the fire -------------------------------------------------------

const WOOD = [
  "....oooooo....",
  "...occcccco...",
  "...oclllllo...",
  ".oooooooooooo.",
  "occcccoocccccc",
  "oclllloocllllo",
  "oooooooooooooo",
  "occccooccccccc",
  "ocllloocllllll",
  "oooooooooooooo",
];

/** Firewood stacked by the hearth. */
export function woodpile(p, { px = 3 } = {}) {
  return sprite(WOOD, { o: mix(p.log, "#000000", 0.35), c: mix(p.log, p.fire, 0.4), l: p.log }, px);
}

const CANDLE = [
  "..f..",
  ".fFf.",
  ".fyf.",
  "..w..",
  ".www.",
  ".www.",
  ".www.",
  "ooooo",
];

/** A candle on the sill, its flame flickering. */
export function candle(p, { px = 2, t = 0 } = {}) {
  const flame = CANDLE.slice(0, 3);
  const body = CANDLE.map((r, i) => (i < 3 ? "....." : r));
  return div().relative().flex_none().w(5 * px).h(8 * px)
    .child(div().absolute().top(-px * 2).left(-px * 2).size(px * 9).rounded_full().bg(alpha(p.flame, 0.12))
      .opacity(wave(t, { from: 0.4, period: 1300 })))
    .child(sprite(body, { w: mix(p.fg, p.fire, 0.2), o: p.frameLo }, px))
    .child(div().absolute().top(0).left(0).child(sprite(flame, { f: p.fire, F: p.flame, y: mix(p.flame, "#ffffff", 0.5) }, px))
      .opacity(wave(t, { from: 0.65, period: 700 })));
}

// ---- fire ---------------------------------------------------------------

const HEARTH = [
  "RRRRRRRRRRRRRRRRRRRRRR",
  "MMMMMMMMMMMMMMMMMMMMMM",
  "RRRRRRRRRRRRRRRRRRRRRR",
  ".rrRrrrRrrrRrrrRrrrRr.",
  ".rRrrrRrrrRrrrRrrrRrr.",
  ".rrRxxxxxxxxxxxxxxRrr.",
  ".rRxxxxxxxxxxxxxxxxRr.",
  ".rrxxxxxxxxxxxxxxxxrr.",
  ".rRxxxxxxxxxxxxxxxxRr.",
  ".rrxxxxxxxxxxxxxxxxrr.",
  ".rRxxxxxxxxxxxxxxxxRr.",
  ".rrxxxxxxxxxxxxxxxxrr.",
  ".rRxxxxxxxxxxxxxxxxRr.",
  ".rrxxxxxxxxxxxxxxxxrr.",
  ".rRxxxxxxxxxxxxxxxxRr.",
  ".rrxxxLLLLLLLLLLxxxrr.",
  ".rRxxLcLLLLLLLLcLxxRr.",
  ".rrxxxLLLLLLLLLLxxxrr.",
  "RRRRRRRRRRRRRRRRRRRRRR",
  "rrrrrrrrrrrrrrrrrrrrrr",
];

const FLAMES = [
  [
    "....f.......",
    "...ff...f...",
    "...fFf..ff..",
    "..fFFf.fFf..",
    "..fFyFffFf..",
    ".fFyyFfFFFf.",
    ".fFyyyFFyFf.",
    "fFFyyyyyyFFf",
    "fFyyyyyyyyFf",
    ".fFFyyyyFFf.",
  ],
  [
    ".......f....",
    "..f...ff....",
    "..ff..fFf...",
    ".fFf..fFFf..",
    ".fFffFyFf...",
    ".fFFfFyyFf..",
    "fFyFFyyyFf..",
    "fFyyyyyyyFFf",
    "fFyyyyyyyyFf",
    ".fFFyyyyFFf.",
  ],
  [
    "............",
    ".....f......",
    "....fFf..f..",
    "..f.fFf.ff..",
    ".ff.fyFffF..",
    ".fFffyyFFf..",
    ".fFFyyyyFFf.",
    "fFyyyyyyyyFf",
    "fFyyyyyyyyFf",
    ".fFFyyyyFFf.",
  ],
];

/** The fireplace at t, its fire flickering (three flames, crossfading). */
export function fireplace(p, { px = 3, t = 0 } = {}) {
  const colors = {
    R: mix(p.stoneDark, p.fire, 0.06),
    r: mix(p.stone, p.fire, 0.08),
    M: p.beam,
    x: p.soot,
    L: p.log,
    c: mix(p.log, p.fire, 0.45),
  };
  const fire = { f: p.ember, F: p.fire, y: mix(p.flame, "#ffffff", 0.3) };
  const flame = (rows, loop) =>
    div().absolute().top(6 * px).left(5 * px)
      .child(sprite(rows, fire, px))
      .when(Boolean(loop), (el) => el.opacity(wave(t, loop)));
  return div()
    .relative()
    .flex_none()
    .w(22 * px)
    .h(20 * px)
    .child(sprite(HEARTH, colors, px))
    // The opening's glow, breathing.
    .child(div().absolute().top(5 * px).left(3 * px).w(16 * px).h(13 * px).bg(alpha(p.fire, 0.22))
      .opacity(wave(t, { from: 0.35, period: 1900 })))
    .child(flame(FLAMES[2], null))
    .child(flame(FLAMES[0], { from: -0.6, period: 900 }))
    .child(flame(FLAMES[1], { from: -1.2, period: 1300 }));
}
