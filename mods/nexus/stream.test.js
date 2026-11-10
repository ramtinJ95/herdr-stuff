import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { sseReader } from "./sse.js";
import { applyClaude, applyHarness, blocks, emptyLive, queued, toolSummary } from "./transcript.js";

const decode = (bytes) => Buffer.from(bytes).toString("utf8");
const bytes = (text) => new Uint8Array(Buffer.from(text, "utf8"));

test("the reader answers each event once its blank line arrives, across reads and split characters", () => {
  const reader = sseReader(decode);
  const whole = bytes("HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\n\r\ndata: {\"a\":\"é\"}\n\n: ping\n\ndata: 2\n\n");
  const cut = whole.indexOf(0xc3) + 1; // inside é
  assert.deepEqual(reader.feed(whole.subarray(0, cut)), []);
  assert.deepEqual(reader.feed(whole.subarray(cut)), [{ id: null, data: '{"a":"é"}' }, { id: null, data: "2" }]);
  assert.deepEqual(reader.feed(bytes("id: 41\n")), []);
  assert.deepEqual(reader.feed(bytes("\n")), [{ id: "41", data: null }]);
  reader.end();
});

test("a refused stream throws the server's reason at its end", () => {
  const reader = sseReader(decode);
  assert.deepEqual(reader.feed(bytes("HTTP/1.1 404 Not Found\r\n\r\n{\"error\":\"no thread th-x\"}")), []);
  assert.equal(reader.refused(), 404);
  assert.throws(() => reader.end(), /HTTP 404: no thread th-x/);
  assert.throws(() => sseReader(decode).end(), /closed the stream before answering/);
});

test("a Claude worker's frames reset, then append; a call shows how it ended", () => {
  let live = emptyLive("th-1", "claude");
  live = applyClaude(live, { reset: true, session: "s", dropped: 0, working: true, entries: [
    { kind: "prompt", at: 1, text: "fix it", from: "person" },
    { kind: "tool", at: 2, id: "t1", name: "Bash", input: { command: "npm   test" } },
    { kind: "result", at: 3, toolUseId: "t1", output: "ok", isError: false },
    { kind: "tool", at: 4, id: "t2", name: "Read", input: { file_path: "/a.js" } },
  ] });
  live = applyClaude(live, { reset: false, session: "s", dropped: 0, working: true, entries: [
    { kind: "queue", at: 5, op: "enqueue", text: "and docs" },
    { kind: "pull-request", at: 6, number: 7, url: "u", repository: "r" },
    { kind: "pull-request", at: 7, number: 7, url: "u", repository: "r" },
  ] });
  assert.deepEqual(blocks(live).map((b) => [b.key, b.kind, b.text, b.state]), [
    ["c0", "prompt", "fix it", undefined],
    ["c1", "tool", "npm test", "ok"],
    ["c3", "tool", "/a.js", "running"],
    ["c5", "line", "Opened pull request #7", undefined],
  ]);
  assert.deepEqual(queued(live), ["and docs"]);
  assert.equal(applyClaude(live, { reset: true, session: "s2", dropped: 0, working: false, entries: [] }).entries.length, 0);
});

test("a Nexus agent's frames replace the context and documents they carry", () => {
  let live = emptyLive("th-1", "harness");
  const entries = [
    { id: 1, model: [{ role: "user", content: "hi", timestamp: 1 }] },
    { id: 2, model: [{ role: "assistant", content: [{ type: "text", text: "Hello" }, { type: "toolCall", id: "x", name: "bash", arguments: { command: "ls" } }], timestamp: 2 }] },
    { id: 3, model: [{ role: "toolResult", toolCallId: "x", toolName: "bash", content: [{ type: "text", text: "a b" }], isError: true, timestamp: 3 }] },
  ];
  live = applyHarness(live, { entries, docs: { "pi.inbox": { items: [{ mode: "followUp", content: "next" }] } }, busy: { working: true, queued: 1 } });
  assert.deepEqual(blocks(live).map((b) => [b.kind, b.text, b.state, b.output]), [
    ["prompt", "hi", undefined, undefined], ["reply", "Hello", undefined, undefined], ["tool", "ls", "failed", "a b"],
  ]);
  assert.deepEqual(queued(live), ["next"]);
  live = applyHarness(live, { docs: { "pi.inbox": null }, busy: { working: false, queued: 0 } });
  assert.deepEqual(queued(live), []);
  assert.equal(live.working, false);
  assert.equal(live.entries.length, 3);
});

test("a tool's summary picks the field that says what it does", () => {
  assert.equal(toolSummary("Grep", { pattern: "foo", path: "src" }), "foo");
  assert.equal(toolSummary("X", { a: 1 }), '{"a":1}');
});
