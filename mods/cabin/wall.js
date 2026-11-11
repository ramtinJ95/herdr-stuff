// The café's back wall, as an SVG in the theme's colors: horizontal log
// planks with seams, knots and a few nails, warm toward the bottom where the
// fire's light falls. The layout shows it behind the windows (tailor.js), at
// the window's own size so it's never scaled: every panel's planks line up.

import { mix, alpha } from "./palette.js";

const PLANK = 28;

function rand(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

// The last wall drawn: drawing is pure, and the counter renders often.
let cached = null;

/** The wall for a palette and window size: { svg, key } (key names both). */
export function wall(p, size) {
  const id = [p.wall, p.fire, p.seam, p.fg, size.width, size.height].join();
  if (cached?.id === id) return cached.wall;
  cached = { id, wall: draw(p, size.width, size.height) };
  return cached.wall;
}

function draw(p, W, H) {
  const r = rand(29);
  const tones = [p.wall, mix(p.wall, p.fire, 0.05), mix(p.wall, "#000000", 0.08)];
  const rows = [];
  for (let y = 0, i = 0; y < H; y += PLANK, i++) {
    const tone = tones[(i * 7 + Math.floor(r() * 3)) % tones.length];
    rows.push(`<rect y="${y}" width="${W}" height="${PLANK}" fill="${tone}"/>`);
    rows.push(`<rect y="${y + PLANK - 3}" width="${W}" height="3" fill="${p.seam}"/>`);
    // Where the planks meet end to end.
    for (let x = r() * 400; x < W; x += 300 + r() * 400)
      rows.push(`<rect x="${Math.round(x)}" y="${y}" width="3" height="${PLANK - 3}" fill="${p.seam}"/>`);
    // Knots and nails.
    for (let k = 0; k < 3; k++) {
      if (r() < 0.45) rows.push(`<ellipse cx="${Math.round(r() * W)}" cy="${y + 8 + Math.round(r() * 6)}" rx="${5 + Math.round(r() * 6)}" ry="3" fill="${alpha(p.seam, 0.55)}"/>`);
      if (r() < 0.3) rows.push(`<rect x="${Math.round(r() * W)}" y="${y + 10}" width="3" height="3" fill="${mix(p.seam, p.fg, 0.25)}"/>`);
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges">
<defs><linearGradient id="fire" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.fire}" stop-opacity="0"/><stop offset="1" stop-color="${p.fire}" stop-opacity="0.09"/></linearGradient>
<radialGradient id="dusk" cx="0.5" cy="0.45" r="0.75"><stop offset="0.55" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="0.28"/></radialGradient></defs>
${rows.join("\n")}
<rect width="${W}" height="${H}" fill="url(#fire)"/>
<rect width="${W}" height="${H}" fill="url(#dusk)"/>
</svg>
`;
  let h = 0;
  for (const c of svg) h = (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0;
  return { svg, key: h.toString(36) };
}
