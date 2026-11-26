/** @typedef {"no-gh" | "no-auth" | "no-repo" | "no-pr" | "offline" | "rate-limited" | "unknown"} FailureKind */
/** @typedef {{ kind: FailureKind, text: string }} Failure */
/** @typedef {"pass" | "fail" | "pending" | "skipping" | "cancel"} Bucket */
/** @typedef {{ number: number, name: string, state: string, bucket: Bucket, startedAt: string | null, completedAt: string | null }} Step */
/**
 * @typedef {{ id: string, kind: "run" | "status", name: string, workflow: string | null, event: string | null, app: string | null,
 *   state: string, bucket: Bucket, required: boolean, startedAt: string | null, completedAt: string | null, link: string | null,
 *   description: string | null, steps: Step[] | null }} Check
 */
/** Where a pull request lives. @typedef {{ host: string, owner: string, name: string, number: number }} Target */
/**
 * `resetAt` is when the rate limit starts over, in ms.
 * @typedef {{ pr: { number: number, title: string, url: string, state: "OPEN" | "CLOSED" | "MERGED", draft: boolean, head: string,
 *   headRef: string, baseRef: string, mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN",
 *   mergeState: "CLEAN" | "HAS_HOOKS" | "UNSTABLE" | "BLOCKED" | "BEHIND" | "DIRTY" | "DRAFT" | "UNKNOWN",
 *   review: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null, additions: number, deletions: number, files: number,
 *   updatedAt: string }, checks: Check[], hidden: number, resetAt: number | null }} Snapshot
 */

/**
 * What a person wrote on a PR and who is on it. `asked` holds the reviewers asked who have not answered; null is one GitHub does not name.
 * @typedef {{ body: string, author: string | null, createdAt: string, updatedAt: string, labels: string[],
 *   reviews: { who: string | null, state: "APPROVED" | "CHANGES_REQUESTED" | "DISMISSED" | "COMMENTED" | "PENDING" }[],
 *   asked: (string | null)[], comments: number, commits: number }} About
 */

/** A failure thrown by the parsers here; `kind` is a FailureKind. */
export class GhError extends Error {
  /** @param {FailureKind} kind @param {string} text */
  constructor(kind, text) {
    super(text);
    this.kind = kind;
    this.text = text;
  }
}

/** gh's own rules for what a check's state means (gh pr checks, aggregate.go); any other state is pending. */
const BUCKETS = new Map([
  ["SUCCESS", "pass"],
  ["SKIPPED", "skipping"], ["NEUTRAL", "skipping"],
  ["ERROR", "fail"], ["FAILURE", "fail"], ["TIMED_OUT", "fail"], ["ACTION_REQUIRED", "fail"],
  ["CANCELLED", "cancel"],
]);
const bucketOf = (state) => BUCKETS.get(state) ?? "pending";
const runState = (status, conclusion) => (status === "COMPLETED" ? conclusion ?? "" : status);

const PR_STATES = ["OPEN", "CLOSED", "MERGED"];
const MERGEABLE = ["MERGEABLE", "CONFLICTING", "UNKNOWN"];
const MERGE_STATES = ["CLEAN", "HAS_HOOKS", "UNSTABLE", "BLOCKED", "BEHIND", "DIRTY", "DRAFT", "UNKNOWN"];
const REVIEWS = ["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED", null];
const REVIEW_STATES = ["APPROVED", "CHANGES_REQUESTED", "DISMISSED", "COMMENTED", "PENDING"];

const unread = (path, value) => {
  throw new GhError("unknown", `GitHub answered ${JSON.stringify(value)} at ${path}, which this pane does not read`);
};
const is = (test) => (value, path) => (test(value) ? value : unread(path, value));
const str = is((v) => typeof v === "string");
const strOrNull = is((v) => v === null || typeof v === "string");
const int = is(Number.isInteger);
const bool = is((v) => typeof v === "boolean");
const obj = is((v) => typeof v === "object" && v !== null);
const list = is(Array.isArray);
const oneOf = (values) => is((v) => values.includes(v));

