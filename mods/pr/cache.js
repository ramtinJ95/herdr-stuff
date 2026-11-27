/**
 * What a copy of the pane opens on, so that it shows something at once. The newest is what any copy last showed this
 * session: module code is shared by a mod's copies, so a window starts from what its pane has read, and where its pane
 * was. localStorage, which is one store per mod and props, holds GitHub's own answers for the next session.
 */
import { parseAbout, parsePr, prKey } from "./github.js";
import { placeKey } from "./state.js";

/** @typedef {import("./state.js").Shown} Shown */
/** @typedef {import("./github.js").Target} Target */

const KEPT = 20;
const PLACES_KEPT = 50;
const ORDER = "pr:v2:order";
const PLACES = "pr:v2:places";
const nameOf = (target) => `pr:v2:${prKey(target)}`;
const aboutName = (name) => `${name}:about`;

/** @type {Map<string, Shown>} */
const SHOWN = new Map();
/** Where a pane was in a pull request as it opened a window on it. @type {Map<string, object>} */
const HANDED = new Map();

function read(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}
const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));

/** An answer read with its parser: one that does not read is no saved copy, whatever wrote it. */
function parsed(answer, parse) {
  try {
    return parse(answer);
  } catch {
    return null;
  }
}

function hold(name, shown) {
  SHOWN.delete(name);
  SHOWN.set(name, shown);
  for (const old of [...SHOWN.keys()].slice(0, -KEPT)) SHOWN.delete(old);
}

/**
 * What the pane before this one stored under `pr:v1:`, in a shape that pane reads and this one does not: it is left
 * to neither, so it goes. That pane, run again, finds no saved copy and asks GitHub.
 */
function dropEarlier() {
  for (const old of /** @type {string[]} */ (read("pr:v1:order", []))) localStorage.removeItem(old);
  localStorage.removeItem("pr:v1:order");
  localStorage.removeItem("pr:v1:places");
}

/** The saved copy of a pull request, to show until GitHub answers. @param {Target} target @returns {Shown | null} */
export function recall(target) {
  const name = nameOf(target);
  const held = SHOWN.get(name);
  if (held !== undefined) return { ...held, source: "cache" };
  const saved = read(name, null);
  const snapshot = parsed(saved?.answer, parsePr);
  if (snapshot === null || !Number.isFinite(saved.fetchedAt)) return null;
  /** @type {Shown} */
  const shown = { snapshot, about: parsed(read(aboutName(name), null), parseAbout), files: null, fetchedAt: saved.fetchedAt, source: "cache" };
  // A window opened on it before GitHub answers starts from this too.
  hold(name, shown);
  return shown;
}

/**
 * Keeps what a copy of the pane shows. `answers` are GitHub's own that it was just read from, as gh printed them: the
 * poll's and the description's. They are what is stored, and are read back with the parsers that read them here.
 * @param {Target} target @param {Shown} shown @param {{ pr?: object, about?: object }} [answers]
 */
export function keep(target, shown, answers = {}) {
  const name = nameOf(target);
  hold(name, shown);
  if (answers.about !== undefined) write(aboutName(name), answers.about);
  if (answers.pr === undefined) return;
  write(name, { fetchedAt: shown.fetchedAt, answer: answers.pr });
  const order = /** @type {string[]} */ (read(ORDER, []));
  if (order.at(-1) === name) return;
  const kept = [...order.filter((one) => one !== name), name];
  for (const old of kept.slice(0, -KEPT)) {
    localStorage.removeItem(old);
    localStorage.removeItem(aboutName(old));
  }
  write(ORDER, kept.slice(-KEPT));
  dropEarlier();
}

/**
 * The saved copy of the pull request last found at a place, to show while its branch is looked up. It is not yet known
 * to be the branch's own, so it comes without its files: a diff is read and annotated only on a pull request found.
 * @returns {Shown | null}
 */
export function guess(place) {
  const target = read(PLACES, {})[placeKey(place)];
  const shown = target === undefined ? null : recall(target);
  return shown === null ? null : { ...shown, files: null };
}

/** @param {Target} target */
export function remember(place, target) {
  const { [placeKey(place)]: _, ...rest } = read(PLACES, {});
  write(PLACES, Object.fromEntries([...Object.entries(rest).slice(-(PLACES_KEPT - 1)), [placeKey(place), target]]));
}

/**
 * A pane says where it is in a pull request, just before it opens a window on it: the row selected and the keyboard's
 * place in a diff. It is not among the window's props, since each set of props has a localStorage of its own.
 * @param {Target} target @param {object | null} first
 */
export function handOver(target, first) {
  HANDED.set(nameOf(target), first);
}

/** What the window on a pull request opens on, once: null when no pane said. @param {Target} target */
export function takeOver(target) {
  const name = nameOf(target);
  const first = HANDED.get(name) ?? null;
  HANDED.delete(name);
  return first;
}
