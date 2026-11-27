import { test } from "node:test";
import assert from "node:assert/strict";
import { GhError, byName, classifyFailure, classifyRejection, frameAnswer, mergeSteps, parseAbout, parseFiles, parseLookup, parsePin, parsePr, prKey, prRef, prUrl, repoSlug, shortSha } from "./github.js";
import { PASSED, PENDING, SETTLED, answerOf, failures, frame, readJson, sample, snapshotOf } from "./recorded.js";

const live = readJson("live.json");
const names = (list) => list.map((one) => one.name);
/** What `gh api repos/ramtinJ95/first-game/pulls/146/files --paginate --slurp` printed. */
const filesAnswer = () => readJson("files-first-game-146.json");

test("Merge would use the person's default method when the repository allows it, else the first it allows, else none", () => {
  const method = (flags) => parsePr(answerOf(SETTLED, 2, (_pr, _commit, repository) => Object.assign(repository, flags))).method;
  assert.equal(method({ viewerDefaultMergeMethod: "SQUASH", mergeCommitAllowed: true, squashMergeAllowed: true, rebaseMergeAllowed: false }), "squash");
  assert.equal(method({ viewerDefaultMergeMethod: "MERGE", mergeCommitAllowed: false, squashMergeAllowed: false, rebaseMergeAllowed: true }), "rebase");
  assert.equal(method({ viewerDefaultMergeMethod: "MERGE", mergeCommitAllowed: false, squashMergeAllowed: false, rebaseMergeAllowed: false }), null);
});

test("steps inline in a recording carry gh's states and buckets", () => {
  const memory = snapshotOf(PENDING).checks.find((c) => c.name === "memory");
  assert.deepEqual(memory.steps.map((x) => x.bucket), [...Array(9).fill("pass"), ...Array(5).fill("pending")]);
  assert.equal(memory.steps[9].state, "IN_PROGRESS");
});

test("the snapshot carries when the rate limit starts over", () => {
  assert.equal(snapshotOf(SETTLED, 2).resetAt, Date.UTC(2026, 10, 26, 18, 29, 13));
});

test("the checks come by workflow and then name, with numbers in order", () => {
  assert.deepEqual(names(snapshotOf(PENDING, 3).checks), [
    "browser-tests (1)", "browser-tests (2)", "browser-tests (3)", "browser-tests (4)", "browser-tests (5)", "browser-tests (6)",
    "browser-tests (7)", "browser-tests (8)", "capture",
    "capture-shards (1)", "capture-shards (2)", "capture-shards (3)", "capture-shards (4)", "capture-shards (5)", "capture-shards (6)",
    "capture-shards (7)", "capture-shards (8)", "capture-shards (9)", "capture-shards (10)", "capture-shards (11)",
    "e2e", "frame-benches", "memory", "publish-media", "verify",
  ]);
});

/** A commit status as GitHub lists one among the checks: what PR_QUERY asks of a StatusContext. */
const status = (context, state, id = `SC_${context}`) => ({ __typename: "StatusContext", id, context, state, description: null, targetUrl: null, isRequired: false });
/** Adds these checks to a commit's, counted as GitHub counts them. */
const add = (commit, ...nodes) => {
  commit.statusCheckRollup.contexts.nodes.push(...nodes);
  commit.statusCheckRollup.contexts.totalCount += nodes.length;
};