/** @returns {Step[]} */
function steps(raw, path) {
  return list(obj(raw, path).nodes, `${path}.nodes`).map((s, i) => {
    const at = `${path}.nodes[${i}]`;
    const state = runState(str(s.status, `${at}.status`), strOrNull(s.conclusion, `${at}.conclusion`));
    return { number: int(s.number, `${at}.number`), name: str(s.name, `${at}.name`), state, bucket: bucketOf(state),
      startedAt: strOrNull(s.startedAt, `${at}.startedAt`), completedAt: strOrNull(s.completedAt, `${at}.completedAt`) };
  });
}

/** @returns {Check} */
function context(n, path) {
  if (n.__typename === "StatusContext") {
    const state = str(n.state, `${path}.state`);
    return { id: str(n.id, `${path}.id`), kind: "status", name: str(n.context, `${path}.context`), workflow: null, event: null, app: null,
      state, bucket: bucketOf(state), required: bool(n.isRequired, `${path}.isRequired`), startedAt: null, completedAt: null,
      link: strOrNull(n.targetUrl, `${path}.targetUrl`), description: strOrNull(n.description, `${path}.description`), steps: null };
  }
  if (n.__typename !== "CheckRun") unread(`${path}.__typename`, n.__typename);
  const suite = obj(n.checkSuite, `${path}.checkSuite`);
  const run = suite.workflowRun === null ? null : obj(suite.workflowRun, `${path}.checkSuite.workflowRun`);
  const state = runState(str(n.status, `${path}.status`), strOrNull(n.conclusion, `${path}.conclusion`));
  return {
    id: str(n.id, `${path}.id`), kind: "run", name: str(n.name, `${path}.name`),
    workflow: run === null ? null : str(obj(run.workflow, `${path}.checkSuite.workflowRun.workflow`).name, `${path}.checkSuite.workflowRun.workflow.name`),
    event: run === null ? null : str(run.event, `${path}.checkSuite.workflowRun.event`),
    app: suite.app === null ? null : str(obj(suite.app, `${path}.checkSuite.app`).slug, `${path}.checkSuite.app.slug`),
    state, bucket: bucketOf(state), required: bool(n.isRequired, `${path}.isRequired`),
    startedAt: strOrNull(n.startedAt, `${path}.startedAt`), completedAt: strOrNull(n.completedAt, `${path}.completedAt`),
    link: strOrNull(n.detailsUrl, `${path}.detailsUrl`), description: null,
    steps: n.steps === undefined ? null : steps(n.steps, `${path}.steps`),
  };
}

const startTime = (c) => (c.startedAt === null ? 0 : Date.parse(c.startedAt));
const dedupKey = (c) => (c.kind === "status" ? `status:${c.name}` : `run:${c.name}/${c.workflow ?? ""}/${c.event ?? ""}`);

