// The control plane's HTTP API, reached as the `nexus` CLI reaches it: the URL `nexus connect` saved.
// The API admits a caller by its tailnet node, so no token is sent.
import { exec, home, readTextFile } from "herdr";
import net from "net";
import { Buffer } from "buffer";
import { URL } from "url";
import { sseReader } from "./sse.js";
import { connection, request, socksSocket } from "./transport.js";

export async function connect() {
  const path = `${home()}/.config/nexus/cli.json`;
  const text = await readTextFile(path);
  if (text === null) throw new Error(`${path} is missing. Run \`nexus connect <control plane>\` first.`);
  const config = JSON.parse(text);
  return connection(config);
}

/** The API refuses a state change without a JSON content type, with or without a body, as the CLI sends it. */
export async function call(conn, method, path, body) {
  return request(fetch, exec, conn, method, path, body);
}

/** A request ID the API deduplicates retries by, such as start:<id> or msg:<id>. */
export const requestId = (kind) => `${kind}:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

/**
 * The plain HTTP API of the control plane `conn` names. fetch reads a body only whole, so a stream goes over a raw
 * socket, which speaks no TLS: to the dashboard's HTTPS port it goes to the plain API on 7470 of the same host, as
 * `nexus connect` tries the two (docs/cli.md). The API admits the caller by its tailnet node either way.
 */
export function plainApi(conn) {
  const url = new URL(conn.url);
  if (url.protocol === "http:") return { host: url.hostname, port: Number(url.port || 80) };
  return { host: url.hostname, port: 7470 };
}

/**
 * Follows the server-sent events at `path` until the stream ends or `onEvent` answers false, handing it each event
 * as `{ id, data }` with `data` parsed, or null for a keep-alive. `live()` is asked after each read too: the server
 * pings a quiet stream every 15 s, so a stream no one wants closes within that. Throws for a refused request, with
 * the server's reason.
 */
export async function follow(conn, path, onEvent, live = () => true, sleep) {
  const { host, port } = plainApi(conn);
  const socket = conn.socks
    ? await socksSocket((host, port) => net.connect(host, port), conn.socks, host, port, sleep)
    : await net.connect(host, port);
  try {
    await socket.write(`GET ${path} HTTP/1.0\r\nHost: ${host}:${port}\r\nAccept: text/event-stream\r\n\r\n`);
    const reader = sseReader((bytes) => Buffer.from(bytes).toString("utf8"));
    for (;;) {
      const bytes = await socket.read(1 << 16);
      if (bytes === null) break;
      if (!live()) return;
      for (const e of reader.feed(bytes)) {
        if (onEvent({ id: e.id, data: e.data === null ? null : JSON.parse(e.data) }) === false) return;
      }
    }
    reader.end();
  } finally {
    socket.close();
  }
}

/**
 * The ID after which new events come, without reading the history: a follower from `latest` gets a keep-alive with
 * the newest ID each second, and is closed on the first.
 */
export async function latestCursor(conn, sleep) {
  let cursor = null;
  await follow(conn, "/v1/events?follow=true&since=latest", (e) => {
    if (e.id === null) return true;
    cursor = e.id;
    return false;
  }, () => true, sleep);
  if (cursor === null) throw new Error("the event stream ended before it said its latest event");
  return cursor;
}