test("synthetic: each state is counted as gh pr checks counts it, and one gh does not name is pending", () => {
  const conclusions = { e2e: "TIMED_OUT", memory: "ACTION_REQUIRED", verify: "NEUTRAL", capture: "STALE", "publish-media": "SKIPPED", "frame-benches": "CANCELLED" };
  const snapshot = snapshotOf(PASSED, 1, (_pr, commit) => {
    for (const node of commit.statusCheckRollup.contexts.nodes) node.conclusion = conclusions[node.name] ?? node.conclusion;
    add(commit, status("errored", "ERROR"), status("expected", "EXPECTED"), status("passed", "SUCCESS"), status("failed", "FAILURE"));
  });
  const buckets = Object.fromEntries(snapshot.checks.filter((c) => c.kind === "status" || c.name in conclusions).map((c) => [c.name, c.bucket]));
  assert.deepEqual(buckets, { e2e: "fail", memory: "fail", verify: "skipping", capture: "pending", "publish-media": "skipping", "frame-benches": "cancel",
    errored: "fail", expected: "pending", passed: "pass", failed: "fail" });
  assert.equal(snapshot.hidden, 0);
});

test("synthetic: a job of one name is a check for each workflow and each event it ran on, and a commit status one for its context", () => {
  const snapshot = snapshotOf(SETTLED, 2, (_pr, commit) => {
    const [check] = commit.statusCheckRollup.contexts.nodes;
    const again = (id, workflow, event, extra = {}) => ({ ...structuredClone(check), id, detailsUrl: check.detailsUrl.replace(/\d+$/, "1"),
      checkSuite: { app: { slug: "github-actions" }, workflowRun: { event, workflow: { name: workflow } } }, ...extra });
    add(commit, status("a-status", "SUCCESS", "SC_1"), status("a-status", "PENDING", "SC_2"), again("CR_deploy", "Deploy", "pull_request"),
      again("CR_push", "CI", "push"), again("CR_upper", "CI", "pull_request", { name: "Verify" }), again("CR_bare", "CI", "pull_request", { name: "another-app", checkSuite: { app: { slug: "another-app" }, workflowRun: null } }));
  });
  assert.deepEqual(snapshot.checks.map((c) => [c.workflow, c.event, c.name]), [
    ["CI", "push", "check"], ["CI", "pull_request", "check"], ["CI", "pull_request", "Verify"], ["Deploy", "pull_request", "check"],
    [null, null, "a-status"], [null, null, "another-app"],
  ]);
  assert.equal(snapshot.hidden, 0, "a check left out as a repeat is not one GitHub did not return");
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
  assert.deepEqual(mergeSteps(merged, { data: { nodes: [live.steps.data.nodes[0]] } }), merged, "a check the answer does not name keeps the steps it has");
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
  assert.throws(() => mergeSteps(parsePr(live.pr), { errors: [{ type: "RATE_LIMITED", message: "Slow down." }] }),
    (e) => e instanceof GhError && e.kind === "rate-limited", "by the error's type, whatever its words");
  assert.throws(() => mergeSteps(parsePr(live.pr), { data: {} }), (e) => e instanceof GhError && e.kind === "unknown" && e.message === "GitHub answered no steps");
});

test("synthetic: a merge state this pane does not know is a GhError, not a guess", () => {
  const f = frame(SETTLED, 2);
  f.pr.mergeStateStatus = "SOMETHING_NEW";
  assert.throws(() => parsePr(frameAnswer(f)), (e) => e instanceof GhError && e.kind === "unknown");
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
  assert.throws(() => parseLookup('{"number":7}'), (e) => e instanceof GhError && /gave no pull request URL/.test(e.message));
  assert.throws(() => parseLookup('{"url":"https://github.com/cli/cli/issues/7"}'), (e) => e instanceof GhError && /gave no pull request URL/.test(e.message));
});

