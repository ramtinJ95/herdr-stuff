// The café's building blocks: its pixel font, bevels, chunky buttons.

import { div, svg } from "gpui-kit";
import { window, shared, setShared } from "herdr";
import { mix, alpha } from "./palette.js";

/**
 * Whether the café moves: only while its window has focus; when nobody's
 * looking it holds still and costs nothing.
 */
export const live = () => window()?.active !== false;

/**
 * How much the café moves, picked on the MENU and kept in shared
 * "cabin.motion": [name, the scene's frames a second]. Every frame redraws
 * the whole window (terminals too), so this is the café's CPU knob; still
 * holds every picture where it is. Unset (or unknown): cosy.
 */
export const MOTIONS = [["still", 0], ["light", 4], ["cosy", 8], ["smooth", 12]];
export const motion = () => MOTIONS.find(([name]) => name === shared("cabin.motion")) ?? MOTIONS[2];

/** Steps motion to the next of MOTIONS (the MENU's row, `cabin.motion`). */
export function cycleMotion() {
  const i = MOTIONS.indexOf(motion());
  setShared("cabin.motion", MOTIONS[(i + 1) % MOTIONS.length][0]);
}

/**
 * The café's beat. Everything here moves in steps, like pixel art does, on
 * this clock: a native loop or transition would redraw the whole window
 * about 30 times a second while it runs. `share` of the scene's rate
 * (motion()): the window and fire run at 1, pets and lights at 1/2, the
 * board's steam at 1/4, so every view's beats land on the scene's frames.
 * onTick(t) gets the wall clock in seconds, held to the beat, then the view
 * redraws; animations are timed in seconds, so the rate can change under
 * them. Nothing ticks while the window isn't live() or motion is still.
 * onTick returning false stops the beat (a role that was replaced).
 */
export function beat(cx, share, onTick) {
  const IDLE_MS = 1000;
  const next = (cx) => {
    const fps = motion()[1] * share;
    if (fps > 0 && live()) {
      if (onTick(Math.floor((Date.now() * fps) / 1000) / fps) === false) return;
      cx.notify();
    }
    const ms = fps > 0 ? 1000 / fps : IDLE_MS;
    cx.timer.after(ms - (Date.now() % ms) + 1, next);
  };
  cx.timer.after(1, next);
}

/**
 * What a native loop({ from, to, period }) would show at t seconds: there
 * and back over `period` ms, eased, clamped to 0..1 (a value below 0 holds
 * it at 0 for part of the period).
 */
export function wave(t, { from, to = 1, period }) {
  const ph = ((t * 1000) % period) / period;
  const tri = ph < 0.5 ? ph * 2 : 2 - ph * 2;
  const e = tri * tri * (3 - 2 * tri);
  return Math.max(0, Math.min(1, from + (to - from) * e));
}

/** Of `list`, the one at `t` (each held `hold`, in t's units). */
export const step = (list, t, hold = 1) => list[Math.floor(t / hold) % list.length];

/** Silkscreen (mods/cabin/fonts, SIL OFL): crisp at multiples of 8px. */
export const PIXEL = "Silkscreen";

/** Text in the pixel font. size 8 or 16 stays crisp. */
export const px8 = (text, color, size = 8) =>
  div().font_family(PIXEL).text_size(size).line_height(`${size + 2}px`).text_color(color).child(text);

/**
 * A raised (or pressed) box: light on the top and left, dark on the bottom
 * and right, `w` px each, around `face`. `fill`: it takes its parent's
 * size; `shrink`: it gives up width in a crowded row (its face must too).
 */
export function bevel(face, { hi, lo, w = 2, pressed = false, fill = false, shrink = false }) {
  const [a, b] = pressed ? [lo, hi] : [hi, lo];
  const inner = div().flex().bg(a).pt(w).pl(w).child(face);
  return div().flex().flex_none().bg(b).pr(w).pb(w)
    .when(fill, (el) => el.size_full().flex().flex_col())
    .when(shrink, (el) => el.flex_shrink_1().min_w(0))
    .child(fill ? inner.flex_1().min_h(0).flex().flex_col() : shrink ? inner.flex_1().min_w(0) : inner);
}

/** A chunky wooden knob with an icon or glyph, as on the windows' bars. */
export function knob(p, id, content, action, { tip, size = 18, lit = false } = {}) {
  const face = div()
    .size(size - 2)
    .flex()
    .items_center()
    .justify_center()
    .bg(lit ? mix(p.frameLit, p.flame, 0.15) : p.frame)
    .text_color(p.paper)
    .child(typeof content === "string" && content.endsWith(".svg") ? svg(content).size(Math.round(size * 0.62)) : content);
  return div()
    .id(id)
    .flex_none()
    .cursor_pointer()
    .when(Boolean(tip), (el) => el.tooltip(tip))
    .hover((s) => s.opacity(0.85))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((e, cx) => { cx.stop_propagation(); action(e, cx); })
    .child(bevel(face, { hi: p.frameHi, lo: p.frameLo, w: 1 }));
}

// ---- snow on a ledge -----------------------------------------------------

/** How deep snowbank() reaches below its box's top, icicles included; and
 *  where its ledge line is (what's below it hangs over the front). */
export const BANK = 22;
export const LEDGE = 10;

/**
 * Snow lying on a ledge, as children for a box whose ledge line is LEDGE
 * down: one-color layers (snow/*.svg, from snow/gen.mjs) tinted from the
 * theme. `shift` (0..-1200) picks which stretch of the 2400px bank shows.
 */
export function snowbank(p, shift = 0) {
  const layer = (name, color) => svg(`mods/cabin/snow/${name}.svg`).absolute().top(0).left(shift).w(2400).h(BANK).text_color(color);
  return [
    layer("cast", alpha(p.frameLo, 0.7)),
    layer("body", mix(p.snow, "#ffffff", 0.25)),
    layer("under", mix(p.snow, p.sky, 0.38)),
    layer("lit", mix(p.snow, "#ffffff", 0.85)),
    layer("ice", alpha(mix(p.snow, p.sky, 0.15), 0.8)),
  ];
}
