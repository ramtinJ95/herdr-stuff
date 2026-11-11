import { test } from "node:test";
import assert from "node:assert/strict";
import { arrivalKey, arrivals, askBody, attentionOf, byProject, changesThreads, inFlight, itemGroups, landOffer, machineName, machineVia, openItems, needsYou, openQuestions, pick, showSteps, strayMachines, unstarted, workerTerminal, presenceDue } from "./model.js";

const row = (id, over = {}) => ({
  id, title: id, project: "p", status: "active", attention: null, working: false, createdAt: 1,
  lastAgentActivityAt: null, lastHumanActivityAt: null, lastReplyAt: null, pylon: { actualState: "paused" }, ...over,
});

test("needs you ranks by attention, then by latest activity", () => {
  const rows = [
    row("reply-old", { attention: "reply", lastReplyAt: 10 }),
    row("reply-new", { attention: "reply", lastReplyAt: 20 }),
    row("failed", { attention: "failed" }),
    row("working", { attention: "working" }),
    row("archived", { attention: "failed", status: "archived" }),
  ];
  assert.deepEqual(needsYou(rows).map((r) => r.id), ["failed", "reply-new", "reply-old"]);
});

test("in flight puts each open thread not needing the person in its first matching group", () => {
  const rows = [
    row("w", { attention: "working" }),
    row("busy", { working: true }),
    row("wait", { attention: "waiting" }),
    row("run", { pylon: { actualState: "running" } }),
    row("paused"),
    row("needs", { attention: "decision" }),
  ];
  assert.deepEqual(inFlight(rows).map((g) => [g.key, g.threads.map((r) => r.id).sort()]), [
    ["working", ["busy", "w"]], ["waiting", ["wait"]], ["running", ["run"]], ["quiet", ["paused"]],
  ]);
});

test("by project keeps the projects' order and adds a project only a thread names", () => {
  const groups = byProject([row("a", { project: "x" }), row("b", { project: "y" })], [{ id: "y" }, { id: "z" }]);
  assert.deepEqual(groups.map((g) => [g.project, g.threads.map((r) => r.id)]), [["y", ["b"]], ["z", []], ["x", ["a"]]]);
});

test("arrivals: nothing on first load, then new needs and newer replies", () => {
  const first = [row("a", { attention: "reply", lastReplyAt: 1 }), row("b"), row("c", { attention: "failed" })];
  assert.deepEqual(arrivals(null, first), []);
  const before = attentionOf(first);
  const next = [row("a", { attention: "reply", lastReplyAt: 2 }), row("b", { attention: "decision" }), row("c", { attention: "failed" }), row("d", { attention: "parked" })];
  assert.deepEqual(arrivals(before, next).map((r) => r.id), ["a", "b", "d"]);
  assert.notEqual(arrivalKey(first[0]), arrivalKey(next[0]));
});

test("heartbeats and health changes do not refetch the threads", () => {
  assert.equal(changesThreads([{ kind: "session.heartbeat" }, { kind: "health.changed" }]), false);
  assert.equal(changesThreads([{ kind: "session.heartbeat" }, { kind: "attention.changed" }]), true);
});

test("open questions leave out answered and withdrawn ones", () => {
  const q = (id, over = {}) => ({ id, answer: null, ...over });
  assert.deepEqual(openQuestions({ questions: [q("a"), q("b", { answer: { option: "x" } }), q("c", { withdrawn: { by: "archive", at: 1 } })] }).map((x) => x.id), ["a"]);
});

test("an ask's answer takes a choice per question, in the options' order, and refuses one left empty", () => {
  const ask = { ask: { questions: [
    { header: "TTL", multiSelect: false, options: [{ label: "7" }, { label: "14" }] },
    { header: "Extras", multiSelect: true, options: [{ label: "a" }, { label: "b" }] },
  ] } };
  assert.deepEqual(askBody(ask, [["14"], ["b", "a"]], ["", ""]), { choices: [{ picked: ["14"] }, { picked: ["a", "b"] }] });
  assert.deepEqual(askBody(ask, [[], ["a"]], ["21 days", "and c"]), { choices: [{ picked: [], own: "21 days" }, { picked: ["a"], own: "and c" }] });
  assert.throws(() => askBody(ask, [["7"]], ["", ""]), /Answer "Extras"/);
  assert.throws(() => askBody(ask, [["7"], ["a"]], ["mine", ""]), /"TTL" takes one answer/);
  assert.deepEqual(pick(["7"], "14", false), ["14"]);
  assert.deepEqual(pick(["a"], "b", true), ["a", "b"]);
  assert.deepEqual(pick(["a", "b"], "a", true), ["b"]);
});

test("Land offers the holds question when one is open, else a press that waives what may be waived", () => {
  const rv = (over) => ({ head: "h1", ended: false, question: null, phase: { kind: "approved" }, press: { kind: "lands", waives: [], quotes: false }, ...over });
  assert.deepEqual(landOffer(rv({})), { kind: "press", head: "h1", body: { head: "h1" }, waives: [] });
  assert.deepEqual(landOffer(rv({ phase: { kind: "needs-person", reasons: [] }, press: { kind: "lands", waives: [{ text: "auth" }] } })).body, { head: "h1", waive: ["auth"] });
  assert.equal(landOffer(rv({ question: { id: "q1", head: "h0", holds: [{ text: "auth" }] } })).kind, "question");
  assert.equal(landOffer(rv({ phase: { kind: "reviewing" } })).kind, "none");
  assert.equal(landOffer(rv({ press: { kind: "stuck", holds: [{ text: "migration" }] } })).kind, "none");
  assert.equal(landOffer(rv({ ended: true, phase: { kind: "landed" } })).kind, "none");
  assert.equal(landOffer(null).kind, "none");
  assert.match(landOffer(rv({}), { head: "h2" }).why, /moved to h2/);
  assert.equal(landOffer(rv({}), { head: "h1" }).kind, "press");
});

