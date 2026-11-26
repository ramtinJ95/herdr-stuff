// Records what GitHub says about a pull request's checks while they run, for the replay tests.
// node mods/pr/record.js <out dir> <owner/repo>... [--pr owner/repo#N] [--tick 3] [--hours 6]
// A frame is written only when the answer changed; polls.tsv has every poll, for measuring lag.
import { execFile } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { OPEN_PRS_QUERY, prArgs } from "./query.js";

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args.splice(i, 2)[1]; };
const tick = Number(flag("tick", 3)) * 1000, hours = Number(flag("hours", 6)), only = flag("pr", null);
const [out, ...repos] = args;
mkdirSync(out, { recursive: true });

const gh = (argv) => new Promise((resolve) => {
  const started = Date.now();
  execFile("gh", argv, { maxBuffer: 64 << 20 }, (error, stdout, stderr) =>
    resolve({ code: error ? error.code ?? 1 : 0, stdout, stderr: stderr.trim(), ms: Date.now() - started }));
});
const json = (r) => { try { return JSON.parse(r.stdout); } catch { return { unparsed: r.stdout.slice(0, 400), stderr: r.stderr, code: r.code }; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rollupOf = (pr) => pr?.commits?.nodes?.[0]?.commit?.statusCheckRollup ?? null;
const pending = (rollup) => rollup !== null && (["PENDING", "EXPECTED"].includes(rollup.state)
  || (rollup.contexts?.nodes ?? []).some((c) => c.__typename === "CheckRun" ? c.status !== "COMPLETED" : ["PENDING", "EXPECTED"].includes(c.state)));
const ORACLE = "bucket,completedAt,description,event,link,name,startedAt,state,workflow";

const live = new Map();

async function capture(repo, number) {
  const key = `${repo}#${number}`, [owner, name] = repo.split("/");
  const rec = live.get(key) ?? { file: `${out}/${name}-${number}-${new Date().toISOString().replace(/[:.]/g, "")}.jsonl`, last: "", quiet: 0, frames: 0, polls: 0, since: Date.now() };
  live.set(key, rec);
  const at = new Date().toISOString();
  const res = await gh(prArgs(owner, name, number, true));
  const body = json(res), pr = body.data?.repository?.pullRequest ?? null, rollup = rollupOf(pr);
  const runs = [...new Set((rollup?.contexts?.nodes ?? []).map((c) => c.checkSuite?.workflowRun?.databaseId).filter(Boolean))];
  const fetched = await Promise.all(runs.sort().map(async (id) => [id, json(await gh(["api", `repos/${repo}/actions/runs/${id}/jobs?per_page=100`]))]));
  const jobs = Object.fromEntries(fetched);
  const shown = JSON.stringify({ pr, jobs, errors: body.errors ?? null });
  rec.polls++;
  appendFileSync(`${out}/polls.tsv`, `${at}\t${key}\t${res.ms}\t${body.data?.rateLimit?.cost ?? ""}\t${body.data?.rateLimit?.remaining ?? ""}\t${shown === rec.last ? "same" : "changed"}\n`);
  if (shown !== rec.last) {
    const oracle = await gh(["pr", "checks", String(number), "-R", repo, "--json", ORACLE]);
    const again = json(await gh(prArgs(owner, name, number, true)));
    const steady = JSON.stringify(again.data?.repository?.pullRequest ?? null) === JSON.stringify(pr);
    appendFileSync(rec.file, JSON.stringify({ at, repo, number, ms: res.ms, rateLimit: body.data?.rateLimit ?? null, pr, errors: body.errors ?? null, jobs,
      oracle: { code: oracle.code, checks: json(oracle), stderr: oracle.stderr, steady } }) + "\n");
    rec.last = shown; rec.frames++;
    console.log(`${at} ${key} frame ${rec.frames} rollup=${rollup?.state ?? "none"} head=${pr?.headRefOid?.slice(0, 7)} contexts=${rollup?.contexts?.nodes?.length ?? 0}`);
  }
  rec.quiet = pending(rollup) ? 0 : rec.quiet + 1;
  const waitedForChecks = rollup === null && Date.now() - rec.since < 120_000;
  if (rec.quiet >= 5 && !waitedForChecks) { console.log(`${at} ${key} settled after ${rec.polls} polls, ${rec.frames} frames: ${rec.file}`); live.delete(key); }
}

const heads = new Map(), end = Date.now() + hours * 3600_000;
let listed = 0;
while (Date.now() < end) {
  if (only !== null) {
    const [repo, number] = only.split("#");
    if (!live.has(only) && heads.has(only)) break;
    heads.set(only, true);
    await capture(repo, Number(number));
  } else {
    if (Date.now() - listed >= (live.size > 0 ? 15_000 : 30_000)) {
      listed = Date.now();
      for (const repo of repos) {
        const [owner, name] = repo.split("/");
        const body = json(await gh(["api", "graphql", "-f", `query=${OPEN_PRS_QUERY}`, "-F", `owner=${owner}`, "-F", `name=${name}`]));
        for (const pr of body.data?.repository?.pullRequests?.nodes ?? []) {
          const key = `${repo}#${pr.number}`, moved = heads.has(key) && heads.get(key) !== pr.headRefOid;
          heads.set(key, pr.headRefOid);
          if (!live.has(key) && (moved || pending(rollupOf(pr)))) { console.log(`${new Date().toISOString()} ${key} ${moved ? "moved" : "pending"}: recording`); live.set(key, undefined); await capture(repo, pr.number); }
        }
      }
    }
    await Promise.all([...live.keys()].map((key) => { const [repo, number] = key.split("#"); return capture(repo, Number(number)); }));
  }
  await sleep(live.size > 0 || only !== null ? tick : 5000);
}
