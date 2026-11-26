import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { GhError, classifyFailure, classifyRejection, mergeSteps, parseLookup, parsePr, prLookupArgs } from "./github.js";
import { POLL, describeFailure, duration, groups, nextPollDelay, offersMerge, stepsWanted, summarize } from "./model.js";
import { stepsArgs } from "./query.js";

const here = new URL(".", import.meta.url).pathname;
const fixtures = join(here, "fixtures");

function recordings(dir) {
  return readdirSync(dir).filter((f) => /\.jsonl(\.gz)?$/.test(f)).sort().map((f) => {
    const bytes = readFileSync(join(dir, f));
    const text = (f.endsWith(".gz") ? gunzipSync(bytes) : bytes).toString("utf8");
    return { name: f.replace(/\.jsonl(\.gz)?$/, ""), frames: text.split("\n").filter(Boolean).map((line) => JSON.parse(line)) };
  });
}
const committed = recordings(fixtures);
const failures = JSON.parse(readFileSync(join(fixtures, "failures.json"), "utf8"));
const live = JSON.parse(readFileSync(join(fixtures, "live.json"), "utf8"));

const answer = (frame) => ({ data: { rateLimit: frame.rateLimit, repository: { pullRequest: frame.pr } }, errors: null });
/** Frame `n`, counted from 1, of the one recording whose name starts with `prefix`. */
function frame(prefix, n = 1) {
  const found = committed.filter((r) => r.name.startsWith(prefix));
  assert.equal(found.length, 1, `one recording starts with ${prefix}`);
  return structuredClone(found[0].frames[n - 1]);
}
const snapshotOf = (prefix, n = 1, edit = () => {}) => {
  const f = frame(prefix, n);
  edit(f.pr, f.pr.commits.nodes[0].commit);
  return parsePr(answer(f));
};
const run = (commit, name) => {
  const node = commit.statusCheckRollup.contexts.nodes.find((n) => n.name === name);
  assert.ok(node, `the frame has a check named ${name}`);
  return node;
};
const names = (checks) => checks.map((c) => c.name);

const PENDING = "first-game-146-2026-11-26T180250120Z";
const RUNNING = "first-game-146-2026-11-26T180650776Z";
const FAILED = "first-game-66-";
const PASSED = "first-game-145-";
const SETTLED = "survive-n-conquest-62-";

const asOracle = (c) => JSON.stringify([c.name, c.workflow ?? "", c.event ?? "", c.state, c.bucket, c.link ?? ""]);
const oracleRow = (o) => JSON.stringify([o.name, o.workflow, o.event, o.state, o.bucket, o.link]);
const bucketTally = (buckets) => {
  const t = { pass: 0, fail: 0, pending: 0, skipping: 0, cancel: 0 };
  for (const b of buckets) t[b]++;
  return t;
};
const oracleChecks = (f) => (Array.isArray(f.oracle.checks) ? f.oracle.checks : /no checks reported/.test(f.oracle.stderr) ? [] : null);

function differential(t, recs) {
  let frames = 0, checks = 0;
  const left = { unsteady: 0, hidden: 0, "gh failed": 0 };
  for (const { name, frames: all } of recs) {
    all.forEach((f, i) => {
      const theirs = oracleChecks(f);
      if (!f.oracle.steady) return void left.unsteady++;
      if (theirs === null) return void left["gh failed"]++;
      const s = parsePr(answer(f));
      if (s.hidden > 0) return void left.hidden++;
      assert.deepEqual(s.checks.map(asOracle).sort(), theirs.map(oracleRow).sort(), `${name} frame ${i + 1}: checks`);
      assert.deepEqual(summarize(s).ci.all, bucketTally(theirs.map((o) => o.bucket)), `${name} frame ${i + 1}: counts`);
      frames++;
      checks += theirs.length;
    });
  }
  t.diagnostic(`${frames} steady frames, ${checks} checks compared from ${recs.length} recordings; left out ${JSON.stringify(left)}`);
  assert.ok(frames > 0, "no steady frame was compared");
}