test("a pinned pull request is named owner/name#number, or by its URL with or without a page under it", () => {
  const cli = { host: "github.com", owner: "cli", name: "cli", number: 9000 };
  assert.deepEqual(parsePin("cli/cli#9000"), cli);
  assert.deepEqual(parsePin(" https://github.com/cli/cli/pull/9000 "), cli);
  assert.deepEqual(parsePin("https://github.com/cli/cli/pull/9000/files#diff-1"), cli);
  assert.deepEqual(parsePin("https://ghe.example.com/team/my.app/pull/7?w=1"), { host: "ghe.example.com", owner: "team", name: "my.app", number: 7 });
  assert.deepEqual(parsePin("http://ghe.example.com/team/my.app/pull/7"), { host: "ghe.example.com", owner: "team", name: "my.app", number: 7 });
  for (const bad of ["9000", "cli/cli", "cli/cli#x", "https://github.com/cli/cli/issues/9000", 9000, null]) {
    assert.throws(() => parsePin(bad), (e) => e instanceof GhError && e.kind === "unknown" && /owner\/name#number/.test(e.message), String(bad));
  }
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
  assert.deepEqual(classifyFailure({ code: 2, stdout: "", stderr: " \n" }), { kind: "unknown", text: "gh exited 2" });
  assert.deepEqual(classifyRejection(new Error("boom")), { kind: "unknown", text: "boom" });
  assert.deepEqual(classifyRejection("boom"), { kind: "unknown", text: "boom" });
});

test("synthetic: texts gh and Herdr are taken to print, none of them seen from a real one, read as their kind", () => {
  const kind = (stderr) => classifyFailure({ code: 1, stdout: "", stderr }).kind;
  assert.equal(kind("GraphQL: Could not resolve to a Repository with the name 'o/gone'. (repository)"), "no-repo");
  assert.equal(kind("gh: Requires authentication (HTTP 401)"), "no-auth");
  assert.equal(kind('Post "https://api.github.com/graphql": net/http: TLS handshake timeout'), "offline");
  assert.equal(kind('Post "https://api.github.com/graphql": read tcp 10.0.0.2:51234->140.82.121.6:443: read: connection reset by peer'), "offline");
  assert.equal(kind('Post "https://api.github.com/graphql": read tcp 10.0.0.2:51234->140.82.121.6:443: i/o timeout'), "offline");
  assert.deepEqual(classifyRejection(new Error("gh timed out after 20000 ms")), { kind: "offline", text: "gh timed out after 20000 ms" });
  assert.equal(classifyRejection(new Error("program not found: gh")).kind, "no-gh");
});

const aboutAnswer = () => readJson("about-first-game-146.json");

test("a recorded ABOUT_QUERY answer reads as who wrote what, when, with its counts", () => {
  const about = parseAbout(aboutAnswer());
  assert.equal(about.author, "ramtinJ95");
  assert.equal(about.createdAt, "2026-11-26T16:39:28Z");
  assert.equal(about.updatedAt, "2026-11-26T18:38:40Z");
  assert.equal(about.body.length, 3696);
  assert.deepEqual([about.labels, about.reviews, about.asked, about.comments, about.commits], [[], [], [], 0, 4]);
  assert.deepEqual([about.mine, about.talk, about.earlier, about.threads, about.threadsHidden], [true, [], 0, [], 0]);
});

test("a recorded pull request under review reads as its threads and the reviews that say something", () => {
  const about = parseAbout(readJson("about-cli-15081.json"));
  assert.equal(about.mine, false);
  // Six reviews were handed in: one with words, one approval, and four that only carry line comments.
  assert.deepEqual(about.talk.map((said) => [said.who, said.state, said.body.length > 0]), [["copilot-pull-request-reviewer", "COMMENTED", true], ["BagToad", "APPROVED", false]]);
  assert.ok(Date.parse(about.talk[0].at) < Date.parse(about.talk[1].at));
  assert.deepEqual([about.comments, about.earlier, about.threads.length, about.threadsHidden], [0, 0, 6, 0]);
  const [first, second] = about.threads;
  assert.deepEqual({ ...first, comments: first.comments.length, id: typeof first.id }, {
    id: "string", path: "pkg/cmd/event/shared/hint.go", line: 35, startLine: 33, side: "RIGHT", startSide: "RIGHT", was: 35, resolved: false, outdated: false,
    canReply: true, canResolve: false, canUnresolve: false, comments: 1, more: 0,
  });
  // GitHub names a one-line thread's line as its start as well.
  assert.deepEqual([second.line, second.startLine, second.startSide], [15, null, null]);
  assert.deepEqual(about.threads.map((thread) => [thread.resolved, thread.comments.length]), [[false, 1], [false, 1], [true, 2], [true, 2], [true, 2], [true, 2]]);
  assert.match(first.comments[0].url, /^https:\/\/github\.com\/cli\/cli\/pull\/15081#discussion_r\d+$/);
});

test("synthetic: the conversation is the comments and the reviews in the order they were written, without a review not handed in", () => {
  const raw = aboutAnswer();
  const said = (login, body, createdAt, extra = {}) => ({ author: login === null ? null : { login }, body, createdAt, url: `https://github.com/o/n/pull/1#${createdAt}`, ...extra });
  Object.assign(raw.data.repository.pullRequest, {
    comments: { totalCount: 40, nodes: [said("ada", "First.", "2026-11-20T10:00:00Z"), said(null, "Third.", "2026-11-20T12:00:00Z")] },
    reviews: { totalCount: 5, nodes: [
      said("bo", "Second.", "2026-11-20T09:00:00Z", { state: "CHANGES_REQUESTED", submittedAt: "2026-11-20T11:00:00Z" }),
      said("cy", "", "2026-11-20T11:30:00Z", { state: "COMMENTED", submittedAt: "2026-11-20T11:30:00Z" }),
      said("me", "Not yet.", "2026-11-20T13:00:00Z", { state: "PENDING", submittedAt: null }),
    ] },
    // As GitHub answered for an outdated thread of cli/cli#15100.
    reviewThreads: { totalCount: 101, nodes: [{
      id: "T1", isResolved: true, isOutdated: true, path: "a.go", line: null, startLine: null, originalLine: 175, diffSide: "RIGHT", startDiffSide: null,
      viewerCanReply: true, viewerCanResolve: false, viewerCanUnresolve: true, comments: { totalCount: 31, nodes: [said("ada", "Old.", "2026-11-20T10:00:00Z")] },
    }] },
  });
  const about = parseAbout(raw);
  assert.deepEqual(about.talk.map((one) => [one.who, one.body, one.state, one.at]), [
    ["ada", "First.", null, "2026-11-20T10:00:00Z"], ["bo", "Second.", "CHANGES_REQUESTED", "2026-11-20T11:00:00Z"], [null, "Third.", null, "2026-11-20T12:00:00Z"]]);
  assert.deepEqual([about.comments, about.earlier, about.threadsHidden], [40, 40, 100]);
  assert.deepEqual({ ...about.threads[0], comments: about.threads[0].comments.length }, {
    id: "T1", path: "a.go", line: null, startLine: null, side: "RIGHT", startSide: null, was: 175, resolved: true, outdated: true,
    canReply: true, canResolve: false, canUnresolve: true, comments: 1, more: 30,
  });
  raw.data.repository.pullRequest.reviewThreads.nodes[0].diffSide = "MIDDLE";
  assert.throws(() => parseAbout(raw), (e) => e instanceof GhError && /MIDDLE/.test(e.message));
});

test("synthetic: labels, reviews and asked reviewers read by name; a deleted author and an unnamed team read as null", () => {
  const raw = aboutAnswer();
  Object.assign(raw.data.repository.pullRequest, {
    author: null, labels: { nodes: [{ name: "external" }] },
    latestOpinionatedReviews: { nodes: [{ state: "APPROVED", author: { login: "ada" } }, { state: "CHANGES_REQUESTED", author: null }] },
    reviewRequests: { nodes: [{ requestedReviewer: { __typename: "User", login: "cy" } }, { requestedReviewer: { __typename: "Team", name: "core" } }, { requestedReviewer: null }] },
  });
  const about = parseAbout(raw);
  assert.equal(about.author, null);
  assert.deepEqual(about.labels, ["external"]);
  assert.deepEqual(about.reviews, [{ who: "ada", state: "APPROVED" }, { who: null, state: "CHANGES_REQUESTED" }]);
  assert.deepEqual(about.asked, ["cy", "core", null]);
});

test("synthetic: an ABOUT_QUERY answer with errors or a field this pane does not read is a GhError", () => {
  assert.throws(() => parseAbout({ data: null, errors: [{ type: "RATE_LIMITED", message: "API rate limit exceeded" }] }), (e) => e instanceof GhError && e.kind === "rate-limited");
  assert.throws(() => parseAbout({ data: null, errors: [{ type: "NOT_FOUND", message: "Could not resolve to a PullRequest with the number of 9." }, { type: "OTHER", message: "more" }] }),
    (e) => e instanceof GhError && e.kind === "no-pr" && e.message === "Could not resolve to a PullRequest with the number of 9.\nmore");
  const raw = aboutAnswer();
  raw.data.repository.pullRequest.latestOpinionatedReviews = { nodes: [{ state: "SHRUGGED", author: { login: "ada" } }] };
  assert.throws(() => parseAbout(raw), (e) => e instanceof GhError && /SHRUGGED/.test(e.message));
});

test("a recorded files answer reads as each file's path, status, counts and diff", () => {
  const files = parseFiles(filesAnswer());
  assert.deepEqual(files.map(({ patch, ...rest }) => rest), [
    { path: "scripts/cautious-rome.test.ts", previous: null, status: "modified", additions: 178, deletions: 3 },
    { path: "scripts/cautious-rome.ts", previous: null, status: "modified", additions: 105, deletions: 3 },
    { path: "scripts/sim/slide.ts", previous: null, status: "modified", additions: 5, deletions: 1 },
  ]);
  assert.ok(files.every((file) => file.patch.startsWith("@@ ")));
});

test("synthetic: a file GitHub gives no diff for has a null patch; a rename keeps its old path", () => {
  const raw = filesAnswer();
  delete raw[0][0].patch;
  Object.assign(raw[0][1], { status: "renamed", previous_filename: "scripts/old.ts" });
  const files = parseFiles(raw);
  assert.equal(files[0].patch, null);
  assert.deepEqual([files[1].status, files[1].previous], ["renamed", "scripts/old.ts"]);
});

test("synthetic: a file status this pane has not seen is refused, not drawn as something else", () => {
  const raw = filesAnswer();
  raw[0][0].status = "teleported";
  assert.throws(() => parseFiles(raw), GhError);
});

test("synthetic: pages of files read as one list, in order", () => {
  const [page] = filesAnswer();
  assert.deepEqual(parseFiles([page.slice(0, 2), page.slice(2)]).map((file) => file.path), parseFiles([page]).map((file) => file.path));
});


test("synthetic: a pull request, a commit and an author are written one way", () => {
  assert.equal(prRef(parsePin("cli/cli#15081")), "cli/cli#15081");
  assert.equal(prRef(parsePin("https://ghe.example.com/team/app/pull/7/files")), "team/app#7");
  const ghe = parsePin("https://ghe.example.com/team/app/pull/7");
  assert.deepEqual([prUrl(ghe), repoSlug(ghe), prKey(ghe)], ["https://ghe.example.com/team/app/pull/7", "ghe.example.com/team/app", "ghe.example.com/team/app#7"]);
  assert.deepEqual(parsePin(prUrl(ghe)), ghe);
  assert.equal(prKey(parsePin("RamtinJ95/First-Game#146")), "github.com/ramtinj95/first-game#146", "one name in what is stored, however the owner and the repository are cased");
  assert.equal(shortSha("94e5a03ca65b12a53bc7850e4d1835a7743f60f0"), "94e5a03");
  assert.equal(byName(null), "A deleted account");
  assert.equal(byName("ada"), "ada");
});
