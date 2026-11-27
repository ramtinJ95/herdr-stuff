import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAbout, parseFiles, parsePr } from "./github.js";
import { SETTLED, answerOf, readJson } from "./recorded.js";

/** Herdr gives a mod one localStorage; here it is a map, emptied by each test that starts a session. */
const stored = new Map();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
  getItem: (key) => stored.get(key) ?? null,
  setItem: (key, value) => void stored.set(key, String(value)),
  removeItem: (key) => void stored.delete(key),
} });

let sessions = 0;
/** The module as a session of the app loads it: nothing held in memory, and what the last session stored. */
const session = () => import(`./cache.js?session=${++sessions}`);

const TARGET = { host: "github.com", owner: "ramtinJ95", name: "survive-n-conquest", number: 62 };
const PLACE = { cwd: "/work/survive", branch: "feat/x", machine: null, pin: null };
const answer = () => answerOf(SETTLED, 2);
const aboutAnswer = () => readJson("about-first-game-146.json");
const files = () => ({ head: "abc", list: parseFiles(readJson("files-first-game-146.json")) });
const live = () => ({ snapshot: parsePr(answer()), about: parseAbout(aboutAnswer()), files: files(), fetchedAt: 1_000, source: "live" });

test("what a copy of the pane shows is what another opens on in the same session, files and all, as a saved copy", async () => {
  stored.clear();
  const { keep, recall } = await session();
  assert.equal(recall(TARGET), null);
  keep(TARGET, live());
  assert.deepEqual(recall(TARGET), { ...live(), source: "cache" });
  assert.equal(stored.size, 0, "nothing is stored without one of GitHub's answers");
});

test("the next session opens on GitHub's answers as they were stored, read again, without the files", async () => {
  stored.clear();
  const first = await session();
  first.keep(TARGET, live(), { pr: answer(), about: aboutAnswer() });
  const { recall } = await session();
  assert.deepEqual(recall(TARGET), { ...live(), files: null, source: "cache" });
  assert.equal(recall({ ...TARGET, number: 63 }), null);
  stored.clear();
  assert.deepEqual(recall(TARGET), { ...live(), files: null, source: "cache" }, "once read, it is what a window of this session opens on");
});

test("where a pane was as it opened a window is taken by that window, once", async () => {
  const { handOver, takeOver } = await session();
  const first = { selected: "file:src/a.js", reading: null };
  assert.equal(takeOver(TARGET), null);
  handOver(TARGET, first);
  assert.equal(takeOver({ ...TARGET, number: 63 }), null);
  assert.equal(takeOver(TARGET), first);
  assert.equal(takeOver(TARGET), null);
});

test("synthetic: what the pane before this one stored, which this one does not read, goes when this one stores", async () => {
  stored.clear();
  const earlier = { "pr:v1:order": ["pr:v1:github.com/o/n#1"], "pr:v1:github.com/o/n#1": { fetchedAt: 1, snapshot: {} }, "pr:v1:places": {} };
  for (const [key, value] of Object.entries(earlier)) stored.set(key, JSON.stringify(value));
  const { keep } = await session();
  keep(TARGET, live(), { pr: answer() });
  assert.deepEqual([...stored.keys()].filter((key) => key.startsWith("pr:v1:")), []);
  assert.deepEqual((await session()).recall(TARGET), { ...live(), about: null, files: null, source: "cache" }, "and what this one stored is still there");
});

test("a pull request kept without its description is recalled without one", async () => {
  stored.clear();
  const first = await session();
  first.keep(TARGET, { ...live(), about: null }, { pr: answer() });
  assert.equal((await session()).recall(TARGET).about, null);
});

