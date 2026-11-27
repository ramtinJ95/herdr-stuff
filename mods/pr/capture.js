import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lookupArgs, prArgs, stepsArgs } from "./query.js";

const [repo, number] = (process.argv[2] ?? "").split("#");
if (!repo || !number) {
  console.error("usage: node mods/pr/capture.js <owner/repo#N>");
  process.exit(2);
}
const [owner, name] = repo.split("/");
const out = new URL("./fixtures/", import.meta.url).pathname;
const tmp = mkdtempSync(join(tmpdir(), "pr-capture-"));
mkdirSync(out, { recursive: true });

const run = (cmd, args, { cwd = tmp, env = {} } = {}) => new Promise((resolve) => {
  const merged = { ...process.env, ...env };
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete merged[k];
  execFile(cmd, args, { cwd, env: merged, maxBuffer: 64 << 20 }, (error, stdout, stderr) =>
    resolve({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout, stderr }));
});
const git = (dir, ...args) => execFileSync("git", ["-C", dir, ...args]);
const repoDir = (dir, { remote = null, branch = "main" } = {}) => {
  mkdirSync(dir);
  git(dir, "init", "-q", "-b", branch);
  if (remote !== null) git(dir, "remote", "add", "origin", remote);
  git(dir, "-c", "user.name=capture", "-c", "user.email=capture@invalid", "commit", "-q", "--allow-empty", "-m", "capture");
  return dir;
};

const plain = join(tmp, "plain");
mkdirSync(plain);
const noRemote = repoDir(join(tmp, "no-remote"));
const otherHost = repoDir(join(tmp, "other-host"), { remote: "https://git.example.invalid/x/y.git" });
const onMain = repoDir(join(tmp, "main"), { remote: `https://github.com/${repo}.git` });
const detached = repoDir(join(tmp, "detached"), { remote: `https://github.com/${repo}.git` });
git(detached, "checkout", "-q", "--detach");
const noConfig = join(tmp, "no-config");
mkdirSync(noConfig);
const lookup = lookupArgs();

const seen = [
  ["no-repo", "a folder outside any git repository", plain, lookup],
  ["no-repo", "a git repository with no remote", noRemote, lookup],
  ["no-repo", "a git repository whose remote is not a GitHub host", otherHost, lookup],
  ["no-pr", "the default branch, which has no open pull request", onMain, lookup],
  ["no-pr", "a detached HEAD", detached, lookup],
  ["no-pr", "PR_QUERY for a pull request number that does not exist", plain, prArgs({ host: "github.com", owner, name, number: 999999 })],
  ["offline", "HTTPS_PROXY pointing at a closed port", onMain, lookup, { HTTPS_PROXY: "http://127.0.0.1:9" }],
  ["no-auth", "an empty GH_CONFIG_DIR and no token in the environment", onMain, lookup, { GH_CONFIG_DIR: noConfig, GH_TOKEN: undefined, GITHUB_TOKEN: undefined }],
  ["no-auth", "a token GitHub rejects", plain, ["api", "graphql", "-f", "query=query { rateLimit { remaining } }"], { GH_TOKEN: "not-a-real-token" }],
];
const samples = [];
for (const [kind, how, cwd, args, env] of seen) samples.push({ kind, how, verified: true, exec: await run("gh", args, { cwd, env }) });
const unshared = await run("unshare", ["-rn", "gh", ...lookup], { cwd: onMain });
if (!/unshare:/.test(unshared.stderr)) samples.push({ kind: "offline", how: "a network namespace with no network (unshare -rn)", verified: true, exec: unshared });

samples.push(
  { kind: "rate-limited", how: "not reproduced: GraphQL's RATE_LIMITED message as gh prints it", verified: false,
    exec: { code: 1, stdout: "", stderr: "GraphQL: API rate limit exceeded for user ID 1." } },
  { kind: "rate-limited", how: "not reproduced: GitHub's secondary limit as gh prints an HTTP error", verified: false,
    exec: { code: 1, stdout: "", stderr: "gh: You have exceeded a secondary rate limit. Please wait a few minutes before you try again. (HTTP 403)" } },
);
const rejections = [
  { kind: "no-gh", how: "not reproduced in Herdr: the text mods/tuido/README.md quotes for a program Herdr cannot find", verified: false,
    message: "cannot run gh: No such file or directory" },
];

const found = await run("gh", [...lookup, number, "-R", repo]);
const pr = await run("gh", prArgs({ host: "github.com", owner, name, number: Number(number) }));
const nodes = JSON.parse(pr.stdout).data.repository.pullRequest.commits.nodes[0].commit.statusCheckRollup.contexts.nodes;
const ids = nodes.filter((n) => n.__typename === "CheckRun").slice(0, 2).map((n) => n.id);
const steps = await run("gh", stepsArgs("github.com", ids));
const partial = await run("gh", stepsArgs("github.com", [ids[0], "CR_kwDOVrn0cM8AAAAAAAAAAA"]));

writeFileSync(join(out, "failures.json"), `${JSON.stringify({ gh: execFileSync("gh", ["--version"]).toString().split("\n")[0], samples, rejections }, null, 1)}\n`);
writeFileSync(join(out, "live.json"), `${JSON.stringify({ lookup: found.stdout, pr: JSON.parse(pr.stdout), steps: JSON.parse(steps.stdout),
  partial: { code: partial.code, stderr: partial.stderr, body: JSON.parse(partial.stdout) } })}\n`);
for (const s of samples) console.log(`${s.kind.padEnd(13)} ${s.verified ? "seen" : "assumed"}  exit ${s.exec.code}  ${s.exec.stderr.trim().split("\n")[0]}`);
console.log(`steps for ${ids.length} runs; partial answer exit ${partial.code}`);
rmSync(tmp, { recursive: true, force: true });