test("items group by phase in pipeline order, finished ones last; only an unstarted one approves or cancels", () => {
  const item = (id, kind, over = {}) => ({ id, phase: { kind, why: "" }, thread: null, addedAt: 1, ...over });
  const groups = itemGroups([item("a", "landed"), item("b", "queued", { thread: "th-1" }), item("c", "held")]);
  assert.deepEqual(groups.map((g) => [g.key, g.items.map((i) => i.id)]), [["held", ["c"]], ["queued", ["b"]], ["done", ["a"]]]);
  assert.deepEqual(openItems([item("a", "landed"), item("b", "queued"), item("c", "held"), item("d", "cancelled")]).map((i) => i.id), ["b", "c"]);
  assert.equal(unstarted(item("c", "held")), true);
  assert.equal(unstarted(item("b", "queued", { thread: "th-1" })), false);
  assert.equal(unstarted(item("a", "cancelled")), false);
});

test("a thread's machine is named after the thread, and only a thread ID makes one", () => {
  assert.equal(machineName("th-fece39854aa2"), "th-fece39854aa2");
  assert.equal(machineVia("th-fece39854aa2"), "nexus exec th-fece39854aa2");
  assert.throws(() => machineName("th-1; rm -rf ~"), /not a thread ID/);
  assert.throws(() => machineName("vps"), /not a thread ID/);
});

test("the machines to remove are only those the panel added, for threads no longer open, still as it made them", () => {
  const made = (name, over = {}) => ({ name, via: true, target: machineVia(name), temporary: false, ...over });
  const open = new Set(["th-000000000001"]);
  const added = ["th-000000000001", "th-000000000002", "th-000000000003", "th-000000000004"];
  const listed = [
    made("th-000000000001"),
    made("th-000000000002"),
    made("th-000000000004", { via: false, target: "th-000000000004" }),
    made("th-00000000000a"),
    { name: "vps", via: false, target: "vps" },
  ];
  assert.deepEqual(strayMachines(added, listed, open), { remove: ["th-000000000002"], forget: ["th-000000000003", "th-000000000004"] });
  assert.deepEqual(strayMachines([], listed, new Set()), { remove: [], forget: [] });
});

test("the worker's terminal is a Claude worker thread's running Claude Code session", () => {
  const session = (id, harness, state = "running") => ({ id, harness, state });
  const detail = (sessions, claudeWorker = { model: null, state: "started" }) => ({ claudeWorker, sessions });
  assert.equal(workerTerminal(detail([session("t2", "shell"), session("t1", "claude-code")])), "t1");
  assert.equal(workerTerminal(detail([session("t1", "claude-code", "paused")])), null);
  assert.equal(workerTerminal(detail([session("t1", "claude-code")], null)), null);
});

test("the worker's terminal is the Claude Code session the control plane names, among several", () => {
  const session = (id, harnessSessionId, state = "running") => ({ id, harness: "claude-code", harnessSessionId, state });
  const worker = (session) => ({ claudeWorker: { model: null, state: "started", session } });
  const sessions = [session("t1", "side"), session("t3", "own")];
  assert.equal(workerTerminal({ ...worker("own"), sessions }), "t3");
  assert.equal(workerTerminal({ ...worker("gone"), sessions }), null, "the worker's session runs in no terminal");
  assert.equal(workerTerminal({ ...worker(null), sessions }), null, "the worker has not launched");
});

test("showing a machine gives each unshown terminal a tab, the worker's last, and focuses a worker already shown", () => {
  const live = ["m/t1", "m/t2", "m/t3"];
  assert.deepEqual(showSteps(live, new Set(["m/t3"]), "m/t1"), [
    ["terminal.keep", { terminal: "m/t2", place: "tab" }],
    ["terminal.keep", { terminal: "m/t1", place: "tab" }],
  ]);
  assert.deepEqual(showSteps(live, new Set(["m/t1", "m/t2", "m/t3"]), "m/t1"), [["pane.focus", { terminal: "m/t1" }]]);
  assert.deepEqual(showSteps(live, new Set(), null).map(([, a]) => a.terminal), ["m/t1", "m/t2", "m/t3"]);
});

test("presenceDue posts for the shown open thread's machine, at most once per interval", () => {
  const open = new Set(["th-000000000001"]);
  assert.equal(presenceDue("th-000000000001", open, undefined, 1_000, 240_000), "th-000000000001");
  assert.equal(presenceDue("th-000000000001", open, 1_000, 200_000, 240_000), null);
  assert.equal(presenceDue("th-000000000001", open, 1_000, 241_000, 240_000), "th-000000000001");
  assert.equal(presenceDue("th-000000000002", open, undefined, 1_000, 240_000), null, "a thread no longer open");
  assert.equal(presenceDue(null, open, undefined, 1_000, 240_000), null, "this computer's space");
});
