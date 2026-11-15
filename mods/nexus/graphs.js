// A node's graphs on the Cluster page, as the dashboard draws them (src/control/dashboard/graph-data.ts in Nexus): the
// ranges, the charts and the lines each draws from `GET /v1/nodes/<node>/metrics`, and where each point falls in a
// chart, in percent of its plot. Pure: no Herdr imports, so Node tests it.

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

export const graphRanges = [["15m", 15 * minute], ["1h", hour], ["6h", 6 * hour], ["24h", day], ["7d", 7 * day], ["30d", 30 * day]];
export const rangeOf = (name) => graphRanges.find(([n]) => n === name)?.[0] ?? "1h";
export const rangeMs = (name) => graphRanges.find(([n]) => n === rangeOf(name))[1];

/** How often the control plane reads each online node's health, whether or not anyone watches it. */
const backgroundReadMs = 60_000;

/** The metrics API's answer as the charts read it: the range, the bucket width, and each series by its key. */
export const historyOf = (m) => ({ from: m.from, to: m.to, bucketMs: m.bucketMs, series: new Map(m.series.map((s) => [s.key, s])) });

/** Whether any point stands for more than one sample, so a line shows its average and a band its min and max. */
export const bucketed = (h) => [...h.series.values()].some((s) => s.n.some((n) => n > 1));

/** Points further apart than this have no reading between them, so the line breaks there. */
export const gapMs = (bucketMs) => 2.5 * Math.max(bucketMs, backgroundReadMs);

const none = () => ({ t: [], min: [], avg: [], max: [], n: [] });
const held = (h, key) => h.series.get(key) ?? none();

/**
 * `a`'s points in the buckets `b` has a point in too, each made from `a`'s and `b`'s values there by `f`. Two series
 * meet by bucket, not by time: a point's time is its bucket's first sample of its own series.
 */
function joined(a, b, bucketMs, f) {
  const at = new Map(b.t.map((t, i) => [Math.floor(t / bucketMs), i]));
  const out = none();
  a.t.forEach((t, i) => {
    const j = at.get(Math.floor(t / bucketMs));
    if (j === undefined) return;
    out.t.push(t);
    out.n.push(a.n[i]);
    for (const which of ["min", "avg", "max"]) out[which].push(f(a[which][i], b.avg[j]));
  });
  return out;
}

/**
 * Hands out colour slots by identity, in the order identities first appear, so a pylon keeps its colour while others
 * start and stop, and in both pylon charts.
 */
export function slotter() {
  const families = new Map();
  return (family, id) => {
    const slots = families.get(family) ?? families.set(family, new Map()).get(family);
    return slots.get(id) ?? slots.set(id, slots.size).get(id);
  };
}

/** A tick in at most three figures. */
const short = (v) => Math.abs(v) >= 1000 ? `${Number((v / 1000).toPrecision(3))}K` : String(Number(v.toPrecision(3)));
const gibs = { digits: 1, suffix: " GiB" };
const line = (h, key, label, look, extra = {}) => h.series.has(key) ? [{ id: key, label, points: held(h, key), look, ...extra }] : [];
const lastOf = (h, key) => h.series.get(key)?.avg.at(-1);
/** The node was read in the range, but no read held a series of the kind, so the chart says why it is empty. */
const noneOf = (h, kind, why, also) => h.series.size > 0 && ![...h.series.keys()].some((key) => key.startsWith(`${kind}:`) || key === also) ? why : null;
/** A line for each series of a kind, ordered by label, coloured by the identity `id` names. */
const each = (h, slots, family, kind, id) => [...h.series.values()].filter((s) => s.series.kind === kind)
  .sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key))
  .map((s) => ({ id: id(s.series), label: s.label, points: s, look: { slot: slots(family, id(s.series)) } }));
const pylonId = (s) => `${s.pylon}:${s.thread ?? ""}`;