/** gh's eliminateDuplicates: latest start first, then the first check per context, or per name, workflow and event. */
function latestOnly(checks) {
  const seen = new Set();
  return [...checks].sort((a, b) => startTime(b) - startTime(a)).filter((c) => {
    const key = dedupKey(c);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const chunks = (s) => s.toLowerCase().match(/\d+|\D+/g) ?? [];
/** Text order where digit runs compare as numbers, so "shard (10)" follows "shard (9)". */
function natural(a, b) {
  const x = chunks(a), y = chunks(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] === y[i]) continue;
    const numeric = /^\d/.test(x[i]) && /^\d/.test(y[i]) ? Number(x[i]) - Number(y[i]) : 0;
    if (numeric !== 0) return numeric;
    return x[i] < y[i] ? -1 : 1;
  }
  return x.length - y.length || (a < b ? -1 : a > b ? 1 : 0);
}
const displayOrder = (a, b) => (a.workflow === null) - (b.workflow === null) || natural(a.workflow ?? "", b.workflow ?? "")
  || natural(a.name, b.name) || natural(a.link ?? "", b.link ?? "");

const failureOf = (errors) => {
  const text = errors.map((e) => e.message).join("\n");
  return new GhError(errors.some((e) => e.type === "RATE_LIMITED") ? "rate-limited" : kindOf(text), text);
};

/** The pull request in a PR_QUERY or ABOUT_QUERY answer, `{ data, errors }` as gh prints it. Throws a GhError when the answer has errors. */
function pullRequestOf(raw) {
  if (Array.isArray(raw?.errors) && raw.errors.length > 0) throw failureOf(raw.errors);
  const data = obj(raw?.data, "data");
  return { data, p: obj(obj(data.repository, "data.repository").pullRequest, "data.repository.pullRequest") };
}
const at = (field) => `pullRequest.${field}`;

/** A recorded frame as the answer gh printed for it. */
export const frameAnswer = (frame) => ({ data: { rateLimit: frame.rateLimit ?? null, repository: { pullRequest: frame.pr } }, errors: frame.errors ?? null });

/**
 * The Snapshot in a PR_QUERY answer. Throws a GhError when the answer has errors or a field this pane does not read.
 * @returns {Snapshot}
 */
export function parsePr(raw) {
  const { data, p } = pullRequestOf(raw);
  const commit = obj(obj(list(obj(p.commits, at("commits")).nodes, at("commits.nodes"))[0], at("commits.nodes[0]")).commit, at("commits.nodes[0].commit"));
  const rollup = commit.statusCheckRollup === null ? null : obj(commit.statusCheckRollup, "statusCheckRollup");
  const contexts = rollup === null ? null : obj(rollup.contexts, "statusCheckRollup.contexts");
  const nodes = contexts === null ? [] : list(contexts.nodes, "statusCheckRollup.contexts.nodes");
  const limit = data.rateLimit ?? null;
  return {
    pr: {
      number: int(p.number, at("number")), title: str(p.title, at("title")), url: str(p.url, at("url")),
      state: oneOf(PR_STATES)(p.state, at("state")), draft: bool(p.isDraft, at("isDraft")),
      head: str(p.headRefOid, at("headRefOid")), headRef: str(p.headRefName, at("headRefName")), baseRef: str(p.baseRefName, at("baseRefName")),
      mergeable: oneOf(MERGEABLE)(p.mergeable, at("mergeable")),
      mergeState: oneOf(MERGE_STATES)(p.mergeStateStatus, at("mergeStateStatus")), review: oneOf(REVIEWS)(p.reviewDecision, at("reviewDecision")),
      additions: int(p.additions, at("additions")), deletions: int(p.deletions, at("deletions")), files: int(p.changedFiles, at("changedFiles")),
      updatedAt: str(p.updatedAt, at("updatedAt")),
    },
    checks: latestOnly(nodes.map((n, i) => context(obj(n, `contexts.nodes[${i}]`), `contexts.nodes[${i}]`))).sort(displayOrder),
    hidden: contexts === null ? 0 : int(contexts.totalCount, "statusCheckRollup.contexts.totalCount") - nodes.length,
    resetAt: limit === null ? null : Date.parse(str(obj(limit, "rateLimit").resetAt, "rateLimit.resetAt")),
  };
}

/**
 * The About in an ABOUT_QUERY answer. Throws a GhError as `parsePr` does. An account GitHub deleted answers a null author,
 * and a team the person may not see a null reviewer.
 * @returns {About}
 */
export function parseAbout(raw) {
  const { p } = pullRequestOf(raw);
  const nodes = (field) => list(obj(p[field], at(field)).nodes, at(`${field}.nodes`));
  const count = (field) => int(obj(p[field], at(field)).totalCount, at(`${field}.totalCount`));
  const named = (actor, path) => (actor === null ? null : str(obj(actor, path).login ?? actor.name, path));
  return {
    body: str(p.body, at("body")), author: named(p.author, at("author")),
    createdAt: str(p.createdAt, at("createdAt")), updatedAt: str(p.updatedAt, at("updatedAt")),
    labels: nodes("labels").map((l, i) => str(obj(l, at(`labels.nodes[${i}]`)).name, at(`labels.nodes[${i}].name`))),
    reviews: nodes("latestOpinionatedReviews").map((r, i) => {
      const path = at(`latestOpinionatedReviews.nodes[${i}]`);
      return { who: named(obj(r, path).author, `${path}.author`), state: oneOf(REVIEW_STATES)(r.state, `${path}.state`) };
    }),
    asked: nodes("reviewRequests").map((r, i) => named(obj(r, at(`reviewRequests.nodes[${i}]`)).requestedReviewer, at(`reviewRequests.nodes[${i}].requestedReviewer`))),
    comments: count("comments"), commits: count("commits"),
  };
}

/**
 * The snapshot with steps from a STEPS_QUERY answer set on the checks it names. A run that no longer resolves comes back
 * null beside an error, and gh exits 1 while printing the rest, so pass that stdout too: the runs that did resolve merge.
 * @param {Snapshot} snapshot
 * @returns {Snapshot}
 */
export function mergeSteps(snapshot, raw) {
  if (!Array.isArray(raw?.data?.nodes)) throw failureOf(Array.isArray(raw?.errors) ? raw.errors : [{ message: "GitHub answered no steps" }]);
  const found = new Map(raw.data.nodes.flatMap((n, i) =>
    n === null || n.id === undefined ? [] : [[str(n.id, `nodes[${i}].id`), steps(n.steps, `nodes[${i}].steps`)]]));
  return { ...snapshot, checks: snapshot.checks.map((c) => (found.has(c.id) ? { ...c, steps: found.get(c.id) } : c)) };
}

const PR_URL = /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#].*)?$/;
const targetOf = (m) => ({ host: m[1], owner: m[2], name: m[3], number: Number(m[4]) });

/** gh's own lookup of the pull request for the branch checked out in the folder it runs in. */
export function prLookupArgs() {
  return ["pr", "view", "--json", "number,url,state,headRefName,headRefOid"];
}

/** Where the pull request lives, from `prLookupArgs()`'s stdout. */
export function parseLookup(stdout) {
  let url;
  try {
    url = JSON.parse(stdout).url;
  } catch {
    throw new GhError("unknown", `gh pr view printed something other than JSON: ${stdout.slice(0, 200)}`);
  }
  const m = typeof url === "string" ? PR_URL.exec(url) : null;
  if (m === null) throw new GhError("unknown", `gh pr view gave no pull request URL: ${stdout.slice(0, 200)}`);
  return targetOf(m);
}

/**
 * Where the pull request a person named lives: `owner/name#12` on github.com, or its URL on any host, with or without
 * a page under it. Throws a GhError when it is neither.
 * @returns {Target}
 */
export function parsePin(text) {
  const named = typeof text === "string" ? text.trim() : "";
  const short = /^([\w.-]+)\/([\w.-]+)#(\d+)$/.exec(named);
  if (short !== null) return { host: "github.com", owner: short[1], name: short[2], number: Number(short[3]) };
  const url = PR_URL.exec(named);
  if (url === null) throw new GhError("unknown", `${JSON.stringify(text)} is not owner/name#number or a pull request's URL`);
  return targetOf(url);
}

/** What gh's stderr says went wrong, first match wins. The README lists which texts were seen from a real gh. */
const STDERR = [
  ["no-repo", /not a git repository|no git remotes found|none of the git remotes configured for this repository point to a known GitHub host|Could not resolve to a Repository/],
  ["no-auth", /Bad credentials|HTTP 401/],
  ["no-pr", /no pull requests found for branch|could not determine current branch|Could not resolve to a PullRequest/],
  ["rate-limited", /rate limit/i],
  ["offline", /dial tcp|no such host|network is unreachable|connection refused|i\/o timeout|TLS handshake timeout|connection reset/],
];
const kindOf = (text) => STDERR.find(([, test]) => test.test(text))?.[0] ?? "unknown";

/** What a gh run that exited non-zero failed on. Exit 4 is gh's own code for "not logged in". @returns {Failure} */
export function classifyFailure({ code, stderr }) {
  const text = stderr.trim() || `gh exited ${code}`;
  return { kind: code === 4 ? "no-auth" : kindOf(text), text };
}

export const firstLine = (text) => text.split("\n")[0];

/**
 * A gh run read with `parse`: its value, or what went wrong, whether gh failed or `parse` threw.
 * @template T
 * @param {{ stdout: string, failure: Failure | null }} result
 * @param {(stdout: string) => T} parse
 * @returns {{ value: T, failure: null } | { value: null, failure: Failure }}
 */
export function readAnswer(result, parse) {
  if (result.failure !== null) return { value: null, failure: result.failure };
  try {
    return { value: parse(result.stdout), failure: null };
  } catch (e) {
    return { value: null, failure: classifyRejection(e) };
  }
}

/** What a thrown error means: a GhError from the parsers here, or a rejected `exec` (gh missing, a timeout). @returns {Failure} */
export function classifyRejection(error) {
  if (error instanceof GhError) return { kind: error.kind, text: error.text };
  const text = error instanceof Error ? error.message : String(error);
  if (/No such file or directory|not found/i.test(text)) return { kind: "no-gh", text };
  if (/timed out/i.test(text)) return { kind: "offline", text };
  return { kind: "unknown", text };
}
