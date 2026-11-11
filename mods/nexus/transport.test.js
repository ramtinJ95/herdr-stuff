import { test } from "node:test";
import assert from "node:assert/strict";
import { connection, request, socksSocket } from "./transport.js";
import { sseReader } from "./sse.js";

const url = "https://home.example:7443";
const direct = connection({ url });
const proxied = connection({ url, socks: "localhost:1055" });
const never = () => new Promise(() => {});
const forbidden = () => { throw new Error("must not take this network path"); };
const reply = (text, status = 200) => ({ status, text: async () => text });

test("missing proxy and explicit none preserve direct connections; malformed settings never become direct", () => {
  assert.deepEqual(direct, { url });
  assert.deepEqual(connection({ url: `${url}/`, socks: "none" }), direct);
  assert.deepEqual(proxied.socks, { address: "localhost:1055", host: "localhost", port: 1055 });
  assert.equal(connection({ url, socks: "[::1]:1055" }).socks.host, "::1");
  for (const socks of [null, "", false, 1055, "localhost", "x:0", "x:65536", "x:1055/path", "x:1?x", "x:1\n"]) {
    assert.throws(() => connection({ url, socks }), /socks must/);
  }
  assert.throws(() => connection({ url: "file:///etc/passwd" }), /HTTP/);
});

