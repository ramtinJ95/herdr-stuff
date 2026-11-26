/** @typedef {import("./github.js").Target} Target */

const STEP_FIELDS = "{ nodes { number name status conclusion startedAt completedAt } }";

const CONTEXTS = `
  totalCount
  nodes {
    __typename
    ... on CheckRun {
      id name status conclusion startedAt completedAt detailsUrl
      isRequired(pullRequestNumber: $number)
      checkSuite { app { slug } workflowRun { databaseId event workflow { name } } }
      steps(first: 60) @include(if: $steps) ${STEP_FIELDS}
    }
    ... on StatusContext {
      id context state description targetUrl
      isRequired(pullRequestNumber: $number)
    }
  }`;

/** The poll. The repository's merge methods ride along, so Merge needs no call of its own. */
export const PR_QUERY = `
query($owner: String!, $name: String!, $number: Int!, $steps: Boolean!) {
  rateLimit { cost remaining resetAt }
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

export const STEPS_QUERY = `
query($ids: [ID!]!) {
  rateLimit { cost remaining }
  nodes(ids: $ids) { ... on CheckRun { id steps(first: 60) ${STEP_FIELDS} } }
}`;

/** What a person wrote and who is on it. None of it moves with CI, so the pane asks again only when the PR's `updatedAt` moves. */
export const ABOUT_QUERY = `
query($owner: String!, $name: String!, $number: Int!) {
  rateLimit { cost remaining }
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      body createdAt updatedAt
      author { login }
      labels(first: 20) { nodes { name } }
      latestOpinionatedReviews(first: 20) { nodes { state author { login } } }
      reviewRequests(first: 20) { nodes { requestedReviewer { __typename ... on Actor { login } ... on Team { name } } } }
      comments { totalCount }
      commits { totalCount }
    }
  }
}`;

/** The `gh api graphql` arguments for a query; `fields` are gh's `-f`/`-F` pairs. */
export const graphqlArgs = (host, query, fields) => ["api", "graphql", "--hostname", host, "-f", `query=${query}`, ...fields];

const prFields = (target) => ["-F", `owner=${target.owner}`, "-F", `name=${target.name}`, "-F", `number=${target.number}`];

/** @param {Target} target */
export const prArgs = (target, { steps = false } = {}) => graphqlArgs(target.host, PR_QUERY, [...prFields(target), "-F", `steps=${steps}`]);

/** @param {Target} target */
export const aboutArgs = (target) => graphqlArgs(target.host, ABOUT_QUERY, prFields(target));

/** The args for the steps of these check runs. GitHub rejects an empty list, so this throws on one. */
export function stepsArgs(ids, host = "github.com") {
  if (ids.length === 0) throw new Error("stepsArgs needs at least one check id");
  return graphqlArgs(host, STEPS_QUERY, ids.flatMap((id) => ["-f", `ids[]=${id}`]));
}
