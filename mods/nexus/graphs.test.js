import { test } from "node:test";
import assert from "node:assert/strict";
import { charts, historyOf, niceCeil, plotOf, rangeMs, rangeOf, reading, slotter } from "./graphs.js";

const to = Date.parse("2026-01-01T01:00:00Z");
const from = to - 3_600_000;
const series = (key, t, avg, extra = {}) => {
  const [kind, ...rest] = key.split(":");
  const s = kind === "temp" ? { kind, sensor: rest.join(":") } : kind === "pylonCpu" || kind === "pylonResident" ? { kind, pylon: rest[0], thread: rest[1] || null } : { kind };
  return { key, series: s, label: extra.label ?? key, t, avg, min: extra.min ?? avg, max: extra.max ?? avg, n: extra.n ?? t.map(() => 1) };
};
const metrics = (list, bucketMs = 1_000) => ({ node: "n", from, to, tier: "raw", bucketMs, sampledAt: to, series: list, otherPylons: [] });
const chart = (id) => charts.find((c) => c.id === id);

test("ranges fall back to an hour, as the dashboard's picker does", () => {
  assert.equal(rangeOf("7d"), "7d");
  assert.equal(rangeOf("bogus"), "1h");
  assert.equal(rangeOf(null), "1h");
  assert.equal(rangeMs("15m"), 900_000);
});

test("load per CPU divides by the CPUs read in the same bucket, and the guide stays at 1", () => {
  const h = historyOf(metrics([series("load1", [from, to], [4, 8]), series("cpus", [from, to], [16, 16])], 3_600_000));
  const plot = plotOf(chart("load-per-cpu"), h, slotter());
  assert.equal(plot.lines.length, 1);
  assert.deepEqual(plot.y, [0, 1.2]);
  assert.deepEqual(plot.lines[0].runs, [[[0, 79.17], [100, 58.33]]]);
  assert.equal(plot.guide, 16.67);
  assert.equal(plot.lines[0].latest, "0.50");
  assert.equal(plot.note, null);
});

test("a line breaks where readings are missing, and only bucketed history has bands", () => {
  const t = [from, from + 60_000, from + 30 * 60_000, from + 31 * 60_000];
  const raw = plotOf(chart("disk"), historyOf(metrics([series("diskFree", t, [10, 10, 10, 10])])), slotter());
  assert.deepEqual(raw.lines[0].runs.map((r) => r.length), [2, 2]);
  assert.deepEqual(raw.lines[0].bands, []);
  const bucketed = plotOf(chart("disk"), historyOf(metrics([series("diskFree", t, [10, 10, 10, 10], { min: [9, 9, 9, 9], max: [11, 11, 11, 11], n: [3, 3, 3, 3] })], 60_000)), slotter());
  assert.equal(bucketed.lines[0].bands.length, 2);
  assert.equal(bucketed.lines[0].bands[0].length, 4, "max forward, then min back");
  assert.equal(bucketed.lines[0].latest, "10.0 GiB (9.0–11.0)");
});

test("a stepped line holds its value until the next point", () => {
  const h = historyOf(metrics([series("load1", [from, to], [1, 1]), series("cpus", [from, to], [4, 8])], 3_600_000));
  const cpus = plotOf(chart("load"), h, slotter()).lines.find((l) => l.id === "cpus");
  assert.deepEqual(cpus.runs[0].map(([x]) => x), [0, 100, 100]);
  assert.equal(cpus.runs[0][1][1], cpus.runs[0][0][1]);
});

test("memory used is the total less the available, with min and max swapped", () => {
  const h = historyOf(metrics([series("memTotal", [from], [32]), series("memAvailable", [from], [20], { min: [18], max: [24], n: [2] })], 60_000));
  const used = plotOf(chart("memory"), h, slotter()).lines.find((l) => l.id === "memUsed");
  assert.equal(used.latest, "12.0 GiB (8.0–14.0)");
  assert.deepEqual(plotOf(chart("memory"), h, slotter()).y, [0, 40], "the total is held in range");
});

test("empty charts say why: no readings, no swap, no sensors or no pylons", () => {
  const nothing = historyOf(metrics([]));
  assert.match(plotOf(chart("memory"), nothing, slotter()).note, /No readings in this range/);
  const read = historyOf(metrics([series("cpus", [from], [4]), series("swapTotal", [from], [0]), series("swapUsed", [from], [0])]));
  assert.equal(plotOf(chart("swap"), read, slotter()).note, "This node has no swap.");
  assert.match(plotOf(chart("temperatures"), read, slotter()).note, /no temperatures/);
  assert.match(plotOf(chart("pylon-cpu"), read, slotter()).note, /No pylon's processes/);
});

test("a pylon keeps its colour slot in both pylon charts and as others start", () => {
  const slots = slotter();
  const before = historyOf(metrics([series("pylonCpu:pylon-b:th-b", [from], [5], { label: "beta" }), series("pylonResident:pylon-b:th-b", [from], [1], { label: "beta" })]));
  plotOf(chart("pylon-cpu"), before, slots);
  const after = historyOf(metrics([series("pylonCpu:pylon-a:th-a", [from], [5], { label: "alpha" }), series("pylonCpu:pylon-b:th-b", [from], [5], { label: "beta" }),
    series("pylonResident:pylon-b:th-b", [from], [1], { label: "beta" })]));
  const cpu = plotOf(chart("pylon-cpu"), after, slots).lines;
  assert.deepEqual(cpu.map((l) => [l.label, l.look.slot]), [["alpha", 1], ["beta", 0]]);
  assert.equal(plotOf(chart("pylon-memory"), after, slots).lines[0].look.slot, 0);
});

test("a temperature's y range sits around its readings, not from 0", () => {
  const h = historyOf(metrics([series("temp:CPU", [from, to], [48, 52])]));
  const [lo, hi] = plotOf(chart("temperatures"), h, slotter()).y;
  assert.ok(lo > 0 && lo < 48 && hi > 52, `${lo}–${hi}`);
});

test("readings and round ceilings read as the dashboard's", () => {
  assert.equal(reading(chart("pylon-cpu"), 12.34), "12.3%");
  assert.equal(niceCeil(0), 1);
  assert.equal(niceCeil(31), 40);
  assert.equal(niceCeil(0.9), 1);
});

test("a month of hourly points is thinned to the plot's columns, keeping each column's spike", async () => {
  const { thin } = await import("./graphs.js");
  const run = Array.from({ length: 2000 }, (_, i) => [i / 20, i === 1001 ? 0 : 50]);
  const kept = thin(run);
  assert.ok(kept.length <= 320, `${kept.length}`);
  assert.ok(kept.some(([, y]) => y === 0), "the spike stays");
  assert.deepEqual(thin([[0, 1], [50, 2]]), [[0, 1], [50, 2]]);
});
