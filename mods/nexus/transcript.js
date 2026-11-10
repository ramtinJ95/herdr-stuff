// A thread's conversation as the panel shows it, from the stream routes' frames (src/contract/streams.ts). Pure, so
// Node tests it. It follows the CLI's conversation-text.ts: the same entries show, in the same order.

/** The conversation before its stream's first frame. */
export const emptyLive = (thread, kind) => ({ thread, kind, loaded: false, entries: [], docs: {}, dropped: 0, working: false, session: null });

/**
 * A Claude worker's frame: the first, and any after the transcript was replaced, has `reset` and every entry kept;
 * each later one the entries appended since.
 */
export function applyClaude(live, frame) {
  const entries = frame.reset ? [...frame.entries] : [...live.entries, ...frame.entries];
  return { ...live, loaded: true, entries, dropped: frame.dropped, working: frame.working, session: frame.session };
}

/**
 * A Nexus agent's frame: the first carries the whole view, each later one what changed, each part whole: the
 * active context when any entry changed, each document that changed or null for one gone, and `busy` when it changed.
 */
export function applyHarness(live, frame) {
  const docs = { ...live.docs };
  for (const [name, doc] of Object.entries(frame.docs ?? {})) {
    if (doc === null) delete docs[name];
    else docs[name] = doc;
  }
  const working = frame.busy !== undefined ? frame.busy.working : docs["pi.live"]?.run !== undefined;
  return { ...live, loaded: true, entries: frame.entries !== undefined ? [...frame.entries] : live.entries, docs, working };
}

const clip = (text, n) => (text.length <= n ? text : `${text.slice(0, n - 1)}…`);
const oneLine = (text) => text.replace(/\s+/g, " ").trim();

/** What a tool call is about in a few words: its command, path, pattern or URL, else its input. */
export function toolSummary(name, input) {
  const pick = ["command", "file_path", "pattern", "path", "url", "query", "description", "prompt"].find((k) => typeof input?.[k] === "string");
  return clip(oneLine(pick === undefined ? JSON.stringify(input ?? {}) : input[pick]), 160);
}

const promptLabel = { person: null, command: "Slash command", other: "Claude Code" };

/**
 * The conversation as blocks, oldest first: a prompt, a reply (Markdown), a tool call with how it ended and its
 * output, a notice, or a line about the run. `key` is stable while the entry stays, so each block keeps its view.
 */
export function blocks(live) {
  return live.kind === "claude" ? claudeBlocks(live) : harnessBlocks(live);
}

function claudeBlocks(live) {
  const results = new Map(live.entries.flatMap((e) => (e.kind === "result" ? [[e.toolUseId, e]] : [])));
  const lastTurn = live.entries.findLastIndex((e) => e.kind === "turn");
  const shown = new Set();
  const out = [];
  live.entries.forEach((e, i) => {
    const key = `c${live.dropped + i}`;
    switch (e.kind) {
      case "prompt": {
        const images = (e.images ?? []).map(() => "[image]");
        out.push({ key, kind: "prompt", at: e.at, label: promptLabel[e.from] ?? null, text: [e.text, ...images].filter(Boolean).join("\n") });
        break;
      }
      case "reply": out.push({ key, kind: "reply", at: e.at, text: e.text }); break;
      case "tool": {
        const r = results.get(e.id);
        const state = r !== undefined ? (r.isError ? "failed" : "ok") : live.working && i > lastTurn ? "running" : "no result";
        out.push({ key, kind: "tool", at: e.at, name: e.name, text: toolSummary(e.name, e.input), state, output: r?.output ?? null });
        break;
      }
      case "task": out.push({ key, kind: "line", at: e.at, text: `Task ${e.status}: ${e.summary}` }); break;
      case "notice": out.push({ key, kind: "notice", at: e.at, tone: e.tone, text: e.text }); break;
      case "turn": out.push({ key, kind: "turn", at: e.at, text: `Turn ended after ${Math.round(e.durationMs / 1000)}s` }); break;
      case "pull-request":
        if (!shown.has(e.url)) {
          shown.add(e.url);
          out.push({ key, kind: "line", at: e.at, text: `Opened pull request #${e.number}`, url: e.url });
        }
        break;
      case "record": out.push({ key, kind: "line", at: e.at, text: `${e.type}: ${e.summary}` }); break;
      default: break; // results show on their call; queue operations in queued()
    }
  });
  return out;
}

const partsText = (content) => (typeof content === "string" ? content
  : content.map((p) => (p.type === "text" ? p.text : p.type === "image" ? `[${p.mimeType} image]` : "")).join(""));

function harnessBlocks(live) {
  const results = new Map();
  for (const entry of live.entries) {
    for (const m of entry.model ?? []) if (m.role === "toolResult") results.set(m.toolCallId, m);
  }
  const out = [];
  for (const entry of live.entries) {
    (entry.model ?? []).forEach((m, mi) => {
      const key = `h${entry.id}.${mi}`;
      if (m.role === "user") out.push({ key, kind: "prompt", at: m.timestamp ?? null, label: null, text: partsText(m.content) });
      if (m.role !== "assistant") return;
      m.content.forEach((p, pi) => {
        if (p.type === "text" && p.text !== "") out.push({ key: `${key}.${pi}`, kind: "reply", at: m.timestamp ?? null, text: p.text });
        if (p.type === "toolCall") {
          const r = results.get(p.id);
          const state = r !== undefined ? (r.isError ? "failed" : "ok") : live.working ? "running" : "no result";
          out.push({ key: `${key}.${pi}`, kind: "tool", at: m.timestamp ?? null, name: p.name, text: toolSummary(p.name, p.arguments), state, output: r === undefined ? null : partsText(r.content) });
        }
      });
      if (m.stopReason === "error") out.push({ key: `${key}.e`, kind: "notice", at: null, tone: "error", text: `The model failed: ${m.errorMessage ?? "no reason given"}` });
      if (m.stopReason === "aborted") out.push({ key: `${key}.a`, kind: "notice", at: null, tone: "info", text: "Aborted" });
    });
  }
  return out;
}

/** The messages waiting for the agent to take them, oldest first. */
export function queued(live) {
  if (live.kind === "harness") {
    return (live.docs["pi.inbox"]?.items ?? []).flatMap((item) => (item.mode === "write" ? [] : [partsText(item.content)]));
  }
  const waiting = [];
  for (const e of live.entries) {
    if (e.kind !== "queue") continue;
    if (e.op === "enqueue") waiting.push(e.text ?? "");
    else {
      const taken = e.text === null ? 0 : waiting.indexOf(e.text);
      if (taken !== -1) waiting.splice(taken, 1);
    }
  }
  return waiting;
}
