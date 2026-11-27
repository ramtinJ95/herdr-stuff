/** @typedef {import("./github.js").Target} Target */

const STEP_FIELDS = "{ nodes { number name status conclusion startedAt completedAt } }";

const CONTEXTS = `
  totalCount
  nodes {
    __typename
    ... on CheckRun {
      id name status conclusion startedAt completedAt detailsUrl
      isRequired(pullRequestNumber: $number)
      checkSuite { app { slug } workflowRun { event workflow { name } } }
      steps(first: 60) @include(if: $steps) ${STEP_FIELDS}
    }
    ... on StatusContext {
      id context state description targetUrl
      isRequired(pullRequestNumber: $number)
    }
  }`;

/** The poll. The repository's merge methods ride along, so Merge needs no call of its own. */
const PR_QUERY = `
query($owner: String!, $name: String!, $number: Int!, $steps: Boolean!) {
  rateLimit { resetAt }
  repository(owner: $owner, name: $name) {
    viewerDefaultMergeMethod mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed
    pullRequest(number: $number) {
      number title url state isDraft updatedAt
      headRefName headRefOid baseRefName
      mergeable mergeStateStatus reviewDecision
      additions deletions changedFiles
      commits(last: 1) { nodes { commit { statusCheckRollup { state contexts(first: 100) {${CONTEXTS}
      } } } } }
    }
  }
}`;

const STEPS_QUERY = `
query($ids: [ID!]!) {
  nodes(ids: $ids) { ... on CheckRun { id steps(first: 60) ${STEP_FIELDS} } }
}`;

const SAID = "author { login } body createdAt url";

/**
 * What people wrote and who is on it: the description, the conversation under it and the threads on the diff's lines.
 * None of it moves with CI, so the pane asks again only when the PR's `updatedAt` moves, or after it has written there itself.
 */
const ABOUT_QUERY = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      id body createdAt updatedAt viewerDidAuthor
      author { login }
      labels(first: 20) { nodes { name } }
      latestOpinionatedReviews(first: 20) { nodes { state author { login } } }
      reviewRequests(first: 20) { nodes { requestedReviewer { ... on Actor { login } ... on Team { name } } } }
      comments(last: 30) { totalCount nodes { ${SAID} } }
      reviews(last: 30) { totalCount nodes { state submittedAt ${SAID} } }
      reviewThreads(first: 100) {
        totalCount
        nodes {
          id isResolved isOutdated path line startLine originalLine diffSide startDiffSide
          viewerCanReply viewerCanResolve viewerCanUnresolve
          comments(first: 30) { totalCount nodes { ${SAID} } }
        }
      }
      commits { totalCount }
    }
  }
}`;

/** One more comment at the end of a thread. */
const REPLY_MUTATION = `
mutation($thread: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $thread, body: $body }) { comment { url } }
}`;

const RESOLVED = "thread { id isResolved }";
const RESOLVE_MUTATION = `mutation($thread: ID!) { resolveReviewThread(input: { threadId: $thread }) { ${RESOLVED} } }`;
const UNRESOLVE_MUTATION = `mutation($thread: ID!) { unresolveReviewThread(input: { threadId: $thread }) { ${RESOLVED} } }`;

/** The `gh api graphql` arguments for a query; `fields` are gh's `-f`/`-F` pairs. */
export const graphqlArgs = (host, query, fields) => ["api", "graphql", "--hostname", host, "-f", `query=${query}`, ...fields];

const prFields = (target) => ["-F", `owner=${target.owner}`, "-F", `name=${target.name}`, "-F", `number=${target.number}`];

/** @param {Target} target */
export const prArgs = (target, { steps = false } = {}) => graphqlArgs(target.host, PR_QUERY, [...prFields(target), "-F", `steps=${steps}`]);

/** @param {Target} target */
export const aboutArgs = (target) => graphqlArgs(target.host, ABOUT_QUERY, prFields(target));

/** `-f` sends the words as they are: `-F` would read a body of `true`, `12` or `@file` as something else. */
export const replyArgs = (host, thread, body) => graphqlArgs(host, REPLY_MUTATION, ["-f", `thread=${thread}`, "-f", `body=${body}`]);

/** Resolves a thread, or with `resolved` false opens it again. */
export const resolveArgs = (host, thread, resolved) => graphqlArgs(host, resolved ? RESOLVE_MUTATION : UNRESOLVE_MUTATION, ["-f", `thread=${thread}`]);

/** A value as GraphQL writes it in a query: a string as JSON writes one, a number as it is. */
const literal = (value) => (typeof value === "number" ? String(value) : JSON.stringify(value));

/**
 * Posts a review with its line comments in one call. The values are written into the mutation itself: gh's flags
 * cannot say a list of comments (it gathers `-f` and `-F` fields apart, so a comment's words and its line number land in
 * different comments), and gh has no stdin here to read a body from.
 * @param {string} id the pull request's node id
 * @param {import("./send.js").Posting} posting
 */
export function reviewArgs(host, id, { commit, event, body, comments }) {
  const thread = ({ path, startLine, startSide, line, side, body }) => `{ path: ${literal(path)}, `
    + `${startLine === undefined ? "" : `startLine: ${startLine}, startSide: ${startSide}, `}line: ${line}, side: ${side}, body: ${literal(body)} }`;
  return graphqlArgs(host, `mutation {
  addPullRequestReview(input: { pullRequestId: ${literal(id)}, commitOID: ${literal(commit)}, event: ${event}, body: ${literal(body)}, threads: [${comments.map(thread).join(", ")}] }) {
    pullRequestReview { url }
  }
}`, []);
}

/**
 * The files a pull request changes, each with its diff, from GitHub's REST API: GraphQL has no diffs.
 * `--slurp` prints the pages as one list of lists.
 * @param {Target} target
 */
export const filesArgs = (target) =>
  ["api", "--hostname", target.host, `repos/${target.owner}/${target.name}/pulls/${target.number}/files?per_page=100`, "--paginate", "--slurp"];

/** gh's own lookup of the pull request for the branch checked out in the folder it runs in. */
export const lookupArgs = () => ["pr", "view", "--json", "url"];

/** The args for the steps of these check runs. GitHub rejects an empty list, so this throws on one. */
export function stepsArgs(host, ids) {
  if (ids.length === 0) throw new Error("stepsArgs needs at least one check id");
  return graphqlArgs(host, STEPS_QUERY, ids.flatMap((id) => ["-f", `ids[]=${id}`]));
}
