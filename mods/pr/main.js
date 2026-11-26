import { View } from "gpui-kit";
import { ScrollHandle } from "gpui-base";
import { checking, exec, focused, nextCommand, panes, props, readTextFile, run, settings, spaces, window as appWindow } from "herdr";
import { aboutArgs, prArgs, stepsArgs } from "./query.js";
import { classifyFailure, classifyRejection, mergeSteps, parseAbout, parseLookup, parsePr, prLookupArgs } from "./github.js";
import { nextPollDelay, offersMerge, stepsWanted, summarize } from "./model.js";
import { liveShown, moveSelection, paneRows, resetAtOf, selectedRow } from "./view.js";
import { armedHolds, confirmMerge, mergeMethod, mergePress, repoViewArgs } from "./merge.js";
import { WIDE_PX, drawPane } from "./draw.js";

/** @typedef {import("./github.js").Snapshot} Snapshot */
/** @typedef {import("./github.js").Failure} Failure */
/** @typedef {import("./github.js").About} About */
/** @typedef {import("./view.js").Target} Target */
/** @typedef {import("./merge.js").MergeMethod} MergeMethod */
/** @typedef {import("./merge.js").MergeUi} MergeUi */
/** @typedef {{ cwd: string, branch: string | null, machine: string | null }} Place */
/** @typedef {{ failure: Failure, streak: number }} Trouble */
/** @typedef {{ snapshot: Snapshot, fetchedAt: number, source: "cache" | "live" | "replay" }} Shown */
/** @typedef {{ ask: "unasked" } | { ask: "known", method: MergeMethod | null } | { ask: "failed", text: string }} Methods */
/**
 * @typedef {{ phase: "idle" }
 *   | { phase: "locating", place: Place, shown: Shown | null }
 *   | { phase: "failed", place: Place, trouble: Trouble }
 *   | { phase: "no-pr", place: Place }
 *   | { phase: "showing", place: Place, target: Target, localHead: string | null, methods: Methods, shown: Shown | null, trouble: Trouble | null, stepsError: string | null, about: About | null, aboutError: string | null }
 *   | { phase: "replay", file: string, shown: Shown | null, trouble: Trouble | null }} State
 */

const TICK_MS = 1_000;
const STEPS_MAX = 6;
const GH_TIMEOUT_MS = 20_000;
const CACHE_KEPT = 20;
const PLACES_KEPT = 50;
const CACHE_ORDER = "pr:v1:order";
const PLACES = "pr:v1:places";
const ABOUT_OPEN = "pr:v1:about-open";
const cacheKey = (target) => `pr:v1:${target.host}/${target.owner}/${target.name}#${target.number}`;
const placeKey = (place) => (place === null ? null : JSON.stringify([place.machine, place.cwd, place.branch]));
const after = (ms) => (ms === null ? null : Date.now() + ms);
const IDLE = /** @type {MergeUi} */ ({ step: "idle" });
const KEYS = { j: "down", down: "down", k: "up", up: "up", enter: "toggle", space: "toggle", o: "open", r: "refresh", m: "merge", escape: "escape", q: "close" };
/** What `herdr-app do pr.<action>` may do. Merge is not among them: it takes two presses in the pane, by someone looking at it. */
const ACTIONS = new Set(Object.values(KEYS).filter((action) => action !== "merge"));

