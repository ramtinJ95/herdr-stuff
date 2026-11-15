import { test } from "node:test";
import assert from "node:assert/strict";
import { arrivalKey, arrivals, askBody, attachedThreads, attentionOf, byProject, changesThreads, clusterNode, placementRows, inFlight, itemGroups, landOffer, machineName, machineVia, openItems, needsYou, openQuestions, pick, pylonMachine, reviewStarts, showSteps, strayMachines, stuckLines, unstarted, workerTerminal, presenceDue } from "./model.js";

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

test("a turn that died and a boot that is held need you, in the control plane's order, and notify", () => {
  const rows = [row("reply", { attention: "reply" }), row("held", { attention: "boot-held" }), row("limited", { attention: "limited" }), row("parked", { attention: "parked" }), row("died", { attention: "died" }), row("decision", { attention: "decision" })];
  assert.deepEqual(needsYou(rows).map((r) => r.id), ["decision", "died", "parked", "limited", "held", "reply"]);
  assert.deepEqual(inFlight(rows), []);
  const before = attentionOf([row("died", { attention: "working" }), row("held")]);
  assert.deepEqual(arrivals(before, rows.filter((r) => r.id === "died" || r.id === "held")).map((r) => r.id), ["held", "died"]);
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

test("an approved review lands by a press though the control plane counts it ended; one that ended otherwise does not", () => {
  const rv = (over) => ({ head: "h1", ended: true, question: null, phase: { kind: "approved" }, press: { kind: "lands", waives: [], quotes: false }, ...over });
  assert.deepEqual(landOffer(rv({})), { kind: "press", head: "h1", body: { head: "h1" }, waives: [] });
  assert.deepEqual(landOffer(rv({ phase: { kind: "landed" } })), { kind: "none", why: "The review ended landed" });
  assert.deepEqual(landOffer(rv({ phase: { kind: "cancelled" } })), { kind: "none", why: "The review ended cancelled" });
  assert.deepEqual(landOffer(rv({ ended: false, phase: { kind: "reviewing" } })), { kind: "none", why: "It lands once its review approves it" });
  assert.match(landOffer(rv({ press: { kind: "stuck", holds: [{ text: "A migration." }] } })).why, /Held past any press: A migration\./);
});

test("an ended review starts again for its own pull request, and one of another says which waiting review it gives up", () => {
  const rv = (over) => ({ id: "rv-1", pr: 7, ended: true, phase: { kind: "approved" }, ...over });
  const prs = (...list) => list.map(([number, state]) => ({ number, state }));
  assert.deepEqual(reviewStarts(rv({}), prs([9, "open"], [7, "open"])), [{ pr: 7, again: true, gives: null }, { pr: 9, again: false, gives: 7 }]);
  assert.deepEqual(reviewStarts(rv({ phase: { kind: "needs-person", reasons: [] } }), prs([9, "open"], [7, "open"])).map((s) => s.gives), [null, 7]);
  // Nexus refuses the start only while the waiting review's own pull request is open, and only for one that waits.
  assert.deepEqual(reviewStarts(rv({}), prs([7, "merged"], [9, "open"])), [{ pr: 9, again: false, gives: null }]);
  assert.deepEqual(reviewStarts(rv({ phase: { kind: "cancelled" } }), prs([7, "open"], [9, "open"])).map((s) => s.gives), [null, null]);
  assert.deepEqual(reviewStarts(rv({}), prs([7, "closed"])), []);
  assert.deepEqual(reviewStarts(rv({ ended: false, phase: { kind: "reviewing" } }), prs([7, "open"], [9, "open"])), []);
  assert.deepEqual(reviewStarts(null, prs([7, "open"])), []);
});

test("a held boot and a dead turn say why the thread stands still, as nexus show words them", () => {
  const now = 10 * 60_000;
  const d = (over) => ({ thread: {}, pylon: {}, said: {}, resume: null, ...over });
  assert.deepEqual(stuckLines(d({}), now), []);
  assert.deepEqual(stuckLines(d({ pylon: { held: { since: now - 120_000 } }, said: { held: "It waits for the ChatGPT login." } }), now), ["Held 2m ago. It waits for the ChatGPT login."]);
  assert.deepEqual(stuckLines(d({ pylon: { held: { since: now - 120_000 } } }), now), []);
  const died = { thread: { turnDied: { at: now - 300_000, reason: "the API answered 529" } } };
  assert.deepEqual(stuckLines(d(died), now), ["Turn died 5m ago: the API answered 529"]);
  // A resume of an earlier death says nothing about this one.
  assert.deepEqual(stuckLines(d({ ...died, resume: { turn: now - 600_000, state: "resumed", count: 1 } }), now), ["Turn died 5m ago: the API answered 529"]);
  const resume = (over) => stuckLines(d({ ...died, resume: { turn: now - 300_000, count: 2, ...over } }), now)[0];
  assert.equal(resume({ state: "waiting", due: now + 90_000 }), "Turn died 5m ago: the API answered 529; Nexus resumes it in 2m, 2 in a row");
  assert.equal(resume({ state: "waiting", due: now - 1 }), "Turn died 5m ago: the API answered 529; Nexus resumes it now, 2 in a row");
  assert.equal(resume({ state: "answered" }), "Turn died 5m ago: the API answered 529; you wrote to it since, so Nexus waits for the turn your message starts");
  assert.equal(resume({ state: "resumed" }), "Turn died 5m ago: the API answered 529; Nexus resumed it, 2 in a row");
  assert.equal(resume({ state: "person", why: "It died 3 times in a row." }), "Turn died, and Nexus does not resume it: It died 3 times in a row. Write to it to resume it.");
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

test("a thread is attached while the app has a machine of its name, here when the shown space is on it", () => {
  const machines = [{ name: null, layout: "ready" }, { name: "vps", layout: "ready" }, { name: "th-000000000001", layout: "ready" }, { name: "th-000000000002", layout: "unavailable" }];
  const rows = [row("th-000000000001", { title: "Fix login" }), row("th-000000000003")];
  assert.deepEqual(attachedThreads(machines, rows, "th-000000000001"), [
    { id: "th-000000000001", title: "Fix login", here: true, layout: "ready" },
    { id: "th-000000000002", title: "th-000000000002", here: false, layout: "unavailable" },
  ], "a machine whose thread is no longer open still shows, by its ID, so it can be detached");
  assert.deepEqual(attachedThreads(machines.slice(0, 2), rows, null), [], "this computer and the person's own machines are no thread's");
});

test("a machine is Attach's to remove only when it reaches its thread's pylon through nexus exec", () => {
  const name = "th-000000000001";
  assert.equal(pylonMachine({ name, via: true, target: machineVia(name) }), true);
  assert.equal(pylonMachine({ name, via: false, target: "vps" }), false, "an ssh machine of that name");
  assert.equal(pylonMachine({ name, via: true, target: "nexus exec th-000000000002" }), false, "another thread's pylon");
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

const nodeFixture = (name = "infra-testbench") => {
  const infra = name === "infra-testbench";
  const disk = { paths: ["/pylons"], totalGiB: infra ? 930 : 952, freeGiB: infra ? 511 : 876.2, pylons: true };
  const empty = { pylons: 0, cpus: 0, memoryGiB: 0 };
  const n = { name, state: "online", observedAt: "2026-01-01T00:00:00Z", overcommitted: false,
    capacity: { cpus: 16, committedCpus: infra ? 2 : 0, memoryGiB: infra ? 31 : 23,
      committedMemoryGiB: infra ? 4 : 0, committedDiskGiB: infra ? 50 : 60, disks: [disk] },
    pylons: { up: infra ? { pylons: 1, cpus: 2, memoryGiB: 4 } : empty,
      paused: empty, archived: empty, crashed: empty, orphaned: [] } };
  const h = { cpus: 16, load: infra ? { one: 1.6, five: 0.99, fifteen: 0.68 } : { one: 0.59, five: 0.38, fifteen: 0.25 },
    memory: { totalGiB: infra ? 31 : 23, availableGiB: infra ? 25.8 : 19.1 },
    disks: [disk], disk: { path: "/pylons", totalGiB: disk.totalGiB, freeGiB: disk.freeGiB },
    temperatures: null, pylons: null };
  return { n, h };
};
const nodeNow = Date.parse("2026-01-01T00:01:00Z");
const cardFor = (n, h) => clusterNode(n, { data: h, error: null }, nodeNow);

test("infra-testbench's words and meters measure host readings, not reservations", () => {
  const { n, h } = nodeFixture();
  const card = cardFor(n, h);
  assert.equal(card.status, "online · seen 1m ago");
  assert.deepEqual(card.meters.map((m) => m.text), [
    "Load 1.60 on 16 CPUs · 5 minutes 0.99 · 15 minutes 0.68",
    "Memory 5.2 GiB used of 31.0 GiB",
    "Disk 419 GiB used of 930 GiB",
  ]);
  const expected = [1.6 / 16, 5.2 / 31, 419 / 930];
  card.meters.forEach((m, i) => {
    assert.ok(Math.abs(m.percent - expected[i] * 100) < 1e-10);
    assert.equal(m.tone, "muted");
  });
  assert.equal(card.committed, "Reservations (not free capacity): 2 of 16 CPUs · 4.0 of 31.0 GiB memory · 50.0 GiB disk");
  assert.equal(card.pylons, "Pylons: 1 up holding 2 CPUs and 4.0 GiB");
});

test("rj-firebat's zero commitments do not zero its measured load or memory", () => {
  const { n, h } = nodeFixture("rj-firebat");
  const card = cardFor(n, h);
  assert.deepEqual(card.meters.map((m) => m.text), [
    "Load 0.59 on 16 CPUs · 5 minutes 0.38 · 15 minutes 0.25",
    "Memory 3.9 GiB used of 23.0 GiB",
    "Disk 75.8 GiB used of 952 GiB",
  ]);
  const expected = [0.59 / 16, 3.9 / 23, 75.8 / 952];
  card.meters.forEach((m, i) => assert.ok(Math.abs(m.percent - expected[i] * 100) < 1e-10));
  assert.equal(card.committed, "Reservations (not free capacity): 0 of 16 CPUs · 0.0 of 23.0 GiB memory · 60.0 GiB disk");
});

test("null host load and memory say unknown and never draw commitments", () => {
  const { n, h } = nodeFixture();
  for (const [field, index, label] of [["load", 0, "Load"], ["memory", 1, "Memory"]]) {
    const card = cardFor(n, { ...h, [field]: null });
    assert.equal(card.meters[index].text, `${label} unknown`);
    assert.equal(card.meters[index].percent, null);
    assert.notEqual(card.meters[2].percent, null);
  }
});

test("unread health keeps the error visible and uses observed disk usage, not reservations", () => {
  const { n } = nodeFixture();
  const card = clusterNode(n, { data: null, error: "probe unreachable" }, nodeNow);
  assert.equal(card.healthError, "Health could not be read: probe unreachable");
  assert.deepEqual(card.meters.slice(0, 2).map((m) => [m.text, m.percent]), [["Load unknown", null], ["Memory unknown", null]]);
  assert.equal(card.meters[2].text, "Disk 419 GiB used of 930 GiB");
  assert.equal(card.meters[2].percent, 419 / 930 * 100);
  assert.equal(clusterNode(n, undefined, nodeNow).healthError, "Health unknown");
  assert.equal(clusterNode(n, undefined, nodeNow).meters[2].percent, card.meters[2].percent);
});

test("unread health without observed disks leaves disk usage unknown", () => {
  const { n } = nodeFixture();
  delete n.capacity.disks;
  const card = clusterNode(n, { data: null, error: "forbidden" }, nodeNow);
  assert.equal(card.meters[2].text, "Disk unknown");
  assert.equal(card.meters[2].percent, null);
  assert.equal(card.healthError, "Health could not be read: forbidden");
});

test("live disks take precedence over observed disks, including the legacy health reading", () => {
  const { n, h } = nodeFixture();
  n.capacity.disks = [{ paths: ["/stale"], totalGiB: 100, freeGiB: 10 }];
  assert.equal(cardFor(n, h).meters[2].text, "Disk 419 GiB used of 930 GiB");
  delete h.disks;
  assert.equal(cardFor(n, h).meters[2].text, "Disk 419 GiB used of 930 GiB");
});

test("never-observed nodes render unknown capacity and pylons without parsing a null timestamp", () => {
  const { n, h } = nodeFixture();
  const unobserved = { ...n, capacity: null, observedAt: null, pylons: null };
  const card = clusterNode(unobserved, undefined, nodeNow);
  assert.equal(card.status, "online · never observed");
  assert.equal(card.committed, "Reservations unknown");
  assert.equal(card.pylons, "Pylons: unknown (no observation yet)");
  assert.ok(card.meters.every((m) => m.percent === null));
  assert.equal(cardFor(unobserved, h).meters[0].percent, 10, "a live reading needs no capacity snapshot");
});

test("old probes without disks use the measured legacy disk; missing readings stay unknown", () => {
  const { n, h } = nodeFixture();
  delete n.capacity.disks;
  delete h.disks;
  assert.equal(cardFor(n, h).meters[2].text, "Disk 419 GiB used of 930 GiB");
  delete h.disk;
  assert.equal(cardFor(n, h).meters[2].percent, null);
  delete n.capacity.committedCpus;
  delete n.capacity.committedDiskGiB;
  n.capacity.committedMemoryGiB = 0;
  assert.equal(cardFor(n, h).committed, "Reservations (not free capacity): unknown of 16 CPUs · unknown of 31.0 GiB memory · unknown disk");
  delete n.capacity.cpus;
  delete n.capacity.memoryGiB;
  assert.equal(cardFor(n, h).committed, "Reservations (not free capacity): unknown of unknown CPUs · unknown of unknown GiB memory · unknown disk");
});

test("every meter shares the 75/90 percent rule, saturates at full, and keeps real words", () => {
  const { n, h } = nodeFixture();
  n.capacity.cpus = 1; // The denominator must be the host health's CPU count, not the registry.
  for (const [used, tone] of [[0, "muted"], [74, "muted"], [75, "ansi3"], [89, "ansi3"], [90, "blocked"], [120, "blocked"]]) {
    const card = cardFor(n, { ...h, cpus: 100, load: { one: used, five: 0, fifteen: 0 },
      memory: { totalGiB: 100, availableGiB: 100 - used }, disks: [{ paths: ["/a"], totalGiB: 100, freeGiB: 100 - used }] });
    assert.deepEqual(card.meters.map((m) => [m.percent, m.tone]), Array(3).fill([Math.min(100, used), tone]));
    assert.match(card.meters[0].text, new RegExp(`Load ${used}.00 on 100 CPUs`));
  }
  assert.equal(cardFor(n, { ...h, cpus: 0 }).meters[0].percent, null);
});

test("each measured filesystem has its own row, while reservations and wake needs are separate", () => {
  const { n, h } = nodeFixture();
  h.disks.push({ paths: ["/data", "/cache"], totalGiB: 100, freeGiB: 10 });
  n.overcommitted = true;
  n.pylons.paused = { pylons: 2, cpus: 4, memoryGiB: 8 };
  n.pylons.crashed = { pylons: 1, cpus: 2, memoryGiB: 4 };
  n.pylons.orphaned = ["pylon-stray"];
  const card = cardFor(n, h);
  assert.equal(card.meters[2].text, "Disk 419 GiB used of 930 GiB · /pylons");
  assert.equal(card.meters[3].text, "Disk 90.0 GiB used of 100 GiB · /data, /cache");
  assert.equal(card.meters[3].tone, "blocked");
  assert.equal(card.committed, "Reservations (not free capacity): 2 of 16 CPUs · 4.0 of 31.0 GiB memory · 50.0 GiB disk · overcommitted");
  assert.equal(card.pylons, "Pylons: 1 up holding 2 CPUs and 4.0 GiB, 2 paused needing 8.0 GiB to wake, 1 crashed needing 4.0 GiB to retry, 1 orphaned (pylon-stray)");
  assert.equal(card.pylonsTone, "blocked");
  n.capacity.disks = [...h.disks];
  const unread = clusterNode(n, { data: null, error: "forbidden" }, nodeNow);
  assert.deepEqual(unread.meters.slice(2), card.meters.slice(2), "observed filesystems keep paths and meter semantics");
});

const defaultSize = { cpus: 2, memoryGiB: 4, diskGiB: 10 };
const admissionFixture = () => ({ node: "infra-testbench", admitted: false,
  reason: "has 6.3 GiB of memory free, less 2.6 GiB its pylons have yet to touch, and the pylon needs 4 GiB with 1 GiB to spare",
  memory: { maxMemoryGiB: 2.7, availableGiB: 6.3, untouchedGiB: 2.6, pendingGiB: 0, reclaimableGiB: 0, headroomGiB: 1, sampledAt: nodeNow - 30_000 } });

test("a roomy-looking card uses the server's refusal, not the live meter or commitments", () => {
  const { n, h } = nodeFixture();
  const a = admissionFixture();
  const card = clusterNode(n, { data: h }, nodeNow, a, defaultSize);
  assert.equal(card.committedTone, "blocked");
  assert.match(card.admission[0].text, /cannot take a 4.0 GiB pylon/);
  assert.equal(card.admission[0].tone, "blocked");
  assert.equal(card.admission[1].text, a.reason);
  assert.match(card.admission[2].text, /2.7 GiB/);
  assert.match(card.admission[3].text, /Host free 6.3 GiB · reserved but untouched 2.6 GiB · spare 1.0 GiB/);
  assert.equal(card.meters[1].text, "Memory 5.2 GiB used of 31.0 GiB", "health can have a different sample; it never decides admission");
});

test("admission distinguishes stale samples, pending boots, held room, offline nodes and unavailable reports", () => {
  const { n, h } = nodeFixture();
  const a = admissionFixture();
  a.admitted = true;
  a.reason = null;
  a.memory = { ...a.memory, maxMemoryGiB: 5.67, availableGiB: null, untouchedGiB: null, sampledAt: null, pendingGiB: 4, reclaimableGiB: 8 };
  const card = clusterNode(n, { data: h }, nodeNow, a, defaultSize);
  assert.equal(card.committedTone, "muted");
  assert.equal(card.admission[0].tone, "done");
  assert.match(card.admission[1].text, /5.6 GiB/);
  assert.match(card.admission[2].text, /No fresh host-memory sample/);
  assert.match(card.admission[3].text, /Pending boots 4.0 GiB · reclaimable holds 8.0 GiB/);
  assert.equal(clusterNode({ ...n, overcommitted: true }, { data: h }, nodeNow, a, defaultSize).committedTone, "blocked");
  const offline = clusterNode({ ...n, state: "offline" }, undefined, nodeNow, { ...a, admitted: false, reason: "is offline", memory: null }, defaultSize);
  assert.deepEqual(offline.admission.map((l) => l.tone), ["blocked", "blocked"]);
  assert.match(cardFor(n, h).admission[0].text, /Placement unknown/);
  assert.equal(cardFor(n, h).admission[0].tone, "blocked");
});

test("the compact card reads the host in a few words, the fullest disk standing for all", () => {
  const { n, h } = nodeFixture();
  h.disks.push({ paths: ["/data"], totalGiB: 100, freeGiB: 5 });
  n.pylons.paused = { pylons: 2, cpus: 4, memoryGiB: 8 };
  const s = clusterNode(n, { data: h }, nodeNow, admissionFixture(), defaultSize).summary;
  assert.deepEqual(s.meters.map((m) => [m.label, m.value, m.tone]), [["Load", "1.60 on 16 CPUs", "muted"], ["Memory", "5.2 of 31.0 GiB", "muted"], ["Fullest disk", "95.0 of 100 GiB", "blocked"]]);
  assert.deepEqual(s.pylons, { text: "1 up · 2 paused", tone: "muted" });
  const unknown = clusterNode({ ...n, pylons: null }, undefined, nodeNow).summary;
  assert.equal(unknown.pylons.text, "Pylons unknown");
  assert.deepEqual(unknown.meters.map((m) => m.value).slice(0, 2), ["unknown", "unknown"]);
});

test("placement rows follow the page's nodes, keep the scheduler's verdict, and name the nearest node's shortfall", () => {
  const report = { nodes: [{ node: "b", admitted: false }, { node: "a", admitted: true }, { node: "c", admitted: false }], nearest: { node: "b", missingGiB: 1.23 } };
  assert.deepEqual(placementRows(report, ["a", "b", "gone"]), [
    { node: "a", fits: true, text: "fits", tone: "done" },
    { node: "b", fits: false, text: "does not fit · needs 1.3 GiB more memory", tone: "blocked" },
    { node: "c", fits: false, text: "does not fit", tone: "blocked" },
  ]);
});
