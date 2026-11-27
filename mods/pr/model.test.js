import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { classifyFailure, frameAnswer, parsePr } from "./github.js";
import { failureDelay, groups, keepSteps, nextPollDelay, offersMerge, staleCheckout, stepsWanted, summarize, troubleAfter } from "./model.js";
import { FAILED, PASSED, PENDING, RUNNING, SETTLED, committed, failures, recordings, sample, snapshotOf } from "./recorded.js";
import { failureLines } from "./view.js";

const here = new URL(".", import.meta.url).pathname;

const run = (commit, name) => {
  const node = commit.statusCheckRollup.contexts.nodes.find((n) => n.name === name);
  assert.ok(node, `the frame has a check named ${name}`);
  return node;
};
const names = (checks) => checks.map((c) => c.name);

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
      const s = parsePr(frameAnswer(f));
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

/** The CI kinds each committed recording went through, steady frame by steady frame, as gh pr checks reported its checks then. */
const LIFECYCLE = {
  "first-game-145-2026-11-26T175935787Z": "pass",
  "first-game-146-2026-11-26T180250120Z": "pending then pass",
  "first-game-146-2026-11-26T180650776Z": "pending",
  "first-game-147-2026-11-26T182020174Z": "pending then fail",
  "first-game-50-2026-11-26T175837551Z": "fail",
  "first-game-66-2026-11-26T175907931Z": "fail",
  "survive-n-conquest-1-2026-11-26T180005277Z": "none",
  "survive-n-conquest-62-2026-11-26T180258328Z": "pending then pass",
};

test("lifecycle replay: each recording's steady frames go through the CI kinds it went through when it was recorded", () => {
  const went = Object.fromEntries(committed.map(({ name, frames }) => {
    const kinds = frames.filter((f) => f.oracle.steady && oracleChecks(f) !== null).map((f) => summarize(parsePr(frameAnswer(f))).ci)
      .filter((ci) => ci.basis === "all").map((ci) => ci.kind);
    return [name, kinds.filter((kind, i) => kind !== kinds[i - 1]).join(" then ")];
  }));
  assert.deepEqual(went, LIFECYCLE);
});

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
    const trouble = troubleAfter(null, input.failure, null);
    const line = failureLines(trouble, 0, null);
    return ["none", "-", "-", line.headline, line.tone, seconds(failureDelay(trouble))];
  }
  const s = summarize(input.snapshot);
  const ci = `${s.ci.kind}${s.ci.basis === "required" ? " (required)" : ""}${input.snapshot.hidden > 0 ? `, ${input.snapshot.hidden} hidden` : ""}`;
  const merge = s.merge.kind === "ready" ? (s.merge.note === null ? "ready" : `ready (${s.merge.note})`)
    : s.merge.kind === "blocked" ? `blocked: ${s.merge.blockers.map((b) => b.kind).join(", ")}` : s.merge.kind;
  return [s.stage, ci, merge, s.headline, s.tone,
    seconds(nextPollDelay(s.ci.kind, input.snapshot.pr.state))];
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