test("differential: the de-duplicated checks and counts match gh pr checks on every steady committed frame", (t) => differential(t, committed));

test("differential: the recordings in PR_FIXTURES_EXTRA match gh pr checks", { skip: process.env.PR_FIXTURES_EXTRA ? false : "PR_FIXTURES_EXTRA is not set" },
  (t) => differential(t, recordings(process.env.PR_FIXTURES_EXTRA)));

test("lifecycle replay: each steady frame's CI kind is what gh's buckets for that moment say", (t) => {
  const ghSummary = (buckets) => (buckets.length === 0 ? "none" : ["fail", "pending", "cancel"].find((b) => buckets.includes(b)) ?? "pass");
  let changing = 0;
  for (const { name, frames } of committed) {
    const ours = [], theirs = [];
    for (const f of frames.filter((x) => x.oracle.steady && oracleChecks(x) !== null)) {
      const s = summarize(parsePr(answer(f)));
      if (s.ci.basis !== "all") continue;
      ours.push(s.ci.kind);
      theirs.push(ghSummary(oracleChecks(f).map((o) => o.bucket)));
    }
    assert.deepEqual(ours, theirs, name);
    const seq = ours.filter((k, i) => k !== ours[i - 1]);
    if (seq.length > 1) changing++;
    t.diagnostic(`${name}: ${seq.join(" then ") || "no steady frame"}`);
  }
  assert.ok(changing > 0, "some recording goes through more than one CI kind");
});

const sample = (kind, how) => {
  const found = failures.samples.find((s) => s.kind === kind && how.test(s.how));
  assert.ok(found, `failures.json has a ${kind} sample matching ${how}`);
  return found;
};

