// Small helpers the cabin's roles share.

import { layout, run, setShared, shared, window, home, agents, panes, keys } from "herdr";

export function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

/** The sidebar is a rail when narrower than 160px, as in Herdr's own mods. */
export const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

/** To the rail, or back to the width it had. */
export function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 280) : window()?.platform === "macos" ? 76 : 52 });
}

/** For controls inside a window-drag block: a press there isn't a drag. */
export const stop = (_e, cx) => cx.stop_propagation();

export function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}

export function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

export const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

/** What an agent (or pane) says it's doing (its terminal title), when that tells something. */
export function task(a) {
  const live = clean(a?.title);
  const prog = a?.program?.name;
  if (!live || live === prog || /^[~/]/.test(live) || live.includes("@") || live.toLowerCase() === a?.program?.key) return null;
  // "π - herdr-stuff": the program's mark and its folder, nothing more.
  const cwd = a.cwd ?? panes().find((x) => x.pane === a.pane)?.cwd;
  const base = cwd?.split("/").filter(Boolean).pop();
  const rest = base ? live.split(base).join("") : live;
  return (rest.match(/[\p{L}\p{N}]/gu) ?? []).length >= 3 ? live : null;
}

/** A tab's name: its own, else what its agent is doing, else its program. */
export function tabLabel(c) {
  if (!c) return "";
  if (c.named) return c.name;
  const a = agents().find((x) => x.tab === c.id);
  const p = panes().find((x) => x.tab === c.id && x.program?.agent)?.program ?? panes().find((x) => x.tab === c.id)?.program;
  return task(a) ?? (p && !p.shell ? p.name : "terminal");
}

/** "1 working · 2 need you"-style counts of agents, most urgent first. */
export function tally(list) {
  const n = (s) => list.filter((a) => a.status === s).length;
  return [
    [n("blocked"), "needs you", "need you", "blocked"],
    [n("done"), "ready", "ready", "done"],
    [n("working"), "brewing", "brewing", "working"],
  ].filter(([k]) => k > 0).map(([k, one, many, status]) => ({ status, text: `${k} ${k === 1 ? one : many}` }));
}

const KEY = { ctrl: "Ctrl", alt: "Alt", shift: "Shift", cmd: "Cmd", super: "Super", cmd_or_ctrl: "Ctrl" };

/** The single keystroke bound to `action` ("Alt 1"), or null. */
export function keyFor(action) {
  const hit = keys().find((k) => k.action === action && !k.keys.includes(" "));
  return hit ? hit.keys.split("-").map((x) => KEY[x] ?? x.toUpperCase()).join(" ") : null;
}