test("stale: the PR's head is not the commit checked out here", () => {
  const s = snapshotOf(SETTLED, 2);
  assert.equal(staleCheckout(s.pr, s.pr.head), false);
  assert.equal(staleCheckout(s.pr, "0000000000000000000000000000000000000000"), true);
  assert.equal(staleCheckout(s.pr, null), false, "where the checkout is not known");
  const merged = snapshotOf(PASSED);
  assert.equal(merged.pr.state, "MERGED");
  assert.equal(staleCheckout(merged.pr, "0000000000000000000000000000000000000000"), false);
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

test("synthetic: GitHub's HAS_HOOKS is as ready as CLEAN, and Merge is offered on it", () => {
  const s = summarize(snapshotOf(SETTLED, 2, (pr) => { pr.mergeStateStatus = "HAS_HOOKS"; }));
  assert.deepEqual([s.merge, s.headline, offersMerge(s)], [{ kind: "ready", clean: true, note: null }, "Ready to merge", true]);
});

test("synthetic: a required check that was cancelled blocks the merge as one that failed does, not as a branch rule", () => {
  const s = summarize(snapshotOf(PASSED, 1, (pr, commit) => {
    Object.assign(pr, { state: "OPEN", mergeable: "MERGEABLE", mergeStateStatus: "BLOCKED" });
    Object.assign(run(commit, "e2e"), { conclusion: "CANCELLED", isRequired: true });
  }));
  assert.deepEqual([s.ci.kind, s.ci.basis, s.headline], ["cancel", "required", "1 required check cancelled"]);
  assert.deepEqual(s.merge.blockers.map((b) => b.kind), ["checks-failing"]);
});

test("synthetic: conflicts are told by either of GitHub's two words for them, and a draft by its merge state alone", () => {
  const blockers = (edit) => summarize(snapshotOf(SETTLED, 2, (pr) => Object.assign(pr, edit))).merge.blockers.map((b) => b.kind);
  assert.deepEqual(blockers({ mergeable: "CONFLICTING", mergeStateStatus: "UNKNOWN" }), ["conflicts"]);
  assert.deepEqual(blockers({ mergeable: "UNKNOWN", mergeStateStatus: "DIRTY" }), ["conflicts"]);
  assert.deepEqual(blockers({ mergeStateStatus: "DRAFT" }), ["draft"]);
});

test("synthetic: the checks done while others run are all that are not running, a skipped one too", () => {
  const s = summarize(snapshotOf(PENDING, 1, (_, commit) => { run(commit, "verify").conclusion = "SKIPPED"; }));
  assert.deepEqual([s.ci.all.skipping, s.headline], [1, "Checks running, 24 of 25 done"]);
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

test("the next poll keeps the steps of a finished job and does not ask for them again; a running job's are asked for", () => {
  const prev = snapshotOf(PENDING);
  const done = prev.checks.find((c) => c.completedAt !== null && c.steps.length > 0);
  const memory = prev.checks.find((c) => c.name === "memory");
  assert.ok(done, "the frame has a finished job with steps");
  const fresh = { ...prev, checks: prev.checks.map((c) => ({ ...c, steps: null })) };
  assert.equal(stepsWanted(fresh, done.id, 3)[0], done.id);
  const next = keepSteps(fresh, prev);
  const steps = (c) => next.checks.find((x) => x.id === c.id).steps;
  assert.deepEqual(steps(done), done.steps);
  assert.equal(steps(memory), null);
  assert.equal(stepsWanted(next, done.id, 3).includes(done.id), false);
  assert.equal(stepsWanted(next, memory.id, 3)[0], memory.id);
});

test("synthetic: a selected job still in progress is asked for once, though every step read of it so far has finished", () => {
  const recorded = snapshotOf(RUNNING);
  const job = recorded.checks.find((c) => c.name === "browser-tests (5)");
  assert.deepEqual([job.state, job.completedAt, job.steps.some((step) => step.bucket !== "pending")], ["IN_PROGRESS", null, true]);
  const between = { ...recorded, checks: recorded.checks.map((c) => (c.id === job.id ? { ...c, steps: c.steps.filter((step) => step.bucket !== "pending") } : c)) };
  const wanted = stepsWanted(between, job.id, 6);
  assert.deepEqual([wanted[0], wanted.filter((id) => id === job.id).length], [job.id, 1]);
});

test("synthetic: a finished job's steps read while one of them still ran are not kept, and are asked for again", () => {
  const prev = snapshotOf(PENDING);
  const done = prev.checks.find((c) => c.completedAt !== null && c.steps.length > 0);
  const lagging = { ...prev, checks: prev.checks.map((c) => (c.id === done.id ? { ...c, steps: c.steps.map((step, i) => (i === 0 ? { ...step, state: "IN_PROGRESS", bucket: "pending" } : step)) } : c)) };
  assert.equal(stepsWanted(lagging, done.id, 3)[0], done.id);
  const fresh = { ...prev, checks: prev.checks.map((c) => ({ ...c, steps: null })) };
  assert.equal(keepSteps(fresh, lagging).checks.find((c) => c.id === done.id).steps, null);
});

test("failures that wait on the person stop polling; offline and unknown ones back off from 15 seconds, doubling to 5 minutes", () => {
  const delays = (kind) => [1, 2, 3, 4, 5, 6, 7, 8].map((streak) => failureDelay({ failure: { kind, text: "" }, streak, resetAt: null }));
  for (const kind of ["no-gh", "no-auth", "no-repo"]) assert.deepEqual(delays(kind), Array(8).fill(null), kind);
  for (const kind of ["offline", "unknown"]) assert.deepEqual(delays(kind), [15_000, 30_000, 60_000, 120_000, 240_000, 300_000, 300_000, 300_000], kind);
  assert.deepEqual(delays("rate-limited"), Array(8).fill(300_000));
  assert.deepEqual(delays("no-pr"), Array(8).fill(30_000));
});

test("a failure of the same kind as the last one lengthens the streak; another kind starts it over", () => {
  const offline = { kind: "offline", text: "" };
  const twice = troubleAfter(troubleAfter(null, offline, null), offline, 5_000);
  assert.deepEqual(twice, { failure: offline, streak: 2, resetAt: 5_000 });
  assert.deepEqual(troubleAfter(twice, { kind: "unknown", text: "x" }, null), { failure: { kind: "unknown", text: "x" }, streak: 1, resetAt: null });
});

test("a poll's wait follows the checks while the pull request is open, and stops once it is merged or closed", () => {
  assert.deepEqual(["pending", "none", "pass", "fail", "cancel"].map((kind) => nextPollDelay(kind, "OPEN")), [10_000, 30_000, 60_000, 60_000, 60_000]);
  assert.equal(nextPollDelay("pending", "MERGED"), null);
  assert.equal(nextPollDelay("pending", "CLOSED"), null);
});

