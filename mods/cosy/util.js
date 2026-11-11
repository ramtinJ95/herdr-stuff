// The café's plain helpers: no app, no drawing, so they run under node --test.

function rgb(c) {
  const h = String(c ?? "#000000").replace("#", "");
  const n = h.length === 3 ? h.split("").map((x) => x + x).join("") : h.slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) || 0);
}
const hex2 = (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");

/** `a` moved toward `b` by `k` (0..1). */
export function mix(a, b, k) {
  const x = rgb(a), y = rgb(b);
  return "#" + x.map((v, i) => hex2(v + (y[i] - v) * k)).join("");
}

/** `c` at opacity `k` (0..1), as #rrggbbaa. */
export const alpha = (c, k) => "#" + rgb(c).map(hex2).join("") + hex2(k * 255);

const word = (p) => (p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1));
// "ctrl-shift-t" as "Ctrl+Shift+T"; the key itself may be "-" ("ctrl--", "-").
function chord(c) {
  const minus = c.endsWith("-");
  const parts = (minus ? c.slice(0, -1).replace(/-$/, "") : c).split("-").filter(Boolean);
  return [...parts.map(word), ...(minus ? ["-"] : [])].join("+");
}

/** A binding as people read it: "ctrl-f c" is "Ctrl+F C". */
export const keyLabel = (keys) => keys.split(" ").map(chord).join(" ");

/** A stable small number from an id: which cover a book gets, how it sits. */
export function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** "now", "4m", "2h", "3d" since `at` (ms). */
export function ago(at, now = Date.now()) {
  const m = Math.floor((now - at) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  if (m < 60 * 24) return `${Math.floor(m / 60)}h`;
  return `${Math.floor(m / 1440)}d`;
}
