// The committed recordings, for the tests: what GitHub answered, frame by frame.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { frameAnswer, parsePr } from "./github.js";

const fixtures = new URL("./fixtures/", import.meta.url).pathname;

/** One of the JSON files in `fixtures/`, read anew at each call. */
export const readJson = (name) => JSON.parse(readFileSync(join(fixtures, name), "utf8"));

/** What gh printed and how it exited when it failed, each sample with the kind of failure it is. */
export const failures = readJson("failures.json");

/** The one of those samples of `kind` whose `how` matches. */
export function sample(kind, how) {
  const found = failures.samples.find((s) => s.kind === kind && how.test(s.how));
  assert.ok(found, `failures.json has a ${kind} sample matching ${how}`);
  return found;
}

export function recordings(dir) {
  return readdirSync(dir).filter((f) => /\.jsonl(\.gz)?$/.test(f)).sort().map((f) => {
    const bytes = readFileSync(join(dir, f));
    const text = (f.endsWith(".gz") ? gunzipSync(bytes) : bytes).toString("utf8");
    return { name: f.replace(/\.jsonl(\.gz)?$/, ""), frames: text.split("\n").filter(Boolean).map((line) => JSON.parse(line)) };
  });
}
export const committed = recordings(fixtures);

export const PENDING = "first-game-146-2026-11-26T180250120Z";
export const RUNNING = "first-game-146-2026-11-26T180650776Z";
export const FAILED = "first-game-66-";
export const PASSED = "first-game-145-";
/** An open pull request GitHub reports clean, from its second frame on. */
export const SETTLED = "survive-n-conquest-62-";

/** A copy of frame `n`, counted from 1, of the one recording whose name starts with `prefix`. */
export function frame(prefix, n = 1) {
  const found = committed.filter((r) => r.name.startsWith(prefix));
  assert.equal(found.length, 1, `one recording starts with ${prefix}`);
  return structuredClone(found[0].frames[n - 1]);
}

/** That frame as the answer gh printed, after `edit(pr, commit, repository)` changed it. */
export function answerOf(prefix, n = 1, edit = () => {}) {
  const answer = frameAnswer(frame(prefix, n));
  const { repository } = answer.data;
  edit(repository.pullRequest, repository.pullRequest.commits.nodes[0].commit, repository);
  return answer;
}

export const snapshotOf = (prefix, n = 1, edit = () => {}) => parsePr(answerOf(prefix, n, edit));
