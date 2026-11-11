// The ceiling beam across the top: the café's sign, where you are, its
// buttons and the window's; under it, string lights that twinkle (on a
// slow beat: kit.beat).
// Dragging the beam moves the window; double-click maximizes.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { spaces, run, window } from "herdr";
import { palette, alpha, mix } from "./palette.js";
import { sprite } from "./pixel.js";
import { PIXEL, bevel, knob, px8, beat, wave } from "./kit.js";
import { toggleSidebar, tabLabel } from "./util.js";

const STEP = 34;
// The strand in 2px cells: per lamp, a big colored bulb (5×5, hue 1–5) and a
// small white one (3×4); caps "c"; a round glow "h" behind each. Lamps
// twinkle in groups (big ones in 4, small in 3), each group one sprite, so
// the whole strand is a few dozen elements however wide the window is.
const BIG = ["..c..", ".bbb.", "bbbbb", "bbbbb", ".bbb."];
const SMALL = [".c.", "bbb", "bbb", ".b."];
const BIG_GROUPS = [1700, 2300, 2900, 3500];
const SMALL_GROUPS = [1900, 2600, 3300];

const strands = new Map();

function strand(n) {
  if (strands.has(n)) return strands.get(n);
  const cols = Math.ceil((n * STEP) / 2) + 8;
  const blank = () => Array.from({ length: 8 }, () => Array(cols).fill("."));
  const put = (g, rows, x0, y0, f) => rows.forEach((r, y) => [...r].forEach((c, x) => { if (c !== ".") g[y0 + y][x0 + x] = f(c); }));
  const disc = (g, cx, cy, r) => {
    for (let y = 0; y < 8; y++) for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(cols - 1, Math.ceil(cx + r)); x++)
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) g[y][x] = "h";
  };
  const big = BIG_GROUPS.map(() => ({ lamp: blank(), glow: blank() }));
  const small = SMALL_GROUPS.map(() => ({ lamp: blank(), glow: blank() }));
  for (let i = 0; i < n; i++) {
    const x = Math.round((i * STEP) / 2);
    const B = big[i % big.length];
    disc(B.glow, x + 4.5, 2.5, 4.5);
    put(B.lamp, BIG, x + 2, 0, (c) => (c === "b" ? String((i % 5) + 1) : c));
    const S = small[i % small.length];
    disc(S.glow, x + 13, 3, 3.2);
    put(S.lamp, SMALL, x + 12, 1, (c) => c);
  }
  const text = (g) => g.map((r) => r.join(""));
  const out = {
    big: big.map((x) => ({ lamp: text(x.lamp), glow: text(x.glow) })),
    small: small.map((x) => ({ lamp: text(x.lamp), glow: text(x.glow) })),
  };
  strands.set(n, out);
  return out;
}

export default class Beam {
  init(_props, cx) {
    this.width = 1600;
    this.t = 0;
    beat(cx, 1 / 2, (t) => { if (this.gone) return false; this.t = t; });
  }

  lights(p) {
    // Lamps in sixteens: a resize seldom asks for a new strand.
    const n = Math.ceil(this.width / STEP / 16) * 16;
    const { big, small } = strand(n);
    const hues = Object.fromEntries(p.flags.map((c, i) => [String(i + 1), mix(c, "#ffffff", 0.15)]));
    const group = (g, colors, glow, period) => div().absolute().top(1).left(0)
      .child(div().absolute().top(0).left(0).child(sprite(g.glow, { h: glow }, 2)))
      .child(sprite(g.lamp, colors, 2))
      .opacity(wave(this.t, { from: 0.35, period }));
    return div()
      .absolute()
      .top(0)
      .left(0)
      .w(this.width)
      .h_full()
      .children(big.map((g, i) => group(g, { ...hues, c: p.frameLo }, alpha(p.bulb, 0.12), BIG_GROUPS[i])))
      .children(small.map((g, i) => group(g, { b: p.bulb, c: p.frameLo }, alpha(p.bulb, 0.14), SMALL_GROUPS[i])))
      // The string they hang on.
      .child(div().absolute().top(0).left(0).w(this.width).h(1).bg(p.frameLo));
  }

  render() {
    const p = palette();
    const w = window();
    const space = spaces().find((s) => s.active);
    const tab = space?.tabs.find((c) => c.active);
    const where = space ? [space.name, tab && tabLabel(tab)].filter(Boolean).join("  ›  ") : "";
    const date = new Date().toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
    const mac = w?.platform === "macos" && !w?.fullscreen;
    const sign = bevel(
      h_flex().h(22).px(10).gap(8).items_center().bg(p.ink)
        .child(div().font_family(PIXEL).text_size(16).line_height(`${18}px`).text_color(p.paper).child("HERDR"))
        .child(div().font_family(PIXEL).text_size(16).line_height(`${18}px`).text_color(p.fire).child("CAFÉ")),
      { hi: p.frameHi, lo: p.frameLo, w: 2 },
    );
    const bar = h_flex()
      .id("beam")
      .h(32)
      .flex_none()
      .pl(mac ? 80 : 10)
      .pr(8)
      .gap(10)
      .items_center()
      .bg(p.frame)
      .border_b(2)
      .border_color(p.frameLo)
      .on_mouse_down("left", (e) => { if (e.click_count === 2) run("window.maximize"); })
      .child(sign)
      .child(div().text_size(12).text_color(alpha(p.paper, 0.6)).child(date))
      .child(div().flex_1())
      .child(div().truncate().max_w(520).text_size(12.5).font_medium().text_color(p.paper).child(where))
      .when(Boolean(space?.branch), (el) => el.child(div().flex_none().text_size(12).text_color(alpha(p.paper, 0.55)).child(space.branch)))
      .child(div().flex_1())
      .child(knob(p, "beam-find", "mods/workspace-chrome/search.svg", () => run("mod.open", { name: "picker" }), { tip: "Find a space" }))
      .child(knob(p, "beam-fold", "mods/workspace-chrome/sidebar.svg", toggleSidebar, { tip: "Fold the wall" }))
      .child(knob(p, "beam-settings", "mods/workspace-chrome/settings.svg", () => run("app.settings"), { tip: "Settings" }))
      .when(Boolean(w?.buttons), (el) => el
        .child(div().w(6))
        .child(knob(p, "win-min", "−", () => run("window.minimize"), { tip: "Minimize" }))
        .child(knob(p, "win-max", w.maximized ? "▫" : "□", () => run("window.maximize"), { tip: w.maximized ? "Restore" : "Maximize" }))
        .child(knob(p, "win-close", "×", () => run("window.close"), { tip: "Close", lit: true })));
    return v_flex()
      .id("beam-root")
      .size_full()
      .on_size_change((size, cx) => { if (Math.abs(size.width - this.width) > 20) { this.width = size.width; cx.notify(); } })
      .child(bar)
      .child(div().relative().flex_1().overflow_hidden().child(this.lights(p)));
  }
}