const CASES = {
  "No PR": () => ({ failure: classifyFailure(sample("no-pr", /default branch/).exec) }),
  "PR with no checks": () => ({ snapshot: snapshotOf("survive-n-conquest-1-") }),
  "Empty rollup just after a push": () => ({ snapshot: snapshotOf(SETTLED, 2, (pr, commit) => {
    commit.statusCheckRollup = null;
    Object.assign(pr, { mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" });
  }) }),
  Pending: () => ({ snapshot: snapshotOf(PENDING) }),
  "Required checks running": () => ({ snapshot: snapshotOf(PENDING, 1, (pr, commit) => {
    pr.mergeStateStatus = "BLOCKED";
    run(commit, "memory").isRequired = true;
  }) }),
  "Failed required": () => ({ snapshot: snapshotOf(FAILED, 1, (pr, commit) => {
    Object.assign(pr, { state: "OPEN", mergeable: "MERGEABLE", mergeStateStatus: "BLOCKED" });
    run(commit, "e2e").isRequired = true;
  }) }),
  "Failed optional, required passing": () => ({ snapshot: snapshotOf(FAILED, 1, (pr, commit) => {
    Object.assign(pr, { state: "OPEN", mergeable: "MERGEABLE", mergeStateStatus: "UNSTABLE" });
    run(commit, "verify").isRequired = true;
  }) }),
  Cancelled: () => ({ snapshot: snapshotOf(PASSED, 1, (pr, commit) => {
    Object.assign(pr, { state: "OPEN", mergeable: "MERGEABLE", mergeStateStatus: "UNSTABLE" });
    run(commit, "e2e").conclusion = "CANCELLED";
  }) }),
  "All skipped": () => ({ snapshot: snapshotOf(PASSED, 1, (pr, commit) => {
    Object.assign(pr, { state: "OPEN", mergeable: "MERGEABLE", mergeStateStatus: "CLEAN" });
    for (const n of commit.statusCheckRollup.contexts.nodes) n.conclusion = "SKIPPED";
  }) }),
  "Re-run that supersedes a failure": () => ({ snapshot: snapshotOf(FAILED, 1, (pr, commit) => {
    Object.assign(pr, { state: "OPEN", mergeable: "MERGEABLE", mergeStateStatus: "UNSTABLE" });
    const failed = run(commit, "e2e");
    const rerun = { ...structuredClone(failed), id: "CR_rerun", databaseId: failed.databaseId + 1, conclusion: "SUCCESS",
      startedAt: "2026-11-15T05:00:00Z", completedAt: "2026-11-15T05:04:00Z", detailsUrl: `${failed.detailsUrl}0` };
    commit.statusCheckRollup.contexts.nodes.push(rerun);
    commit.statusCheckRollup.contexts.totalCount++;
  }) }),
  Merged: () => ({ snapshot: snapshotOf(PASSED) }),
  "Merged with failed checks": () => ({ snapshot: snapshotOf("first-game-50-") }),
  Closed: () => ({ snapshot: snapshotOf(PASSED, 1, (pr) => { pr.state = "CLOSED"; }) }),
  Draft: () => ({ snapshot: snapshotOf(SETTLED, 2, (pr) => Object.assign(pr, { isDraft: true, mergeStateStatus: "BLOCKED" })) }),
  Conflicts: () => ({ snapshot: snapshotOf(SETTLED, 2, (pr) => Object.assign(pr, { mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" })) }),
  Behind: () => ({ snapshot: snapshotOf(SETTLED, 2, (pr) => { pr.mergeStateStatus = "BEHIND"; }) }),
  "Review required": () => ({ snapshot: snapshotOf(SETTLED, 2, (pr) => Object.assign(pr, { mergeStateStatus: "BLOCKED", reviewDecision: "REVIEW_REQUIRED" })) }),
  "Changes requested": () => ({ snapshot: snapshotOf(SETTLED, 2, (pr) => Object.assign(pr, { mergeStateStatus: "BLOCKED", reviewDecision: "CHANGES_REQUESTED" })) }),
  "Blocked by a rule": () => ({ snapshot: snapshotOf(SETTLED, 2, (pr) => { pr.mergeStateStatus = "BLOCKED"; }) }),
  "Merge state not known": () => ({ snapshot: snapshotOf(SETTLED, 2, (pr) => { pr.mergeStateStatus = "UNKNOWN"; }) }),
  "Passed and clean": () => ({ snapshot: snapshotOf(SETTLED, 2) }),
  "Approved and clean": () => ({ snapshot: snapshotOf(SETTLED, 2, (pr) => { pr.reviewDecision = "APPROVED"; }) }),
  "More than 100 checks": () => ({ snapshot: snapshotOf(PASSED, 1, (pr, commit) => {
    Object.assign(pr, { state: "OPEN", mergeable: "MERGEABLE", mergeStateStatus: "CLEAN" });
    commit.statusCheckRollup.contexts.totalCount = 130;
  }) }),
};

const seconds = (ms) => (ms === null ? "never" : `${ms / 1000} s`);
function tableRow(input) {
  if (input.failure !== undefined) {
    const line = describeFailure(input.failure);
    return ["none", "-", "-", line.headline, line.tone,
      seconds(nextPollDelay({ ciKind: null, prState: null, visible: true, error: { kind: input.failure.kind, streak: 1 } }))];
  }
  const s = summarize(input.snapshot);
  const ci = `${s.ci.kind}${s.ci.basis === "required" ? " (required)" : ""}${s.ci.hidden > 0 ? `, ${s.ci.hidden} hidden` : ""}`;
  const merge = s.merge.kind === "ready" ? (s.merge.note === null ? "ready" : `ready (${s.merge.note})`)
    : s.merge.kind === "blocked" ? `blocked: ${s.merge.blockers.map((b) => b.kind).join(", ")}` : s.merge.kind;
  return [s.stage, ci, merge, s.headline, s.tone,
    seconds(nextPollDelay({ ciKind: s.ci.kind, prState: input.snapshot.pr.state, visible: true, error: null }))];
}

function stateTable() {
  const readme = readFileSync(join(here, "README.md"), "utf8");
  const lines = readme.slice(readme.indexOf("| Case |")).split("\n");
  const end = lines.findIndex((l) => !l.startsWith("|"));
  return lines.slice(2, end).map((l) => {
    const [name, input, ...expected] = l.slice(1, -1).split("|").map((c) => c.trim());
    return { name, input, expected };
  });
}
const table = stateTable();

test("the README's state table and the cases built here are the same set", () => {
  assert.deepEqual(table.map((r) => r.name).sort(), Object.keys(CASES).sort());
});

for (const row of table) {
  test(`state table: ${row.name} (${row.input.replaceAll("`", "")})`, () => assert.deepEqual(tableRow(CASES[row.name]()), row.expected));
}

test("an optional failure stays in the counts of all checks while the required ones pass", () => {
  const { ci } = summarize(CASES["Failed optional, required passing"]().snapshot);
  assert.equal(ci.counts.fail, 0);
  assert.equal(ci.all.fail, 2);
});

test("synthetic: checks beyond the 100 returned are counted, not dropped", () => {
  const { snapshot } = CASES["More than 100 checks"]();
  assert.equal(snapshot.checks.length, 25);
  assert.equal(snapshot.hidden, 105);
});

test("stale: the PR's head is not the commit checked out here", () => {
  const s = snapshotOf(SETTLED, 2);
  assert.equal(summarize(s, { localHead: s.pr.head }).stale, false);
  assert.equal(summarize(s, { localHead: "0000000000000000000000000000000000000000" }).stale, true);
  assert.equal(summarize(s).stale, false);
  const merged = snapshotOf(PASSED);
  assert.equal(merged.pr.state, "MERGED");
  assert.equal(summarize(merged, { localHead: "0000000000000000000000000000000000000000" }).stale, false);
});

test("Merge is offered on a clean PR, and not while GitHub calls it mergeable with checks running or failing", () => {
  assert.equal(offersMerge(summarize(CASES["Passed and clean"]().snapshot)), true);
  assert.equal(offersMerge(summarize(CASES["Pending"]().snapshot)), false);
  assert.equal(offersMerge(summarize(CASES["Cancelled"]().snapshot)), false);
  assert.equal(offersMerge(summarize(CASES["Failed required"]().snapshot)), false);
  assert.equal(offersMerge(summarize(CASES["Merged"]().snapshot)), false);
});

test("Merge is not offered on UNSTABLE even when every check the pane sees passed", () => {
  const clean = CASES["Passed and clean"]().snapshot;
  const s = summarize({ ...clean, pr: { ...clean.pr, mergeState: "UNSTABLE" } });
  assert.deepEqual(s.merge, { kind: "ready", clean: false, note: null });
  assert.equal(s.headline, "Ready to merge");
  assert.equal(offersMerge(s), false);
});

test("the running list holds unfinished checks, oldest start first", () => {
  const { ci } = summarize(snapshotOf(RUNNING));
  assert.equal(ci.running.length, 22);
  assert.deepEqual(names(ci.running.slice(0, 3)), ["capture-shards (5)", "capture-shards (7)", "browser-tests (5)"]);
  assert.deepEqual(names(ci.running.slice(-1)), ["frame-benches"]);
});

test("groups: within a group, by workflow and then name, with numbers in order", () => {
  const [passed] = groups(snapshotOf(PENDING, 3));
  assert.equal(passed.key, "pass");
  assert.deepEqual(names(passed.checks), [
    "browser-tests (1)", "browser-tests (2)", "browser-tests (3)", "browser-tests (4)", "browser-tests (5)", "browser-tests (6)",
    "browser-tests (7)", "browser-tests (8)", "capture",
    "capture-shards (1)", "capture-shards (2)", "capture-shards (3)", "capture-shards (4)", "capture-shards (5)", "capture-shards (6)",
    "capture-shards (7)", "capture-shards (8)", "capture-shards (9)", "capture-shards (10)", "capture-shards (11)",
    "e2e", "frame-benches", "memory", "publish-media", "verify",
  ]);
});

test("synthetic: the CI kind follows gh's order, a failure first, then pending, then cancelled", () => {
  const kind = (failed) => summarize(snapshotOf(PENDING, 1, (_, commit) => {
    run(commit, "capture").conclusion = "CANCELLED";
    if (failed) run(commit, "e2e").conclusion = "FAILURE";
  })).ci.kind;
  assert.equal(kind(true), "fail");
  assert.equal(kind(false), "pending");
});

test("synthetic: groups come failed, running, cancelled, passed, skipped", () => {
  const s = snapshotOf(PENDING, 1, (_, commit) => {
    run(commit, "e2e").conclusion = "FAILURE";
    run(commit, "capture").conclusion = "CANCELLED";
    run(commit, "verify").conclusion = "SKIPPED";
  });
  assert.deepEqual(groups(s).map((g) => [g.title, names(g.checks).length]), [["Failed", 1], ["Running", 1], ["Cancelled", 1], ["Passed", 21], ["Skipped", 1]]);
});

test("steps wanted: the selected check, then Actions jobs in progress oldest first, capped", () => {
  const s = snapshotOf(RUNNING);
  const id = (name) => s.checks.find((c) => c.name === name).id;
  const named = (ids) => ids.map((x) => s.checks.find((c) => c.id === x).name);
  assert.deepEqual(named(stepsWanted(s, id("verify"), 4)), ["verify", "browser-tests (5)", "browser-tests (6)", "browser-tests (8)"]);
  assert.deepEqual(named(stepsWanted(s, null, 2)), ["browser-tests (5)", "browser-tests (6)"]);
});

test("synthetic: steps are not asked for a check from another app", () => {
  const s = snapshotOf(RUNNING, 1, (_, commit) => {
    const other = run(commit, "verify");
    other.checkSuite = { app: { slug: "another-app" }, workflowRun: null };
  });
  const verify = s.checks.find((c) => c.name === "verify");
  assert.equal(verify.workflow, null);
  assert.equal(stepsWanted(s, verify.id, 3).includes(verify.id), false);
});

test("steps inline in a recording carry gh's states and buckets", () => {
  const memory = snapshotOf(PENDING).checks.find((c) => c.name === "memory");
  assert.deepEqual(memory.steps.map((x) => x.bucket), [...Array(9).fill("pass"), ...Array(5).fill("pending")]);
  assert.equal(memory.steps[9].state, "IN_PROGRESS");
});

test("a live poll without steps has none, and a steps answer sets them on the runs it names", () => {
  const snapshot = parsePr(live.pr);
  assert.ok(snapshot.checks.length > 0);
  assert.ok(snapshot.checks.every((c) => c.steps === null));
  const merged = mergeSteps(snapshot, live.steps);
  for (const node of live.steps.data.nodes) {
    assert.deepEqual(names(merged.checks.find((c) => c.id === node.id).steps), names(node.steps.nodes));
  }
  const asked = new Set(live.steps.data.nodes.map((n) => n.id));
  assert.ok(merged.checks.filter((c) => !asked.has(c.id)).every((c) => c.steps === null));
});

test("a steps answer with a run that no longer resolves still sets the runs that do", () => {
  assert.equal(live.partial.code, 1);
  const merged = mergeSteps(parsePr(live.pr), live.partial.body);
  const resolved = live.partial.body.data.nodes.filter((n) => n !== null);
  assert.equal(resolved.length, 1);
  assert.ok(merged.checks.find((c) => c.id === resolved[0].id).steps.length > 0);
});

test("a steps answer with no data throws a GhError", () => {
  assert.throws(() => mergeSteps(parsePr(live.pr), { errors: [{ type: "RATE_LIMITED", message: "API rate limit exceeded" }] }),
    (e) => e instanceof GhError && e.kind === "rate-limited");
});

test("synthetic: a merge state this pane does not know is a GhError, not a guess", () => {
  const f = frame(SETTLED, 2);
  f.pr.mergeStateStatus = "SOMETHING_NEW";
  assert.throws(() => parsePr(answer(f)), (e) => e instanceof GhError && e.kind === "unknown");
});

test("an answer with GraphQL errors is the failure gh's stderr names", () => {
  const exec = sample("no-pr", /does not exist/).exec;
  assert.throws(() => parsePr(JSON.parse(exec.stdout)), (e) => e instanceof GhError && e.kind === classifyFailure(exec).kind);
  assert.equal(classifyFailure(exec).kind, "no-pr");
});

test("the lookup gives where the PR lives, from its URL", () => {
  assert.deepEqual(parseLookup(live.lookup), { host: "github.com", owner: "ramtinJ95", name: "first-game", number: 146 });
  assert.deepEqual(parseLookup('{"number":7,"url":"https://ghe.example.com/team/app/pull/7"}'), { host: "ghe.example.com", owner: "team", name: "app", number: 7 });
  assert.throws(() => parseLookup("not json"), (e) => e instanceof GhError && e.kind === "unknown");
  assert.deepEqual(prLookupArgs().slice(0, 2), ["pr", "view"]);
  assert.ok(prLookupArgs().at(-1).split(",").includes("url"));
});

test("the steps query passes each id as one entry of the ids list, and refuses none", () => {
  const args = stepsArgs(["CR_a", "CR_b"]);
  assert.deepEqual(args.filter((a) => a.startsWith("ids[]=")), ["ids[]=CR_a", "ids[]=CR_b"]);
  assert.throws(() => stepsArgs([]));
});

for (const s of failures.samples) {
  test(`classifyFailure: ${s.how}${s.verified ? "" : " (assumed, not seen)"} is ${s.kind}`, () => assert.equal(classifyFailure(s.exec).kind, s.kind));
}
for (const r of failures.rejections) {
  test(`classifyRejection: ${r.how}${r.verified ? "" : " (assumed, not seen)"} is ${r.kind}`, () => assert.equal(classifyRejection(new Error(r.message)).kind, r.kind));
}

test("a failure nobody named is unknown and keeps gh's text", () => {
  assert.deepEqual(classifyFailure({ code: 1, stdout: "", stderr: "something new\n" }), { kind: "unknown", text: "something new" });
  assert.deepEqual(classifyRejection(new GhError("offline", "down")), { kind: "offline", text: "down" });
});

test("every failure kind has a line to show", () => {
  for (const kind of new Set([...failures.samples, ...failures.rejections].map((s) => s.kind).concat("unknown"))) {
    const line = describeFailure({ kind, text: "" });
    assert.ok(line.headline.length > 0 && ["working", "blocked", "done", "idle"].includes(line.tone), kind);
  }
});

test("polling stops while the pane is hidden, even with checks running", () => {
  assert.equal(nextPollDelay({ ciKind: "pending", prState: "OPEN", visible: false, error: null }), null);
});

test("failures that wait on the person stop polling; offline backs off by doubling up to its cap", () => {
  for (const kind of ["no-gh", "no-auth", "no-repo"]) assert.equal(nextPollDelay({ ciKind: null, prState: null, visible: true, error: { kind, streak: 1 } }), null, kind);
  const { first, max } = POLL.offline;
  const delays = [1, 2, 3, 4, 5, 6, 7, 8].map((streak) => nextPollDelay({ ciKind: null, prState: null, visible: true, error: { kind: "offline", streak } }));
  assert.deepEqual(delays, [1, 2, 4, 8, 16, 32, 64, 128].map((x) => Math.min(first * x, max)));
  assert.equal(delays.at(-1), max);
  const limited = (streak) => nextPollDelay({ ciKind: null, prState: null, visible: true, error: { kind: "rate-limited", streak } });
  assert.equal(limited(1), limited(5));
});

test("duration", () => {
  assert.equal(duration("2026-11-26T18:00:00Z", "2026-11-26T18:00:45Z", 0), "45s");
  assert.equal(duration("2026-11-26T18:00:00Z", "2026-11-26T18:03:29Z", 0), "3m 29s");
  assert.equal(duration("2026-11-26T18:00:00Z", "2026-11-26T19:05:10Z", 0), "1h 5m");
  assert.equal(duration("2026-11-26T18:00:00Z", null, Date.parse("2026-11-26T18:02:00Z")), "2m 0s");
  assert.equal(duration(null, null, 0), "");
});