test("synthetic: what is stored in a shape the parsers do not read is no saved copy", async () => {
  stored.clear();
  (await session()).keep(TARGET, live(), { pr: answer(), about: { author: "ada", body: "an About as an older pane stored it" } });
  assert.deepEqual((await session()).recall(TARGET), { ...live(), about: null, files: null, source: "cache" });
  (await session()).keep(TARGET, live(), { pr: { snapshot: live().snapshot }, about: aboutAnswer() });
  assert.equal((await session()).recall(TARGET), null);
  (await session()).keep(TARGET, live(), { pr: answer(), about: aboutAnswer() });
  assert.notEqual((await session()).recall(TARGET), null);
  for (const key of [...stored.keys()]) stored.set(key, "not json");
  assert.equal((await session()).recall(TARGET), null);
});

test("a place is guessed to be on the pull request last found there, shown without its files until it is found again", async () => {
  stored.clear();
  const { guess, keep, remember } = await session();
  assert.equal(guess(PLACE), null);
  remember(PLACE, TARGET);
  assert.equal(guess(PLACE), null, "a pull request found there but never shown");
  keep(TARGET, live(), { pr: answer() });
  assert.deepEqual(guess(PLACE), { ...live(), files: null, source: "cache" });
  assert.equal(guess({ ...PLACE, branch: "main" }), null);
  assert.deepEqual((await session()).guess(PLACE), { ...live(), about: null, files: null, source: "cache" });
});

test("synthetic: the twenty pull requests shown last are kept, and an older one's answers are removed", async () => {
  stored.clear();
  const first = await session();
  const show = (number) => first.keep({ ...TARGET, number }, live(), { pr: answer(), about: aboutAnswer() });
  for (let number = 1; number <= 20; number++) show(number);
  const twenty = stored.size;
  show(21);
  assert.equal(stored.size, twenty, "one more is stored, and all of the oldest is removed");
  const { recall } = await session();
  assert.deepEqual([1, 2, 21].map((number) => recall({ ...TARGET, number }) !== null), [false, true, true]);
});

test("synthetic: a pull request shown again is among the twenty shown last", async () => {
  stored.clear();
  const first = await session();
  for (const number of [...Array.from({ length: 20 }, (_, i) => i + 1), 1, 21]) first.keep({ ...TARGET, number }, live(), { pr: answer() });
  const { recall } = await session();
  assert.deepEqual([1, 2, 3, 21].map((number) => recall({ ...TARGET, number }) !== null), [true, false, true, true]);
});

test("synthetic: a session holds the twenty pull requests it showed last, stored or not", async () => {
  stored.clear();
  const { keep, recall } = await session();
  for (const number of [...Array.from({ length: 20 }, (_, i) => i + 1), 1, 21]) keep({ ...TARGET, number }, live());
  assert.deepEqual([1, 2, 3, 21].map((number) => recall({ ...TARGET, number }) !== null), [true, false, true, true]);
});

test("synthetic: the fifty places a pull request was found at last are remembered", async () => {
  stored.clear();
  const { guess, keep, remember } = await session();
  keep(TARGET, live(), { pr: answer() });
  const place = (n) => ({ ...PLACE, branch: `feat/${n}` });
  for (let n = 1; n <= 51; n++) remember(place(n), TARGET);
  assert.deepEqual([1, 2, 51].map((n) => guess(place(n)) !== null), [false, true, true]);
});

test("synthetic: each place is guessed to be on its own pull request, and on another once that is found there", async () => {
  stored.clear();
  const { guess, keep, remember } = await session();
  const other = { ...TARGET, number: 63 }, main = { ...PLACE, branch: "main" };
  keep(TARGET, live(), { pr: answer() });
  keep(other, { ...live(), fetchedAt: 2_000 }, { pr: answer() });
  remember(PLACE, TARGET);
  remember(main, other);
  assert.deepEqual([guess(PLACE).fetchedAt, guess(main).fetchedAt], [1_000, 2_000]);
  remember(PLACE, other);
  assert.deepEqual([guess(PLACE).fetchedAt, guess(main).fetchedAt], [2_000, 2_000]);
});
