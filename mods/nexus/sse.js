// Reads a server-sent event stream off a raw socket. Pure: the caller hands it bytes and a UTF-8 decoder, so Node tests it.
//
// The panel asks over HTTP/1.0, so the server sends the body as it is, unchunked, and ends it by closing.

const lf = 10;
const cr = 13;

/** The index just past the first blank line in `bytes` from `from`, or -1. Accepts LF LF and CR LF CR LF. */
function blankLine(bytes, from) {
  for (let i = from; i < bytes.length; i++) {
    if (bytes[i] !== lf) continue;
    if (bytes[i + 1] === lf) return i + 2;
    if (bytes[i + 1] === cr && bytes[i + 2] === lf) return i + 3;
  }
  return -1;
}

function joined(a, b) {
  if (a.length === 0) return b;
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

/**
 * A reader of one response. `feed(bytes)` answers each event the bytes complete as `{ id, data }`, either null when
 * the event had none, as a keep-alive carries only an `id:` watermark. A blank line ends an event, and a newline byte
 * is never inside a UTF-8 sequence, so decoding whole events never splits a character. A response that is not 200
 * answers no events, and `end()` throws its reason.
 */
export function sseReader(decode) {
  let pending = new Uint8Array(0);
  let head = null;
  let refused = null;
  return {
    feed(bytes) {
      pending = joined(pending, bytes);
      if (head === null) {
        const end = blankLine(pending, 0);
        if (end === -1) return [];
        head = decode(pending.subarray(0, end));
        pending = pending.slice(end);
        const status = Number(/^HTTP\/\d\.\d (\d{3})/.exec(head)?.[1] ?? 0);
        if (status !== 200) refused = status;
      }
      if (refused !== null) return [];
      const events = [];
      for (;;) {
        const end = blankLine(pending, 0);
        if (end === -1) break;
        const block = decode(pending.subarray(0, end));
        pending = pending.slice(end);
        const lines = block.split(/\r?\n/);
        const field = (name) => lines.filter((line) => line.startsWith(`${name}:`)).map((line) => line.slice(line[name.length + 1] === " " ? name.length + 2 : name.length + 1));
        const data = field("data");
        const id = field("id").at(-1) ?? null;
        if (data.length > 0 || id !== null) events.push({ id, data: data.length > 0 ? data.join("\n") : null });
      }
      return events;
    },
    /** At the end of the stream: throws for a refused response, with the server's reason. */
    end() {
      if (head === null) throw new Error("the control plane closed the stream before answering");
      if (refused === null) return;
      const body = decode(pending);
      let reason = body.slice(0, 300);
      try { reason = JSON.parse(body).error ?? reason; } catch { /* not JSON */ }
      throw new Error(`HTTP ${refused}: ${reason}`);
    },
    /** Whether the response was refused, known once its head arrived. */
    refused: () => refused,
  };
}
