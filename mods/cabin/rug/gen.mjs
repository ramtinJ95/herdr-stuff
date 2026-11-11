// Run: node mods/cabin/rug/gen.mjs mods/cabin/rug
// The den's kilim, as one-color layers tinted at runtime (den.js): the
// zigzag band along its ends, diamonds down its sides, the field's lattice,
// and the fringe. Pixel steps of 2px. Sized to the den at its widest (the
// sidebar's max, 480) and a tall window (1200): no bigger, they're drawn
// every frame.
const W = 480, H = 1200;
import { writeFileSync } from "fs";
const dir = process.argv[2];
const svg = (w, h, d) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges"><path fill="currentColor" d="${d}"/></svg>\n`;
const px = (x, y, w = 2, h = 2) => `M${x} ${y}h${w}v${h}h-${w}z`;

// Zigzag, 10 tall, period 16: a 2px line up and down.
let zig = "";
for (let x = 0; x < W; x += 2) {
  const k = (x / 2) % 8;
  const y = 2 * (k < 4 ? k : 8 - k) + 1;
  zig += px(x, y);
}
writeFileSync(`${dir}/zig.svg`, svg(W, 10, zig));

// Diamonds stacked down a 10-wide column, period 14.
let col = "";
for (let y = 0; y < H; y += 14) {
  for (const [dx, dy, w] of [[4, 0, 2], [2, 2, 6], [0, 4, 10], [2, 6, 6], [4, 8, 2]]) col += px(dx, y + dy, w, 2);
}
writeFileSync(`${dir}/col.svg`, svg(10, H, col));

// The field: hollow diamonds on a 24px lattice (offset every other row), a
// dot in each; one cell, as a pattern. Black, drawn as an image at low
// opacity (it darkens any rug): an image is rasterized once, while an svg()
// this big would be redrawn every frame.
let cell = "";
for (const [cx, cy] of [[12, 12], [0, 0], [24, 0], [0, 24], [24, 24]]) {
  for (let k = 0; k < 4; k++)
    cell += px(cx + 2 * k, cy - 6 + 2 * k) + px(cx - 2 * k, cy - 6 + 2 * k) + px(cx + 2 * k, cy + 6 - 2 * k) + px(cx - 2 * k, cy + 6 - 2 * k);
  cell += px(cx, cy);
}
writeFileSync(`${dir}/lattice.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges"><defs><pattern id="c" width="24" height="24" patternUnits="userSpaceOnUse"><path fill="#000000" d="${cell}"/></pattern></defs><rect width="${W}" height="${H}" fill="url(#c)"/></svg>\n`);

// Fringe: strands every 4px, 4–6 long.
// Fringe: strands every 4px, 4–6 long, hanging down (and, for the far end,
// standing up).
let down = "", up = "";
for (let x = 1; x < W; x += 4) {
  const len = 4 + ((x * 7) % 3);
  down += px(x, 0, 2, len);
  up += px(x, 6 - len, 2, len);
}
writeFileSync(`${dir}/fringe.svg`, svg(W, 6, down));
writeFileSync(`${dir}/fringe-up.svg`, svg(W, 6, up));
