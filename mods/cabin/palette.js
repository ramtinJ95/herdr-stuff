// The cabin's colors, mixed from the current theme so every dark theme gets
// its own cabin: wood is the theme's chrome warmed by its yellow, firelight is
// its yellow and red, snow is its foreground. Nothing here is a fixed color.

import { theme } from "herdr";

function rgb(c) {
  const h = String(c ?? "#000000").replace("#", "");
  const n = h.length === 3 ? h.split("").map((x) => x + x).join("") : h.slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) || 0);
}

const hex2 = (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");

/** `a` moved toward `b` by `k` (0..1). */
export function mix(a, b, k) {
  const x = rgb(a);
  const y = rgb(b);
  return "#" + x.map((v, i) => hex2(v + (y[i] - v) * k)).join("");
}

/** `c` at opacity `k` (0..1), as #rrggbbaa. */
export function alpha(c, k) {
  return "#" + rgb(c).map(hex2).join("") + hex2(k * 255);
}

const BLACK = "#000000";

/** Relative luminance (WCAG), 0..1. */
export function lum(c) {
  const [r, g, b] = rgb(c).map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

/** Of the café's ink and paper, the one that reads better on `face`. */
export const textOn = (p, face) => contrast(p.ink, face) >= contrast(p.paper, face) ? p.ink : p.paper;

export function palette() {
  const t = theme();
  const base = t.canvas ?? t.background;
  const fire = t.ansi3 ?? t.working;
  const ember = t.ansi1 ?? t.blocked;
  const flame = t.ansi11 ?? fire;
  return {
    t,
    base,
    fg: t.foreground,
    muted: t.muted,
    dim: t.dim,
    border: t.border,
    // Wood: chrome warmed by the fire's color; planks alternate.
    wood: mix(t.chrome, fire, 0.07),
    plank: mix(t.chrome, fire, 0.11),
    seam: mix(t.chrome, BLACK, 0.35),
    beam: mix(mix(t.chrome, fire, 0.2), BLACK, 0.15),
    // Firelight: the theme's yellow and red.
    fire,
    ember,
    flame,
    glow: alpha(fire, 0.14),
    warm: mix(t.chrome, fire, 0.22),
    // Outside: night sky from the theme's blue, snow from its foreground.
    sky: mix(base, t.ansi4 ?? t.accent, 0.22),
    skyLow: mix(base, t.ansi4 ?? t.accent, 0.08),
    snow: mix(t.foreground, "#ffffff", 0.35),
    pine: mix(base, t.ansi2 ?? t.done, 0.4),
    pineDark: mix(base, t.ansi2 ?? t.done, 0.22),
    stone: mix(base, t.foreground, 0.16),
    stoneDark: mix(base, t.foreground, 0.08),
    soot: mix(base, BLACK, 0.45),
    log: mix(mix(fire, ember, 0.5), BLACK, 0.55),
    outline: mix(base, BLACK, 0.55),
    // The café's walls behind the windows, and the windows' wooden frames.
    wall: mix(mix(base, fire, 0.15), BLACK, 0.08),
    frame: mix(mix(t.chrome, fire, 0.3), BLACK, 0.2),
    frameLit: mix(mix(t.chrome, fire, 0.55), ember, 0.12),
    frameHi: mix(mix(t.chrome, fire, 0.42), "#ffffff", 0.08),
    frameLo: mix(mix(t.chrome, fire, 0.2), BLACK, 0.45),
    // Order tickets: paper in the foreground's tone, ink in the background's.
    paper: mix(t.foreground, fire, 0.12),
    paperDim: mix(mix(t.foreground, fire, 0.12), base, 0.38),
    ink: mix(base, BLACK, 0.2),
    // The chalkboard and its chalk.
    board: mix(mix(base, t.ansi2 ?? t.done, 0.1), BLACK, 0.3),
    chalk: mix(t.foreground, "#ffffff", 0.3),
    // Bunting and string lights.
    flags: [t.ansi1, t.ansi3, t.ansi2, t.ansi4, t.ansi5].map((c) => mix(c ?? fire, base, 0.25)),
    bulb: mix(flame, "#ffffff", 0.35),
  };
}

// Each status in the theme's own status colors, with the cabin's words for it.
export const MOOD = {
  blocked: { word: "needs you", color: (t) => t.blocked },
  done: { word: "done", color: (t) => t.done },
  working: { word: "working", color: (t) => t.working },
  idle: { word: "napping", color: (t) => t.idle ?? t.dim },
};
