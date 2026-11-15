import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

// Exercise the real view's async loaders without GPUI or network access. Imports are host bindings;
// none is evaluated by these methods except call(), supplied by each test.
const source = (await readFile(new URL("./main.js", import.meta.url), "utf8"))
  .replace(/^import .*;$/gm, "").replace("export default class Nexus", "class Nexus");
function view(call) {
  const Nexus = runInNewContext(`${source}\nNexus`, { View: class {}, call });
  return Object.assign(new Nexus(), { conn: {}, projects: [{ id: "first" }, { id: "second" }],
    pages: { cluster: { data: {}, error: null } }, admissionProject: null, admissionRequest: 0,
    openNodes: new Set(), metrics: new Map(), metricSlots: new Map(), graphRange: "1h" });
}
const cx = { notify() {} };

test("a late project response never overwrites the selected project's admission", async () => {
  const first = Promise.withResolvers();
  const second = Promise.withResolvers();
  const app = view((_conn, _method, path) => path.endsWith("first") ? first.promise : second.promise);
  const a = app.loadAdmission(cx, "first");
  const b = app.loadAdmission(cx, "second");
  assert.equal(app.pages.cluster.admission.data, null);
  second.resolve({ project: "second", nodes: [] });
  await b;
  first.resolve({ project: "first", nodes: [] });
  await a;
  assert.equal(app.admissionProject, "second");
  assert.equal(app.pages.cluster.admission.data.project, "second");
});

test("a failed refresh clears green admission and reports old-server, forbidden and network failures", async () => {
  for (const [status, message, expected] of [[404, "no route", /Update the Nexus control plane/], [403, "only deployers may", /only deployers may/], [503, "unreachable", /unreachable/]]) {
    const app = view(async () => { throw Object.assign(new Error(message), { status }); });
    app.pages.cluster.admission = { data: { nodes: [{ admitted: true }] }, error: null };
    await app.loadAdmission(cx);
    assert.equal(app.pages.cluster.admission.data, null);
    assert.match(app.pages.cluster.admission.error, expected);
  }
});

test("node refresh failure invalidates even an admission request already in flight", async () => {
  const late = Promise.withResolvers();
  const app = view((_conn, _method, path) => path.startsWith("/v1/placement/") ? late.promise : Promise.reject(new Error("node list unavailable")));
  const reading = app.loadAdmission(cx);
  await app.loadPage(cx, "cluster");
  late.resolve({ project: "first", nodes: [{ admitted: true }] });
  await reading;
  assert.equal(app.pages.cluster.admission.data, null);
  assert.match(app.pages.cluster.admission.error, /The cluster refresh failed/);
});

test("cluster asks for the scheduler's report after host reads, and an empty project list never guesses", async () => {
  const paths = [];
  const app = view(async (_conn, method, path) => {
    paths.push(path);
    assert.equal(method, "GET");
    if (path === "/v1/nodes") return [{ name: "a b" }];
    if (path === "/v1/release") return null;
    if (path.endsWith("/health")) return { memory: null };
    return { project: "first" };
  });
  await app.loadPage(cx, "cluster");
  assert.equal(paths.at(-1), "/v1/placement/first");
  assert.ok(paths.includes("/v1/nodes/a%20b/health"));
  assert.equal(app.pages.cluster.admission.data.project, "first");
  app.projects = [];
  app.admissionProject = null;
  const before = paths.length;
  await app.loadAdmission(cx);
  assert.equal(paths.length, before);
  assert.equal(app.pages.cluster.admission.data, null);
  assert.match(app.pages.cluster.admission.error, /Add a project/);
});
