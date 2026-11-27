import { test } from "node:test";
import assert from "node:assert/strict";
import { aboutArgs, filesArgs, prArgs, replyArgs, resolveArgs, reviewArgs, stepsArgs } from "./query.js";
import { HEAD } from "./samples.js";

const TARGET = { host: "ghe.example.com", owner: "team", name: "app", number: 7 };
/** The arguments without the query's own text, and that text. */
const around = (args) => [args.filter((arg) => !arg.startsWith("query=")), args.find((arg) => arg.startsWith("query="))];

test("the poll and the description are asked of the pull request's host, with its owner, name and number as the query's variables", () => {
  const [poll, pollQuery] = around(prArgs(TARGET));
  assert.deepEqual(poll, ["api", "graphql", "--hostname", "ghe.example.com", "-f", "-F", "owner=team", "-F", "name=app", "-F", "number=7", "-F", "steps=false"]);
  assert.match(pollQuery, /^query=\s*query\(\$owner: String!, \$name: String!, \$number: Int!, \$steps: Boolean!\) \{\s+rateLimit /);
  assert.equal(prArgs(TARGET, { steps: true }).at(-1), "steps=true");
  const [about, aboutQuery] = around(aboutArgs(TARGET));
  assert.deepEqual(about, ["api", "graphql", "--hostname", "ghe.example.com", "-f", "-F", "owner=team", "-F", "name=app", "-F", "number=7"]);
  assert.match(aboutQuery, /^query=\s*query\(\$owner: String!, \$name: String!, \$number: Int!\) \{[^]*reviewThreads\(first: 100\)/);
});

test("the files are asked of the pull request's host, every page of them as one list of pages", () => {
  assert.deepEqual(filesArgs(TARGET), ["api", "--hostname", "ghe.example.com", "repos/team/app/pulls/7/files?per_page=100", "--paginate", "--slurp"]);
});

test("the steps query passes each id as one entry of the ids list, and refuses none", () => {
  const [args, query] = around(stepsArgs("github.com", ["CR_a", "CR_b"]));
  assert.deepEqual(args, ["api", "graphql", "--hostname", "github.com", "-f", "-f", "ids[]=CR_a", "-f", "ids[]=CR_b"]);
  assert.match(query, /^query=\s*query\(\$ids: \[ID!\]!\) \{\s+nodes\(ids: \$ids\) /);
  assert.throws(() => stepsArgs("github.com", []));
});

test("a review goes to GitHub as one mutation with its values written in: words as JSON writes them, lines as numbers", () => {
  const posting = { commit: HEAD, event: "COMMENT", body: "Say \"hi\"\n@all", comments: [
    { path: "src/a.js", startLine: 2, startSide: "LEFT", line: 3, side: "RIGHT", body: "12" }, { path: "b.js", line: 9, side: "RIGHT", body: "It is `x\\y`." }] };
  const args = reviewArgs("github.com", "PR_1", posting);
  assert.deepEqual([args.slice(0, 5), args.length], [["api", "graphql", "--hostname", "github.com", "-f"], 6]);
  assert.equal(args[5], [
    "query=mutation {",
    `  addPullRequestReview(input: { pullRequestId: "PR_1", commitOID: "${HEAD}", event: COMMENT, body: "Say \\"hi\\"\\n@all", threads: [`
      + "{ path: \"src/a.js\", startLine: 2, startSide: LEFT, line: 3, side: RIGHT, body: \"12\" }, "
      + "{ path: \"b.js\", line: 9, side: RIGHT, body: \"It is `x\\\\y`.\" }] }) {",
    "    pullRequestReview { url }",
    "  }",
    "}",
  ].join("\n"));
  assert.match(reviewArgs("github.com", "PR_1", { commit: HEAD, event: "APPROVE", body: "", comments: [] })[5], /event: APPROVE, body: "", threads: \[\] \}\)/);
});

test("a reply, a resolve and a reopen are each their own mutation on the thread, the reply's words sent as they are", () => {
  const [reply, replyQuery] = around(replyArgs("ghe.example.com", "T1", "@you true"));
  assert.deepEqual(reply, ["api", "graphql", "--hostname", "ghe.example.com", "-f", "-f", "thread=T1", "-f", "body=@you true"]);
  assert.match(replyQuery, /\{\s+addPullRequestReviewThreadReply\(input: \{ pullRequestReviewThreadId: \$thread, body: \$body \}\)/);
  const [resolve, resolveQuery] = around(resolveArgs("ghe.example.com", "T1", true));
  const [reopen, reopenQuery] = around(resolveArgs("ghe.example.com", "T1", false));
  assert.deepEqual([resolve, reopen], Array(2).fill(["api", "graphql", "--hostname", "ghe.example.com", "-f", "-f", "thread=T1"]));
  assert.match(resolveQuery, /\{ resolveReviewThread\(input: \{ threadId: \$thread \}\)/);
  assert.match(reopenQuery, /\{ unresolveReviewThread\(input: \{ threadId: \$thread \}\)/);
});