const perCpu = (h, key) => joined(held(h, key), held(h, "cpus"), h.bucketMs, (load, cpus) => load / cpus);
/** Memory used is the total less what is available, so its lowest is the total less the most available. */
const memoryUsed = (h) => {
  const p = joined(held(h, "memAvailable"), held(h, "memTotal"), h.bucketMs, (available, total) => total - available);
  return { ...p, min: p.max, max: p.min };
};
const noPylons = "No pylon's processes were reported in this range, as none ran or the node's backend does not say which are its pylons'.";

/** The dashboard's charts, in its order. A line's `look` is a colour slot, or `ref` for a reference such as a total. */
export const charts = [
  {
    id: "load-per-cpu", title: "Load per CPU", unit: "", zero: true, guide: 1, digits: 2, suffix: "", tick: short,
    lines: (h) => [["load1", "1 minute"], ["load5", "5 minutes"], ["load15", "15 minutes"]].flatMap(([key, label], slot) =>
      h.series.has(key) && h.series.has("cpus") ? [{ id: key, label, points: perCpu(h, key), look: { slot } }] : []),
  },
  {
    id: "load", title: "Load against CPUs", unit: "", zero: true, digits: 2, suffix: "", tick: short,
    lines: (h) => [...line(h, "load1", "1-minute load", { slot: 0 }), ...line(h, "cpus", "CPUs", { ref: true }, { step: true })],
  },
  {
    id: "memory", title: "Memory", unit: "GiB", zero: true, ...gibs, tick: short,
    lines: (h) => [
      ...h.series.has("memAvailable") && h.series.has("memTotal") ? [{ id: "memUsed", label: "Used", points: memoryUsed(h), look: { slot: 0 } }] : [],
      ...line(h, "memAvailable", "Available", { slot: 1 }),
    ],
    holds: (h) => held(h, "memTotal").max,
  },
  {
    id: "swap", title: "Swap", unit: "GiB", zero: true, ...gibs, tick: short,
    lines: (h) => [...line(h, "swapUsed", "Used", { slot: 0 }), ...line(h, "swapTotal", "Total", { ref: true })],
    note: (h) => lastOf(h, "swapTotal") === 0 ? "This node has no swap." : null,
  },
  {
    id: "disk", title: "Disk free", unit: "GiB", zero: true, ...gibs, tick: short,
    lines: (h) => [...line(h, "diskFree", "Free", { slot: 0 }), ...line(h, "diskTotal", "Total", { ref: true })],
  },
  {
    id: "temperatures", title: "Temperatures", unit: "°C", zero: false, digits: 1, suffix: " °C", tick: (v) => `${short(v)}°`,
    lines: (h, slots) => each(h, slots, "temp", "temp", (s) => s.sensor),
    note: (h) => noneOf(h, "temp", "This node reported no temperatures in this range. A VM often exposes none."),
  },
  {
    id: "pylon-cpu", title: "Pylon CPU", unit: "% of one CPU", zero: true, digits: 1, suffix: "%", tick: (v) => `${short(v)}%`,
    lines: (h, slots) => [...each(h, slots, "pylon", "pylonCpu", pylonId), ...line(h, "otherPylonsCpu", h.series.get("otherPylonsCpu")?.label ?? "", { ref: true })],
    note: (h) => noneOf(h, "pylonCpu", noPylons, "otherPylonsCpu"),
  },
  {
    id: "pylon-memory", title: "Pylon memory", unit: "GiB resident", zero: true, ...gibs, tick: short,
    lines: (h, slots) => [...each(h, slots, "pylon", "pylonResident", pylonId), ...line(h, "otherPylonsResident", h.series.get("otherPylonsResident")?.label ?? "", { ref: true })],
    note: (h) => noneOf(h, "pylonResident", noPylons, "otherPylonsResident"),
  },
];

/** A point as the legend reads it: its average, and the range of its samples when they differ, as in 25.2 GiB (24.5–26.0). */
export function reading(chart, avg, min = avg, max = avg) {
  const [a, lo, hi] = [avg, min, max].map((v) => v.toFixed(chart.digits));
  return lo === hi ? `${a}${chart.suffix}` : `${a}${chart.suffix} (${lo}–${hi})`;
}

const steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 10];
/** The smallest round number at least `v` with a little room, so a line at its peak does not run along the top. */
export function niceCeil(v) {
  if (!(v > 0)) return 1;
  const room = v * 1.04;
  const scale = 10 ** Math.floor(Math.log10(room));
  return Number((steps.find((s) => s * scale >= room) * scale).toPrecision(6));
}

/** The y range that holds every value of the lines, hidden ones too, the guide and what the chart `holds`; from 0 for a quantity. */
export function yRange(chart, h, lines) {
  const values = [...lines.flatMap((l) => [...l.points.min, ...l.points.max]), ...chart.holds?.(h) ?? [], ...chart.guide === undefined ? [] : [chart.guide]].filter(Number.isFinite);
  if (values.length === 0) return [0, 1];
  if (chart.zero) return [0, niceCeil(Math.max(...values))];
  const [lo, hi] = [Math.min(...values), Math.max(...values)];
  const step = niceCeil(Math.max(hi - lo, Math.abs(hi) * 0.1, 1) / 4);
  return [Math.floor(lo / step) * step - step, Math.ceil(hi / step) * step + step];
}

const clamp = (v) => Math.max(0, Math.min(100, v));
const round = (v) => Math.round(v * 100) / 100;

/** How many columns of the plot's width a line keeps at most two points in: its highest and its lowest there. */
const columnsKept = 160;
/**
 * A run of points thinned for painting: where several fall in one column, as 30 days of hourly buckets do in a narrow
 * plot, only the column's highest and lowest stay, in their order, so a spike still shows.
 */
export function thin(points) {
  const out = [];
  for (let i = 0; i < points.length;) {
    const column = Math.floor(points[i][0] / 100 * columnsKept);
    let j = i;
    while (j < points.length && Math.floor(points[j][0] / 100 * columnsKept) === column) j++;
    if (j - i <= 2) out.push(...points.slice(i, j));
    else {
      const cell = points.slice(i, j);
      const top = cell.reduce((a, p) => p[1] < a[1] ? p : a);
      const bottom = cell.reduce((a, p) => p[1] > a[1] ? p : a);
      out.push(...top === bottom ? [top] : cell.filter((p) => p === top || p === bottom));
    }
    i = j;
  }
  return out;
}

/**
 * A chart ready to paint, in percent of its plot, y from the top: each line's runs of points, broken where readings
 * are missing and thinned to the plot's columns, a stepped line's held flat until its next point, and, when the history is bucketed, a band from each
 * run's max to its min. `guide` is the guide's height, or null. `latest` is the legend's reading of the line's last
 * point, or null for a line with none. `note` says why the chart is empty, or null.
 */
export function plotOf(chart, h, slots) {
  const lines = chart.lines(h, slots);
  const [lo, hi] = yRange(chart, h, lines);
  const span = h.to - h.from;
  const x = (t) => round(clamp(span > 0 ? (t - h.from) / span * 100 : 100));
  const y = (v) => round(clamp((1 - (v - lo) / (hi - lo)) * 100));
  const gap = gapMs(h.bucketMs);
  const banded = bucketed(h);
  const drawn = lines.map((l) => {
    const { t, min, avg, max } = l.points;
    const runs = [];
    t.forEach((at, i) => {
      if (i === 0 || at - t[i - 1] > gap) runs.push([]);
      runs.at(-1).push(i);
    });
    const path = (values) => (run) => thin(run.flatMap((i, k) => {
      const point = [x(t[i]), y(values[i])];
      return l.step && k > 0 ? [[x(t[i]), y(values[run[k - 1]])], point] : [point];
    }));
    const last = t.length - 1;
    return {
      id: l.id, label: l.label, look: l.look,
      runs: runs.map(path(avg)),
      bands: banded ? runs.map((run) => [...path(max)(run), ...path(min)(run).reverse()]) : [],
      latest: last < 0 ? null : reading(chart, avg[last], min[last], max[last]),
    };
  });
  const empty = lines.every((l) => l.points.t.length === 0);
  return {
    y: [lo, hi], lines: drawn,
    guide: chart.guide === undefined ? null : y(chart.guide),
    note: chart.note?.(h) ?? (empty ? "No readings in this range. Nexus records one each time something reads this node's health, such as this page." : null),
  };
}
