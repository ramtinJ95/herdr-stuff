// No routing changes or local forwarding service: every proxied connection goes to the configured SOCKS server.
import { URL } from "url";

export function connection(config) {
  if (typeof config.url !== "string") throw new Error("Nexus config names no control plane URL. Run `nexus connect <control plane>`.");
  const url = new URL(config.url);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Nexus URL must use HTTP or HTTPS");
  if (config.socks === undefined || config.socks === "none") return { url: config.url.replace(/\/+$/, "") };
  // Refuse malformed proxy settings, rather than accidentally using the work tailnet directly.
  const match = typeof config.socks === "string" && /^(\[[^\]]+\]|[^\s/:?#@]+):(\d+)$/.exec(config.socks);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 65535) throw new Error("Nexus socks must be HOST:PORT or none");
  return { url: config.url.replace(/\/+$/, ""), socks: { address: config.socks, host: match[1].replace(/^\[|\]$/g, ""), port: Number(match[2]) } };
}

/** Keep native fetch for direct users. curl supplies TLS + remote DNS through SOCKS, without shell interpolation. */
export async function request(fetch, exec, conn, method, path, body) {
  // The API requires this even for bodyless mutations (Stop, Retry, Unarchive, Cancel review).
  const headers = method === "GET" ? {} : { "content-type": "application/json" };
  let status, text;
  if (!conn.socks) {
    const options = {
      method,
      ...(method === "GET" ? {} : { headers }),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    };
    const r = await fetch(`${conn.url}${path}`, options);
    status = r.status;
    text = await r.text();
  } else {
    const args = ["--disable", "--silent", "--show-error", "--proxy", `socks5h://${conn.socks.address}`, "--noproxy", "",
      "--connect-timeout", "10", "--max-time", "30", "--request", method, "--write-out", "\n%{http_code}"];
    for (const [name, value] of Object.entries(headers)) args.push("--header", `${name}: ${value}`);
    if (body !== undefined) args.push("--data-raw", JSON.stringify(body));
    args.push("--url", `${conn.url}${path}`);
    // No redirects, retries, curlrc, or NO_PROXY bypass. A timed-out mutation may have executed: never replay it.
    const r = await exec("curl", args, { timeout: 35_000 });
    if (r.code !== 0) throw new Error(`Nexus via SOCKS ${conn.socks.address}: ${r.stderr.trim() || `curl exited ${r.code}`}`);
    const end = /\n(\d{3})$/.exec(r.stdout);
    if (!end) throw new Error("Nexus curl response has no HTTP status");
    status = Number(end[1]);
    text = r.stdout.slice(0, end.index);
  }
  let data = null;
  if (text !== "") {
    try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 300) }; }
  }
  if (status < 200 || status >= 300) throw Object.assign(new Error(data?.error ?? `${method} ${path} answered HTTP ${status}`), { status });
  return data;
}

/** SOCKS5 no-auth CONNECT, with DNS resolved by the proxy, not the Mac's work tailnet. */
export async function socksSocket(open, proxy, host, port, sleep) {
  // Herdr 0.1.14's Socket.write accepts UTF-8 strings, not binary buffers. ASCII bytes round-trip exactly.
  // Nexus's ordinary stream port 7470 is 0x1d2e, so its request is representable without changing Herdr.
  // Refuse unsupported custom endpoints BEFORE opening anything; never corrupt a port or fall back to direct.
  const bytes = [5, 1, 0, 3, host.length, ...Array.from(host, (c) => c.charCodeAt(0)), port >> 8, port & 255];
  if (!host.length || host.length > 127 || !Number.isInteger(port) || port < 1 || port > 65535 || bytes.some((b) => b > 127)) {
    throw new Error("Herdr's text-only sockets cannot encode this SOCKS stream endpoint; use Nexus's standard port 7470 and an ASCII hostname shorter than 128 bytes");
  }
  if (typeof sleep !== "function") throw new Error("SOCKS stream requires a timeout clock");
  let socket;
  let ended = false;
  const bounded = (operation) => Promise.race([operation, sleep(30_000).then(() => { throw new Error(`SOCKS ${proxy.address} timed out`); })]);
  try {
    socket = await bounded(open(proxy.host, proxy.port).then((s) => {
      if (ended) { s.close(); throw new Error("SOCKS connection arrived after timeout"); }
      return s;
    }));
    // read(n) may return fewer bytes; do not consume any following HTTP bytes with the CONNECT reply.
    const exact = async (n) => {
      const result = new Uint8Array(n);
      let offset = 0;
      while (offset < n) {
        const part = await bounded(socket.read(n - offset));
        if (part === null || part.length === 0) throw new Error("SOCKS proxy closed during handshake");
        result.set(part, offset);
        offset += part.length;
      }
      return result;
    };
    await bounded(socket.write("\x05\x01\x00"));
    const hello = await exact(2);
    if (hello[0] !== 5 || hello[1] !== 0) throw new Error("SOCKS proxy must accept SOCKS5 without authentication");
    await bounded(socket.write(String.fromCharCode(...bytes)));
    const reply = await exact(4);
    if (reply[0] !== 5 || reply[2] !== 0) throw new Error("Invalid SOCKS5 CONNECT reply");
    if (reply[1] !== 0) throw new Error(`SOCKS proxy refused ${host}:${port} (reply ${reply[1]})`);
    if (reply[3] === 1) await exact(4);
    else if (reply[3] === 4) await exact(16);
    else if (reply[3] === 3) await exact((await exact(1))[0]);
    else throw new Error("Invalid SOCKS5 address type");
    await exact(2);
    return {
      write: (data) => bounded(socket.write(data)),
      read: (size) => bounded(socket.read(size)),
      close: () => socket.close(),
    };
  } catch (e) {
    ended = true;
    socket?.close();
    throw e;
  }
}
