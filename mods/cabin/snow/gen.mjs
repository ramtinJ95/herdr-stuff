// Run: node mods/cabin/snow/gen.mjs mods/cabin/snow
// Generates mods/cabin/snow/*.svg: one ledge of snow, 2400×22, in layers
// tinted at runtime (kit.snowbank): cast (its shadow on the wood), body,
// under (the shaded underside), lit (the top), ice (icicles).
import { writeFileSync, mkdirSync } from "fs";
const W = 2400, H = 22, LEDGE = 10, C = 2;
let s = 97;
const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const n = W / C;
const top = new Array(n).fill(4), bot = new Array(n).fill(LEDGE);
// Mounds on top: soft bumps.
const ph = [r() * 6, r() * 6];
for (let i = 0; i < n; i++) { const x = i * C; top[i] = 4 - (0.8 * Math.sin(x / 47 + ph[0]) + 0.5 * Math.sin(x / 19 + ph[1])); }
for (let x = r() * 40; x < W; x += 40 + r() * 110) {
  const w = 14 + r() * 36, hgt = 1.5 + r() * 2.5;
  for (let i = 0; i < n; i++) { const d = (i * C - x) / (w / 2); if (Math.abs(d) < 1) top[i] -= hgt * Math.sqrt(1 - d * d); }
}
// Rounded clumps hanging under the front edge.
const drips = [];
for (let x = r() * 20; x < W; x += 16 + r() * 46) {
  const w = 8 + r() * 18, d = 2.5 + r() * 5.5;
  drips.push([x, w, d]);
  for (let i = 0; i < n; i++) { const t = (i * C - x) / (w / 2); if (Math.abs(t) < 1) bot[i] = Math.max(bot[i], LEDGE + d * Math.sqrt(1 - t * t)); }
}
for (let i = 0; i < n; i++) { top[i] = Math.max(0, Math.round(top[i])); bot[i] = Math.min(H - 6, Math.round(bot[i])); }
// Icicles in the gaps between clumps.
const ice = [];
for (let x = 60 + r() * 80; x < W; x += 70 + r() * 190) {
  const i = Math.round(x / C);
  if (bot[i] > LEDGE + 1) continue;
  ice.push([i * C, bot[i], 2 + Math.round(r() * 6)]);
}
// Columns → merged rects.
function layer(span) {
  const out = [];
  for (let i = 0; i < n; ) {
    const [a, b] = span(i);
    let j = i + 1;
    while (j < n && span(j)[0] === a && span(j)[1] === b) j++;
    if (b > a) out.push(`M${i * C} ${a}h${(j - i) * C}v${b - a}h-${(j - i) * C}z`);
    i = j;
  }
  return out.join("");
}
const svg = (d) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges"><path fill="currentColor" d="${d}"/></svg>\n`;
const dir = process.argv[2];
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/body.svg`, svg(layer((i) => [top[i], bot[i]])));
writeFileSync(`${dir}/lit.svg`, svg(layer((i) => [top[i], top[i] + 2])));
writeFileSync(`${dir}/under.svg`, svg(layer((i) => [bot[i] - 2, bot[i]])));
writeFileSync(`${dir}/cast.svg`, svg(layer((i) => [bot[i], bot[i] + 2])));
writeFileSync(`${dir}/ice.svg`, svg(ice.map(([x, y, l]) => `M${x} ${y}h3v${l}h-3zM${x + 1} ${y + l}h1v2h-1z`).join("")));
