// Pixel art from grids of role characters. Drawn as one-color SVG layers,
// one per role, tinted at draw time: a 16×15 pet is a handful of elements,
// whatever the theme. The layers are written once, under the app's
// data/cabin/sprites, by keepSprites() (main.js runs it); a grid whose
// layers aren't written yet draws as rows of runs meanwhile.

import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { appHome, setShared } from "herdr";
import * as fs from "fs/promises";
import { mix } from "./palette.js";
import { W, H, species, speciesOf, furOf } from "./pets.js";
import { step } from "./kit.js";

const DIR = "data/cabin/sprites";
const known = new Map(); // grid text → { key, roles }
const ready = new Set(); // keys whose layers are on disk
const queue = new Map(); // key → { rows, roles }
let wake = null;

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h.toString(36) + text.length.toString(36);
}

function grid(rows) {
  const text = rows.join("\n");
  let g = known.get(text);
  if (!g) {
    g = { key: hash(text), roles: [...new Set(text.replace(/[.\n]/g, ""))] };
    known.set(text, g);
  }
  return g;
}

const file = (key, role) => `${key}-${role.charCodeAt(0)}.svg`;

/** One role's cells as an SVG path, a unit per cell. */
function layer(rows, role, w) {
  let d = "";
  rows.forEach((r, y) => {
    for (let x = 0; x < w; ) {
      if (r[x] !== role) { x++; continue; }
      let n = 1;
      while (r[x + n] === role) n++;
      d += `M${x} ${y}h${n}v1h-${n}z`;
      x += n;
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${rows.length}" viewBox="0 0 ${w} ${rows.length}" shape-rendering="crispEdges"><path fill="currentColor" d="${d}"/></svg>\n`;
}

/**
 * Writes queued sprites' layers, then redraws everyone. Run once, for the
 * mod's life (its task outlives the view that starts it).
 */
export function keepSprites(cx) {
  if (keepSprites.running) return;
  keepSprites.running = true;
  cx.spawn(async () => {
    const dir = `${appHome()}/${DIR}`;
    await fs.mkdir(dir, { recursive: true });
    for (const f of await fs.readdir(dir)) ready.add(f.replace(/-\d+\.svg$/, ""));
    setShared("cabin.sprites", ready.size);
    for (;;) {
      if (queue.size === 0) await new Promise((r) => { wake = r; });
      const batch = [...queue];
      queue.clear();
      for (const [key, { rows, roles }] of batch) {
        const w = Math.max(...rows.map((r) => r.length));
        try {
          for (const role of roles) await fs.writeFile(`${dir}/${file(key, role)}`, layer(rows, role, w));
          ready.add(key);
        } catch (e) {
          console.log(`cabin: could not write sprite ${key} (${e})`);
        }
      }
      setShared("cabin.sprites", ready.size);
    }
  }, { owner: null });
}

/** rows: strings of role characters; colors: role → color (absent: clear). */
export function sprite(rows, colors, px) {
  const g = grid(rows);
  const w = Math.max(...rows.map((r) => r.length));
  if (ready.has(g.key)) {
    return div().relative().flex_none().w(w * px).h(rows.length * px)
      .children(g.roles.filter((role) => colors[role]).map((role) =>
        svg(`${DIR}/${file(g.key, role)}`).absolute().top(0).left(0).w(w * px).h(rows.length * px).text_color(colors[role])));
  }
  if (!queue.has(g.key)) { queue.set(g.key, { rows, roles: g.roles }); wake?.(); wake = null; }
  return runs(rows, colors, px, w);
}

function runs(rows, colors, px, w) {
  return v_flex()
    .flex_none()
    .w(w * px)
    .h(rows.length * px)
    .children(
      rows.map((r) => {
        const out = [];
        for (let x = 0; x < w; ) {
          const c = r[x] ?? ".";
          let n = 1;
          while (x + n < w && (r[x + n] ?? ".") === c) n++;
          out.push([c, n]);
          x += n;
        }
        return h_flex()
          .flex_none()
          .h(px)
          .children(out.map(([c, n]) => {
            const d = div().flex_none().w(n * px).h(px);
            return colors[c] ? d.bg(colors[c]) : d;
          }));
      }),
    );
}

function bodyColor(kind, p) {
  const t = p.t;
  switch (kind) {
    case "orange": return mix(mix(t.ansi1, t.ansi3, 0.55), p.fg, 0.08);
    case "brown": return mix(mix(t.ansi3, t.ansi1, 0.3), p.base, 0.4);
    case "night": return mix(t.ansi4, p.base, 0.55);
    case "snow": return mix(p.fg, "#ffffff", 0.25);
    case "cream": return mix(t.ansi3, p.fg, 0.6);
    case "bark": return mix(mix(t.ansi3, t.ansi1, 0.45), p.base, 0.52);
    default: return mix(t.ansi8 ?? p.dim, p.fg, 0.3);
  }
}

/** Role → color for one pet: its species' body, its status' scarf. */
export function paint(kind, statusColor, p, { asleep = false, name = "" } = {}) {
  const body = bodyColor(kind, p);
  const outline = p.outline;
  return {
    o: outline,
    b: body,
    d: mix(body, outline, 0.35),
    l: name === "penguin" ? p.snow : mix(body, p.fg, kind === "snow" ? 0.15 : 0.55),
    k: mix(p.t.ansi5 ?? p.ember, p.fg, 0.35),
    n: mix(mix(p.t.ansi1, p.t.ansi5 ?? p.t.ansi1, 0.5), p.fg, 0.2),
    y: p.fire,
    E: asleep ? body : outline,
    e: outline,
    s: statusColor,
    S: mix(statusColor, outline, 0.35),
  };
}

// Each status's bubble: its frames in turn, each held `hold` seconds.
const BUBBLE = {
  idle: { frames: ["z", "z z", "z z Z", ""], hold: 0.67 },
  working: { frames: ["·", "· ·", "· · ·"], hold: 0.33 },
  blocked: { frames: ["!", "!", ""], hold: 0.33 },
  done: { frames: ["✓", "✓ ✦", "✓"], hold: 0.67 },
};

// Hops and bobs per status, in pixels up: `keys` spread evenly over
// `period` seconds, drawn between, so a faster beat shows the in-between
// heights. Busy bobs, needing you hops, done sways.
const MOTION = {
  working: { keys: [0, 1], period: 0.67 },
  blocked: { keys: [0, 2, 3, 2, 0, 0], period: 2 },
  done: { keys: [0, 0, 1, 1], period: 1.33 },
};

/** The height of `m` at t seconds, in whole pixels. */
function height(m, t) {
  const n = m.keys.length;
  const x = (((t % m.period) + m.period) % m.period) / m.period * n;
  const i = Math.floor(x);
  const a = m.keys[i % n];
  const b = m.keys[(i + 1) % n];
  return Math.round(a + (b - a) * (x - i));
}

// A blink lasts this long, every four or five seconds (each pet its own).
const BLINK = 0.25;

function seed(s) {
  let h = 0;
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

/**
 * One pet for an agent: { status, address, fur?, species? }.
 * size: pixel size in px. bubble: show its z / … / ! above it. t: the
 * den's beat, in seconds. still: no hops or blinks (where a pet only
 * marks whose pane it is).
 */
export function pet(p, a, { px = 3, bubble = true, still = false, id, t: sec = 0 } = {}) {
  const t = p.t;
  const name = a.species ?? speciesOf(a.address);
  const sp = species(name);
  const status = a.status ?? "idle";
  const statusColor = t[status] ?? t.dim;
  const asleep = status === "idle";
  const colors = paint(a.fur ?? furOf(name, a.address), statusColor, p, { asleep, name });
  const w = W * px;
  const h = H * px;
  const s = seed(a.address);

  // Blinks: the upper eye pixels in the body's color.
  const blinkEvery = 4 + (s % 8) / 4;
  const blinking = !asleep && !still && (sec + s) % blinkEvery < BLINK;
  const lids = sp.rows.map((r) => r.replace(/[^E]/g, "."));
  const motion = still ? null : MOTION[status];
  const body = div()
    .relative()
    .w(w)
    .h(h)
    .when(Boolean(motion), (el) => el.top(-px * height(motion, sec + (s % 3) * 0.3)))
    .child(sprite(sp.rows, colors, px))
    .when(blinking, (el) => el.child(div().absolute().top(0).left(0).child(sprite(lids, { E: colors.b }, px))));

  const b = BUBBLE[status];
  const say = bubble && b
    ? div()
        .absolute()
        .top(-px * 2)
        .left(w - px * 4)
        .text_size(Math.max(9, px * 3.4))
        .font_bold()
        .text_color(status === "idle" ? t.dim : statusColor)
        .child(step(b.frames, sec + (s % 5) * 0.33, b.hold))
    : null;

  return div()
    .id(id ?? `pet-${a.address}`)
    .relative()
    .flex_none()
    .w(w + px * 4)
    .h(h + px * 2)
    .pt(px * 2)
    .child(
      // The rug it sits on, lit by the fire.
      div().absolute().bottom(0).left(0).w(w).h(px * 2).rounded_full().bg(mix(p.warm, p.fire, 0.18)),
    )
    .child(body)
    .when(Boolean(say), (el) => el.child(say));
}