test("direct GET and mutations still use native fetch with the same URL, headers and JSON", async () => {
  for (const [method, body] of [["GET", undefined], ["POST", { text: "hello" }], ["POST", undefined], ["DELETE", undefined]]) {
    const result = await request(async (target, options) => {
      assert.equal(target, `${url}/v1/threads`);
      assert.deepEqual(options, {
        method,
        ...(method === "GET" ? {} : { headers: { "content-type": "application/json" } }),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return reply('{"ok":true}');
    }, forbidden, direct, method, "/v1/threads", body);
    assert.deepEqual(result, { ok: true });
  }
});

test("SOCKS uses curl with proxy DNS, overrides NO_PROXY and curlrc, keeps TLS verification, and passes JSON as one argument", async () => {
  const body = { text: "$(touch /no)\n'quoted' é" };
  const result = await request(forbidden, async (cmd, args, options) => {
    assert.equal(cmd, "curl");
    assert.equal(args[0], "--disable");
    assert.equal(args[args.indexOf("--proxy") + 1], "socks5h://localhost:1055");
    assert.equal(args[args.indexOf("--noproxy") + 1], "");
    assert.equal(args[args.indexOf("--data-raw") + 1], JSON.stringify(body));
    assert.equal(args[args.indexOf("--url") + 1], `${url}/v1/threads`);
    for (const flag of ["--insecure", "-k", "--location", "--retry"]) assert.ok(!args.includes(flag));
    assert.deepEqual(options, { timeout: 35_000 });
    return { code: 0, stdout: '{"ok":true}\n201', stderr: "" };
  }, proxied, "POST", "/v1/threads", body);
  assert.deepEqual(result, { ok: true });
});

test("SOCKS bodyless mutations keep upstream's JSON content type without inventing a body", async () => {
  for (const method of ["POST", "DELETE", "PATCH"]) {
    await request(forbidden, async (_cmd, args) => {
      assert.equal(args[args.indexOf("--request") + 1], method);
      assert.equal(args[args.indexOf("--header") + 1], "content-type: application/json");
      assert.ok(!args.includes("--data-raw"));
      return { code: 0, stdout: "\n204", stderr: "" };
    }, proxied, method, "/v1/threads/example/stop");
  }
});

test("direct and proxy HTTP errors preserve their status; empty success stays null", async () => {
  for (const conn of [direct, proxied]) {
    for (const [text, status, message] of [['{"error":"held"}', 409, "held"], ["not found", 404, "not found"]]) {
      await assert.rejects(request(async () => reply(text, status), async () => ({ code: 0, stdout: `${text}\n${status}` }), conn, "GET", "/v1/x"),
        (e) => e.status === status && e.message === message);
    }
    assert.equal(await request(async () => reply("", 204), async () => ({ code: 0, stdout: "\n204" }), conn, "DELETE", "/v1/x"), null);
  }
});

test("proxy loss or curl failure never retries a mutation or falls back to fetch", async () => {
  let calls = 0;
  await assert.rejects(request(forbidden, async () => { calls++; return { code: 28, stderr: "timeout", stdout: "\n000" }; }, proxied, "POST", "/v1/x", {}), /SOCKS.*timeout/);
  assert.equal(calls, 1);
  await assert.rejects(request(forbidden, async () => { throw new Error("curl missing"); }, proxied, "GET", "/v1/x"), /curl missing/);
  await assert.rejects(request(forbidden, async () => ({ code: 0, stdout: "garbage" }), proxied, "GET", "/v1/x"), /no HTTP status/);
});

function fakeSocket(bytes, fragment = 1) {
  let offset = 0;
  const socket = {
    writes: [], closed: false,
    write: async (value) => { socket.writes.push(value); },
    read: async (size) => {
      if (offset === bytes.length) return null;
      const end = Math.min(offset + size, offset + fragment, bytes.length);
      const part = bytes.subarray(offset, end);
      offset = end;
      return part;
    },
    close: () => { socket.closed = true; },
  };
  return socket;
}

test("SOCKS handshakes tolerate fragmentation and all reply address types, preserving following SSE bytes", async () => {
  for (const address of [[1, 127, 0, 0, 1], [3, 3, 97, 98, 99], [4, ...new Array(16).fill(255)]]) {
    const raw = fakeSocket(Buffer.concat([Buffer.from([5, 0, 5, 0, 0, ...address, 255, 255]), Buffer.from('HTTP/1.0 200 OK\r\n\r\nid: 42\ndata: {"ok":true}\n\n')]), 3);
    const socket = await socksSocket(async (host, port) => {
      assert.equal(host, "localhost"); assert.equal(port, 1055); return raw;
    }, proxied.socks, "home.example", 7470, never);
    assert.equal(raw.writes[0], "\x05\x01\x00");
    assert.deepEqual([...Buffer.from(raw.writes[1])], [5, 1, 0, 3, 12, ...Buffer.from("home.example"), 29, 46]);
    const reader = sseReader((b) => Buffer.from(b).toString("utf8"));
    const events = [];
    for (;;) { const b = await socket.read(65536); if (b === null) break; events.push(...reader.feed(b)); }
    reader.end();
    assert.deepEqual(events, [{ id: "42", data: '{"ok":true}' }]);
    socket.close();
    assert.ok(raw.closed);
  }
});

test("SOCKS refusal, authentication requirements, invalid replies, and truncated handshakes close the socket", async () => {
  for (const [bytes, error] of [
    [[5, 2], /without authentication/], [[4, 0], /without authentication/],
    [[5, 0, 5, 5, 0, 1], /refused/], [[5, 0, 5, 0, 0, 9], /address type/],
    [[5, 0, 4, 0, 0, 1], /Invalid/], [[5], /closed/],
  ]) {
    const raw = fakeSocket(Uint8Array.from(bytes));
    await assert.rejects(socksSocket(async () => raw, proxied.socks, "home.example", 7470, never), error);
    assert.ok(raw.closed);
  }
});

test("text-only socket restrictions are explicit and never try direct or a corrupted destination", async () => {
  for (const [host, port] of [["home.example", 443], ["é.example", 7470], ["x".repeat(128), 7470], ["x", 65536]]) {
    await assert.rejects(socksSocket(forbidden, proxied.socks, host, port, never), /text-only sockets/);
  }
});

test("a stalled proxy handshake times out and closes; a late connection is also closed", async () => {
  let expire;
  const sleep = () => new Promise((resolve) => { expire = resolve; });
  const raw = fakeSocket(new Uint8Array());
  raw.read = never;
  const handshake = socksSocket(async () => raw, proxied.socks, "home.example", 7470, sleep);
  await new Promise((resolve) => setImmediate(resolve));
  expire();
  await assert.rejects(handshake, /timed out/);
  assert.ok(raw.closed);
  let connected;
  const late = socksSocket(() => new Promise((resolve) => { connected = resolve; }), proxied.socks, "home.example", 7470, sleep);
  expire();
  await assert.rejects(late, /timed out/);
  raw.closed = false;
  connected(raw);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(raw.closed);
});
