const STEP_FIELDS = "{ nodes { number name status conclusion startedAt completedAt } }";

const CONTEXTS = `
  totalCount
  pageInfo { hasNextPage }
  nodes {
    __typename
    ... on CheckRun {
      id databaseId name status conclusion startedAt completedAt detailsUrl
      isRequired(pullRequestNumber: $number)
      checkSuite { app { slug } workflowRun { databaseId runNumber event workflow { name } } }
      steps(first: 60) @include(if: $steps) ${STEP_FIELDS}
    }
    ... on StatusContext {
      id context state description targetUrl createdAt
      isRequired(pullRequestNumber: $number)
    }
  }`;

export const PR_QUERY = `
query($owner: String!, $name: String!, $number: Int!, $steps: Boolean!) {
  rateLimit { cost remaining resetAt }
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      number title url state isDraft updatedAt
      headRefName headRefOid baseRefName isCrossRepository
      mergeable mergeStateStatus reviewDecision
      additions deletions changedFiles
      reviewThreads(first: 100) { nodes { isResolved } }
      commits(last: 1) { nodes { commit { oid committedDate statusCheckRollup { state contexts(first: 100) {${CONTEXTS}
      } } } } }
    }
  }
}`;

export const STEPS_QUERY = `
query($ids: [ID!]!) {
  rateLimit { cost remaining }
  nodes(ids: $ids) { ... on CheckRun { id steps(first: 60) ${STEP_FIELDS} } }
}`;

export const OPEN_PRS_QUERY = `
query($owner: String!, $name: String!) {
  rateLimit { cost remaining }
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: 20, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes { number headRefName headRefOid commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } }
    }
  }
}`;

export function prArgs(owner, name, number, steps, host = "github.com") {
  return ["api", "graphql", "--hostname", host, "-f", `query=${PR_QUERY}`, "-F", `owner=${owner}`, "-F", `name=${name}`, "-F", `number=${number}`, "-F", `steps=${steps}`];
}

/** The args for the steps of these check runs. GitHub rejects an empty list, so this throws on one. */
export function stepsArgs(ids, host = "github.com") {
  if (ids.length === 0) throw new Error("stepsArgs needs at least one check id");
  return ["api", "graphql", "--hostname", host, "-f", `query=${STEPS_QUERY}`, ...ids.flatMap((id) => ["-f", `ids[]=${id}`])];
}