export default class PullRequest extends View {
  init(_props, cx) {
    // Set by the first draw: a pane is drawn only while its tab is the one shown, and init also runs for a pane in another tab.
    /** @type {string | null} */
    this.tab = null;
    const replay = props()?.replay ?? null;
    /** @type {State} */
    this.state = replay === null ? { phase: "idle" } : { phase: "replay", file: replay, shown: null, trouble: null };
    /** @type {MergeUi} */
    this.merge = IDLE;
    this.follow = null;
    this.gen = 0;
    this.due = null;
    this.busy = false;
    this.wasShown = false;
    this.resetAt = null;
    this.selected = null;
    this.folds = new Map();
    this.aboutOpen = this.saved(ABOUT_OPEN, true) === true;
    this.expanded = false;
    this.wide = false;
    this.reveal = false;
    this.handle = cx.focus_handle();
    this.scroll = ScrollHandle.new();
    if (checking()) return;
    if (replay !== null) cx.spawn(async (cx) => this.readReplay(cx, replay));
    cx.timer.every(TICK_MS, (cx) => {
      if (this.track(cx)) cx.notify();
    });
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "focus") this.handle.focus();
        else if (ACTIONS.has(command) && focused()?.tab === this.tab) {
          this.disarm(cx);
          this.act(command, cx);
        }
        cx.notify();
      }
    });
  }

  followed() {
    const mine = panes().filter((p) => p.tab === this.tab && p.terminal);
    const pane = mine.find((p) => p.focused) ?? mine.find((p) => p.pane === this.follow) ?? mine[0];
    if (!pane?.cwd) return null;
    this.follow = pane.pane;
    const machine = spaces().find((s) => s.tabs.some((tab) => tab.id === this.tab))?.machine ?? null;
    return { cwd: pane.cwd, branch: pane.branch, machine };
  }

  track(cx) {
    if (this.tab === null || this.state.phase === "replay") return false;
    const place = this.followed();
    const moved = placeKey(place) !== placeKey("place" in this.state ? this.state.place : null);
    if (moved) {
      this.gen++;
      this.state = place === null ? { phase: "idle" } : { phase: "locating", place, shown: this.guess(place) };
      this.merge = IDLE;
      this.selected = null;
      this.folds = new Map();
      this.due = Date.now();
    }
    const lapsed = this.merge.step === "armed" && !this.armed();
    if (lapsed) this.merge = IDLE;
    this.pump(cx);
    return moved || lapsed;
  }

  onScreen(phase) {
    // Opening the pane, or its terminal moving, is asked for, so that first look goes ahead even in a hidden window.
    return (appWindow()?.visible !== false || phase === "locating") && focused()?.tab === this.tab;
  }

  pump(cx) {
    const s = this.state;
    if (checking() || s.phase === "idle" || s.phase === "replay") return;
    const shown = this.onScreen(s.phase);
    if (shown && !this.wasShown && this.due === null) this.due = Date.now();
    this.wasShown = shown;
    if (this.busy || !shown || this.due === null || Date.now() < this.due || this.merge.step === "running") return;
    this.due = null;
    this.busy = true;
    const gen = this.gen;
    cx.spawn(async (cx) => {
      try {
        if (s.phase === "showing") await this.poll(cx, gen);
        else await this.lookup(cx, gen, s.place);
      } finally {
        this.busy = false;
      }
      this.pump(cx);
    });
  }

  async gh(argv, place) {
    try {
      const r = await exec("gh", argv, { cwd: place.cwd, on: place.machine, timeout: GH_TIMEOUT_MS });
      return { ...r, failure: r.code === 0 ? null : classifyFailure(r) };
    } catch (e) {
      return { code: -1, stdout: "", stderr: "", failure: classifyRejection(e) };
    }
  }

  async head(place) {
    try {
      const r = await exec("git", ["rev-parse", "HEAD"], { cwd: place.cwd, on: place.machine });
      return r.code === 0 ? r.stdout.trim() : null;
    } catch {
      return null;
    }
  }

  async lookup(cx, gen, place) {
    const [found, localHead] = await Promise.all([this.gh(prLookupArgs(), place), this.head(place)]);
    if (gen !== this.gen) return;
    let target = null;
    let failure = found.failure;
    if (failure === null) {
      try {
        target = parseLookup(found.stdout);
      } catch (e) {
        failure = classifyRejection(e);
      }
    }
    if (failure !== null) {
      const was = this.state;
      const streak = was.phase === "failed" && was.trouble.failure.kind === failure.kind ? was.trouble.streak + 1 : 1;
      this.state = failure.kind === "no-pr" ? { phase: "no-pr", place } : { phase: "failed", place, trouble: { failure, streak } };
      this.due = after(nextPollDelay({ ciKind: null, prState: null, visible: true, error: { kind: failure.kind, streak } }));
      return cx.notify();
    }
    this.remember(place, target);
    this.state = { phase: "showing", place, target, localHead, methods: { ask: "unasked" }, shown: this.cached(target), trouble: null, stepsError: null, about: null, aboutError: null };
    cx.notify();
    await this.poll(cx, gen);
  }

  async poll(cx, gen) {
    const was = /** @type {Extract<State, { phase: "showing" }>} */ (this.state);
    const { target, place } = was;
    const detail = this.detailId();
    const wanted = was.shown === null ? [] : stepsWanted(was.shown.snapshot, detail, STEPS_MAX);
    const [list, steps, localHead] = await Promise.all([
      this.gh(prArgs(target.owner, target.name, target.number, false, target.host), place),
      wanted.length === 0 ? null : this.gh(stepsArgs(wanted, target.host), place),
      this.head(place),
    ]);
    if (gen !== this.gen) return;
    let snapshot = null;
    let failure = list.failure;
    if (failure === null) {
      try {
        const raw = JSON.parse(list.stdout);
        this.resetAt = resetAtOf(raw) ?? this.resetAt;
        snapshot = parsePr(raw);
      } catch (e) {
        failure = classifyRejection(e);
      }
    }
    const s = /** @type {Extract<State, { phase: "showing" }>} */ (this.state);
    if (failure !== null) {
      if (failure.kind === "no-pr") {
        this.state = { phase: "locating", place, shown: null };
        this.due = Date.now();
        return cx.notify();
      }
      const streak = (s.trouble?.failure.kind === failure.kind ? s.trouble.streak : 0) + 1;
      this.state = { ...s, localHead, trouble: { failure, streak } };
      this.due = after(nextPollDelay({ ciKind: null, prState: null, visible: true, error: { kind: failure.kind, streak } }));
      return cx.notify();
    }
    const sum = summarize(snapshot, { localHead });
    this.land(target, { ...s, localHead, trouble: null, ...steps === null ? { snapshot, stepsError: null } : this.withSteps(snapshot, steps) });
    this.due = after(nextPollDelay({ ciKind: sum.ci.kind, prState: snapshot.pr.state, visible: true, error: null }));
    cx.notify();
    const about = this.readAbout(cx, gen);
    const late = stepsWanted(snapshot, this.detailId(), STEPS_MAX).filter((id) => !wanted.includes(id));
    if (late.length > 0 && (was.shown === null || late.includes(this.detailId()))) {
      const more = await this.gh(stepsArgs(late, target.host), place);
      if (gen !== this.gen) return;
      const now = /** @type {Extract<State, { phase: "showing" }>} */ (this.state);
      this.land(target, { ...now, ...this.withSteps(now.shown.snapshot, more) });
      cx.notify();
    }
    if (offersMerge(sum) && s.methods.ask !== "known") await this.askMethods(cx, gen);
    await about;
  }

  /** Reads what a person wrote on the PR, when there is none yet or the PR has changed since. */
  async readAbout(cx, gen) {
    const was = /** @type {Extract<State, { phase: "showing" }>} */ (this.state);
    if (was.about !== null && was.about.updatedAt === was.shown.snapshot.pr.updatedAt) return;
    const { target, place } = was;
    const r = await this.gh(aboutArgs(target.owner, target.name, target.number, target.host), place);
    if (gen !== this.gen) return;
    const now = /** @type {Extract<State, { phase: "showing" }>} */ (this.state);
    try {
      if (r.failure !== null) throw new Error(r.failure.text);
      this.state = { ...now, about: parseAbout(JSON.parse(r.stdout)), aboutError: null };
    } catch (e) {
      this.state = { ...now, aboutError: (e instanceof Error ? e.message : String(e)).split("\n")[0] };
    }
    cx.notify();
  }

  land(target, { snapshot, ...rest }) {
    const shown = { snapshot, fetchedAt: Date.now(), source: /** @type {const} */ ("live") };
    this.state = { ...rest, shown };
    this.store(target, shown);
  }

  withSteps(snapshot, result) {
    try {
      return { snapshot: mergeSteps(snapshot, JSON.parse(result.stdout)), stepsError: null };
    } catch (e) {
      return { snapshot, stepsError: (result.failure ?? classifyRejection(e)).text };
    }
  }

  async askMethods(cx, gen) {
    const s = /** @type {Extract<State, { phase: "showing" }>} */ (this.state);
    const r = await this.gh(repoViewArgs(s.target), s.place);
    if (gen !== this.gen) return;
    /** @type {Methods} */
    let methods;
    try {
      if (r.failure !== null) throw new Error(r.failure.text);
      methods = { ask: "known", method: mergeMethod(JSON.parse(r.stdout)) };
    } catch (e) {
      methods = { ask: "failed", text: e instanceof Error ? e.message : String(e) };
    }
    this.state = { .../** @type {Extract<State, { phase: "showing" }>} */ (this.state), methods };
    cx.notify();
  }

  async readReplay(cx, file) {
    try {
      const text = await readTextFile(file);
      if (text === null) throw new Error(`${file} does not exist`);
      const frame = JSON.parse(text);
      const snapshot = parsePr({ data: { rateLimit: frame.rateLimit ?? null, repository: { pullRequest: frame.pr } }, errors: frame.errors ?? null });
      this.state = { phase: "replay", file, shown: { snapshot, fetchedAt: Date.parse(frame.at), source: "replay" }, trouble: null };
    } catch (e) {
      this.state = { phase: "replay", file, shown: null, trouble: { failure: classifyRejection(e), streak: 1 } };
    }
    cx.notify();
  }

  saved(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
    } catch {
      return fallback;
    }
  }

  /** @returns {Shown | null} */
  cached(target) {
    const saved = this.saved(cacheKey(target), null);
    return saved === null ? null : { snapshot: saved.snapshot, fetchedAt: saved.fetchedAt, source: "cache" };
  }

  store(target, shown) {
    const key = cacheKey(target);
    localStorage.setItem(key, JSON.stringify({ snapshot: shown.snapshot, fetchedAt: shown.fetchedAt }));
    const kept = [.../** @type {string[]} */ (this.saved(CACHE_ORDER, [])).filter((k) => k !== key), key];
    for (const old of kept.slice(0, -CACHE_KEPT)) localStorage.removeItem(old);
    localStorage.setItem(CACHE_ORDER, JSON.stringify(kept.slice(-CACHE_KEPT)));
  }

  /** @returns {Shown | null} */
  guess(place) {
    const target = this.saved(PLACES, {})[placeKey(place)];
    return target === undefined ? null : this.cached(target);
  }

  remember(place, target) {
    const { [placeKey(place)]: _, ...rest } = this.saved(PLACES, {});
    localStorage.setItem(PLACES, JSON.stringify(Object.fromEntries([...Object.entries(rest).slice(-(PLACES_KEPT - 1)), [placeKey(place), target]])));
  }

  snapshot() {
    return "shown" in this.state && this.state.shown !== null ? this.state.shown.snapshot : null;
  }

  rows() {
    const snapshot = this.snapshot();
    return snapshot === null ? [] : paneRows(snapshot, this.folds, this.aboutOpen);
  }

  detailId() {
    const row = selectedRow(this.rows(), this.selected);
    return row?.kind === "check" && (this.wide || this.expanded) ? row.check.id : null;
  }

  needsSteps() {
    const snapshot = this.snapshot();
    const id = this.detailId();
    return snapshot !== null && id !== null && stepsWanted(snapshot, id, 1)[0] === id && snapshot.checks.find((c) => c.id === id)?.steps === null;
  }

  wantSteps() {
    if (this.state.phase === "showing" && this.needsSteps()) this.due = Date.now();
  }

  select(key) {
    this.selected = key;
    this.wantSteps();
  }

  clickRow(cx, row) {
    if (row.kind === "group") this.folds.set(row.group.key, !row.open);
    if (row.kind === "about") {
      this.aboutOpen = !row.open;
      localStorage.setItem(ABOUT_OPEN, JSON.stringify(this.aboutOpen));
    }
    if (row.kind === "hidden") this.openChecksPage();
    if (row.kind === "check") this.expanded = row.key === selectedRow(this.rows(), this.selected)?.key ? !this.expanded : true;
    this.select(row.key);
    cx.notify();
  }

  key(e, cx) {
    const action = KEYS[e.keystroke];
    if (action !== "merge") this.disarm(cx);
    if (action === undefined) return;
    if (action === "merge") this.pressMerge(cx, e.is_held === true);
    else this.act(action, cx);
    cx.stop_propagation();
  }

  act(action, cx) {
    const rows = this.rows();
    const row = selectedRow(rows, this.selected);
    if (action === "down" || action === "up") {
      this.select(moveSelection(rows, this.selected, action === "down" ? 1 : -1));
      this.reveal = true;
    } else if (action === "toggle" && row !== null) {
      if (row.kind === "check") this.expanded = !this.expanded;
      else this.clickRow(cx, row);
      this.wantSteps();
    } else if (action === "open" && row !== null) {
      if (row.kind === "check" && row.check.link !== null) this.openUrl(row.check.link);
      else if (row.kind === "about") this.openUrl(this.snapshot().pr.url);
      else this.openChecksPage();
    } else if (action === "refresh") {
      this.refresh(cx);
    } else if (action === "escape") {
      this.expanded = false;
    } else if (action === "close") {
      this.close();
    }
    cx.notify();
  }

  /** Closes this pane: the focused one of this mod in its tab, else the only one. */
  close() {
    const mine = panes().filter((p) => p.mod === "pr" && p.tab === this.tab);
    const pane = (mine.find((p) => p.focused) ?? mine[0])?.pane;
    if (pane !== undefined) run("pane.close", { pane });
  }

  disarm(cx) {
    if (this.merge.step !== "armed" && this.merge.step !== "done") return;
    this.merge = IDLE;
    cx.notify();
  }

  pressed(cx) {
    this.handle.focus();
    this.disarm(cx);
  }

  refresh(cx) {
    if (this.state.phase === "replay") return void cx.spawn(async (cx) => this.readReplay(cx, this.state.file));
    this.due = Date.now();
    this.pump(cx);
  }

  /** What a press of Merge goes by, or null when there is nothing to merge with. */
  mergeFacts() {
    const s = this.state;
    if (s.phase !== "showing" || s.shown === null || s.methods.ask !== "known" || s.methods.method === null) return null;
    const { snapshot } = s.shown;
    return { offered: offersMerge(summarize(snapshot)), fresh: liveShown(s.shown, s.trouble), head: snapshot.pr.head, now: Date.now() };
  }

  armed() {
    const facts = this.mergeFacts();
    return facts !== null && armedHolds(this.merge, facts);
  }

  pressMerge(cx, held = false) {
    const facts = this.mergeFacts();
    if (facts === null) return;
    const press = mergePress(this.merge, { ...facts, held });
    if (press === "nothing") return;
    const { head } = facts;
    if (press === "arm") {
      this.merge = { step: "armed", head, at: facts.now };
      return cx.notify();
    }
    const s = /** @type {Extract<State, { phase: "showing" }>} */ (this.state);
    const gen = this.gen;
    const { target, place } = s;
    const method = /** @type {MergeMethod} */ (/** @type {Extract<Methods, { ask: "known" }>} */ (s.methods).method);
    this.merge = { step: "running", head };
    cx.notify();
    cx.spawn(async (cx) => {
      while (this.busy) await cx.sleep(100);
      if (gen !== this.gen) return;
      this.busy = true;
      let done;
      try {
        done = await confirmMerge((argv) => this.gh(argv, place), target, method, head);
      } finally {
        this.busy = false;
      }
      if (gen !== this.gen) return;
      this.merge = done;
      this.due = Date.now();
      cx.notify();
      this.pump(cx);
    });
  }

  openChecksPage() {
    const snapshot = this.snapshot();
    if (snapshot !== null) this.openUrl(`${snapshot.pr.url}/checks`);
  }

  openUrl(url) {
    exec(appWindow()?.platform === "macos" ? "open" : "xdg-open", [url]);
  }

  resized(size, cx) {
    const wide = size.width / Number(settings().zoom ?? 1) >= WIDE_PX;
    if (wide === this.wide) return;
    this.wide = wide;
    this.wantSteps();
    cx.notify();
  }

  render(cx) {
    this.tab ??= focused()?.tab ?? null;
    this.track(cx);
    return drawPane(this, Date.now());
  }
}
