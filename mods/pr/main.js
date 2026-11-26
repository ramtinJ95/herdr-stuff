import { View } from "gpui-kit";
import { ScrollHandle } from "gpui-base";
import { checking, exec, focused, nextCommand, panes, props, readTextFile, run, settings, spaces, window as appWindow } from "herdr";
import { aboutArgs, prArgs, stepsArgs } from "./query.js";
import { classifyFailure, classifyRejection, firstLine, frameAnswer, mergeSteps, parseAbout, parseLookup, parsePr, prLookupArgs, readAnswer } from "./github.js";
import { failureDelay, keepSteps, nextPollDelay, offersMerge, stepsWanted, summarize, troubleAfter } from "./model.js";
import { liveShown, moveSelection, paneRows, rowUrl, selectedRow } from "./view.js";
import { confirmMerge, mergeMethod, mergeOffer, mergePress } from "./merge.js";
import { WIDE_PX, drawPane } from "./draw.js";

/** @typedef {import("./github.js").Snapshot} Snapshot */
/** @typedef {import("./github.js").About} About */
/** @typedef {import("./github.js").Target} Target */
/** @typedef {import("./model.js").Trouble} Trouble */
/** @typedef {import("./merge.js").MergeMethod} MergeMethod */
/** @typedef {import("./merge.js").MergeUi} MergeUi */
/** @typedef {{ cwd: string, branch: string | null, machine: string | null }} Place */
/** What is drawn of a pull request: the poll's snapshot and the description read apart from it. @typedef {{ snapshot: Snapshot, about: About | null, fetchedAt: number, source: "cache" | "live" | "replay" }} Shown */
/**
 * `method` is undefined until GitHub has answered with the repository's merge methods.
 * @typedef {{ phase: "showing", place: Place, target: Target, localHead: string | null, method: MergeMethod | null | undefined,
 *   shown: Shown | null, trouble: Trouble | null, stepsError: string | null, aboutError: string | null }} Showing
 */
/**
 * @typedef {{ phase: "idle" }
 *   | { phase: "locating", place: Place, shown: Shown | null }
 *   | { phase: "failed", place: Place, trouble: Trouble }
 *   | { phase: "no-pr", place: Place }
 *   | Showing
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
const save = (key, value) => localStorage.setItem(key, JSON.stringify(value));
const IDLE = /** @type {MergeUi} */ ({ step: "idle" });
const KEYS = { j: "down", down: "down", k: "up", up: "up", enter: "toggle", space: "toggle", o: "open", r: "refresh", escape: "escape", q: "close" };
/** What `herdr-app do pr.<command>` and key bindings may do. Merge is not here: it takes two presses in the pane, by someone looking at it. */
const COMMANDS = new Set(["down", "up", "toggle", "open", "refresh", "escape", "close"]);

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
    /** When the next poll or lookup is due, in ms; null is "not until asked". */
    this.due = null;
    /** Set when what is wanted beside the snapshot may have changed: another check selected, the description opened. */
    this.more = false;
    this.busy = false;
    this.wasShown = false;
    this.resetAt = null;
    this.selected = null;
    this.folds = new Map();
    this.aboutOpen = this.saved(ABOUT_OPEN, true) === true;
    this.expanded = false;
    this.wide = false;
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
        else if (COMMANDS.has(command) && focused()?.tab === this.tab) {
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
      this.more = false;
      this.due = Date.now();
    }
    const lapsed = this.merge.step === "armed" && this.offer(Date.now()).look !== "armed";
    if (lapsed) this.merge = IDLE;
    this.pump(cx);
    return moved || lapsed;
  }

  onScreen(phase) {
    // Opening the pane, or its terminal moving, is asked for, so that first look goes ahead even in a hidden window.
    return (appWindow()?.visible !== false || phase === "locating") && focused()?.tab === this.tab;
  }

  /** Runs the one thing there is to do, if nothing is running; whatever it was, it looks again when done. */
  pump(cx) {
    const s = this.state;
    if (checking() || s.phase === "idle" || s.phase === "replay") return;
    const shown = this.onScreen(s.phase);
    if (shown && !this.wasShown && this.due === null) this.due = Date.now();
    this.wasShown = shown;
    if (this.busy) return;
    const job = this.job(s, shown);
    if (job === null) return;
    this.busy = true;
    const gen = this.gen;
    cx.spawn(async (cx) => {
      try {
        await job(cx, gen);
      } finally {
        this.busy = false;
      }
      this.pump(cx);
    });
  }

  /**
   * What to do now: a merge that was confirmed, else, while the pane is on screen, the poll or lookup that is due,
   * else whatever is wanted beside the snapshot.
   * @returns {((cx: any, gen: number) => Promise<void>) | null}
   */
  job(s, shown) {
    if (this.merge.step === "running") return (cx, gen) => this.runMerge(cx, gen);
    if (!shown) return null;
    if (this.due !== null && Date.now() >= this.due) {
      this.due = null;
      return s.phase === "showing" ? (cx, gen) => this.poll(cx, gen) : (cx, gen) => this.lookup(cx, gen, s.place);
    }
    return s.phase === "showing" && this.more ? (cx, gen) => this.parts(cx, gen) : null;
  }

  /** The showing state an async step may still write to: null once the terminal has moved or the pull request is no longer shown. @returns {Showing | null} */
  showing(gen) {
    return gen === this.gen && this.state.phase === "showing" ? this.state : null;
  }

  async gh(argv, place) {
    try {
      const r = await exec("gh", argv, { cwd: place.cwd, on: place.machine, timeout: GH_TIMEOUT_MS });
      return { ...r, failure: r.code === 0 ? null : classifyFailure(r) };
    } catch (e) {
      return { code: -1, stdout: "", stderr: "", failure: classifyRejection(e) };
    }
  }

  /** A gh run read with `parse`: `{ value, failure }`. */
  async ask(argv, place, parse) {
    return readAnswer(await this.gh(argv, place), parse);
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
    const found = await this.ask(prLookupArgs(), place, parseLookup);
    if (gen !== this.gen) return;
    if (found.failure !== null) {
      const trouble = troubleAfter(this.state.phase === "failed" ? this.state.trouble : null, found.failure);
      this.state = found.failure.kind === "no-pr" ? { phase: "no-pr", place } : { phase: "failed", place, trouble };
      this.due = after(failureDelay(trouble));
      return cx.notify();
    }
    const target = found.value;
    this.remember(place, target);
    this.state = { phase: "showing", place, target, localHead: null, method: undefined, shown: this.cached(target), trouble: null, stepsError: null, aboutError: null };
    cx.notify();
    await this.poll(cx, gen);
  }

  async poll(cx, gen) {
    const was = this.showing(gen);
    if (was === null) return;
    const { target, place } = was;
    const asked = was.shown === null ? [] : stepsWanted(was.shown.snapshot, this.detailId(), STEPS_MAX);
    const [list, steps, localHead] = await Promise.all([
      this.ask(prArgs(target), place, (stdout) => {
        const raw = JSON.parse(stdout);
        return { snapshot: parsePr(raw), method: mergeMethod(raw.data.repository) };
      }),
      asked.length === 0 ? null : this.gh(stepsArgs(asked, target.host), place),
      this.head(place),
    ]);
    const s = this.showing(gen);
    if (s === null) return;
    if (list.failure !== null) {
      if (list.failure.kind === "no-pr") {
        this.state = { phase: "locating", place, shown: null };
        this.due = Date.now();
        return cx.notify();
      }
      const trouble = troubleAfter(s.trouble, list.failure);
      this.state = { ...s, localHead, trouble };
      this.due = after(failureDelay(trouble));
      return cx.notify();
    }
    const snapshot = s.shown === null ? list.value.snapshot : keepSteps(list.value.snapshot, s.shown.snapshot);
    this.resetAt = snapshot.resetAt ?? this.resetAt;
    /** @type {Showing} */
    const landed = { ...s, localHead, method: list.value.method, trouble: null, stepsError: null,
      shown: { snapshot, about: s.shown?.about ?? null, fetchedAt: Date.now(), source: "live" } };
    this.state = steps === null ? landed : this.withSteps(landed, steps);
    this.due = after(nextPollDelay(summarize(snapshot).ci.kind, snapshot.pr.state));
    cx.notify();
    await this.parts(cx, gen, asked);
    const done = this.showing(gen);
    if (done !== null) this.store(done);
  }

  /**
   * Reads what the snapshot leaves out, each only when wanted and missing: steps for the selected check and the running ones,
   * and the description while it is open and older than the pull request. `asked` are the checks whose steps were just asked for.
   */
  async parts(cx, gen, asked = []) {
    this.more = false;
    const was = this.showing(gen);
    if (was === null || was.shown === null || was.shown.source !== "live") return;
    const { target, place } = was;
    const { snapshot, about } = was.shown;
    const missing = stepsWanted(snapshot, this.detailId(), STEPS_MAX)
      .filter((id) => !asked.includes(id) && snapshot.checks.find((c) => c.id === id).steps === null);
    const behind = this.aboutOpen && about?.updatedAt !== snapshot.pr.updatedAt;
    if (missing.length === 0 && !behind) return;
    const [steps, read] = await Promise.all([
      missing.length === 0 ? null : this.gh(stepsArgs(missing, target.host), place),
      behind ? this.ask(aboutArgs(target), place, (stdout) => parseAbout(JSON.parse(stdout))) : null,
    ]);
    let s = this.showing(gen);
    if (s === null || s.shown === null) return;
    if (steps !== null) s = this.withSteps(s, steps);
    if (read !== null) s = read.failure === null ? { ...s, aboutError: null, shown: { ...s.shown, about: read.value } } : { ...s, aboutError: firstLine(read.failure.text) };
    this.state = s;
    cx.notify();
  }

  /** `s` with the steps of a STEPS_QUERY run set on its checks. gh exits 1 beside a partial answer, so its stdout is read either way. @returns {Showing} */
  withSteps(s, result) {
    try {
      return { ...s, stepsError: null, shown: { ...s.shown, snapshot: mergeSteps(s.shown.snapshot, JSON.parse(result.stdout)) } };
    } catch (e) {
      return { ...s, stepsError: firstLine((result.failure ?? classifyRejection(e)).text) };
    }
  }

  async readReplay(cx, file) {
    try {
      const text = await readTextFile(file);
      if (text === null) throw new Error(`${file} does not exist`);
      const frame = JSON.parse(text);
      this.state = { phase: "replay", file, shown: { snapshot: parsePr(frameAnswer(frame)), about: null, fetchedAt: Date.parse(frame.at), source: "replay" }, trouble: null };
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
    return saved === null ? null : { snapshot: saved.snapshot, about: saved.about ?? null, fetchedAt: saved.fetchedAt, source: "cache" };
  }

  /** Saves what is shown, without steps: they are read again for the checks that want them. */
  store({ target, shown }) {
    const key = cacheKey(target);
    const { snapshot, about, fetchedAt } = shown;
    save(key, { snapshot: { ...snapshot, checks: snapshot.checks.map((c) => ({ ...c, steps: null })) }, about, fetchedAt });
    const order = /** @type {string[]} */ (this.saved(CACHE_ORDER, []));
    if (order.at(-1) === key) return;
    const kept = [...order.filter((k) => k !== key), key];
    for (const old of kept.slice(0, -CACHE_KEPT)) localStorage.removeItem(old);
    save(CACHE_ORDER, kept.slice(-CACHE_KEPT));
  }

  /** @returns {Shown | null} */
  guess(place) {
    const target = this.saved(PLACES, {})[placeKey(place)];
    return target === undefined ? null : this.cached(target);
  }

  remember(place, target) {
    const { [placeKey(place)]: _, ...rest } = this.saved(PLACES, {});
    save(PLACES, Object.fromEntries([...Object.entries(rest).slice(-(PLACES_KEPT - 1)), [placeKey(place), target]]));
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

  select(key) {
    this.selected = key;
    this.more = true;
  }

  clickRow(cx, row) {
    if (row.kind === "group") this.folds.set(row.group.key, !row.open);
    if (row.kind === "about") {
      this.aboutOpen = !row.open;
      save(ABOUT_OPEN, this.aboutOpen);
    }
    if (row.kind === "hidden") cx.open_url(rowUrl(row, this.snapshot()));
    if (row.kind === "check") this.expanded = row.key === selectedRow(this.rows(), this.selected)?.key ? !this.expanded : true;
    this.select(row.key);
    cx.notify();
  }

  key(e, cx) {
    if (e.keystroke === "m") {
      this.pressMerge(cx, e.is_held === true);
    } else {
      this.disarm(cx);
      const action = KEYS[e.keystroke];
      if (action === undefined) return;
      this.act(action, cx);
    }
    cx.stop_propagation();
  }

  act(action, cx) {
    const rows = this.rows();
    const row = selectedRow(rows, this.selected);
    if (action === "down" || action === "up") {
      this.select(moveSelection(rows, this.selected, action === "down" ? 1 : -1));
      // Each row is one child of the list, so its place in `rows` is the child to reveal.
      this.scroll.scroll_to_item(Math.max(0, rows.findIndex((r) => r.key === this.selected)));
    } else if (action === "toggle" && row !== null) {
      if (row.kind === "check") this.expanded = !this.expanded;
      else this.clickRow(cx, row);
      this.more = true;
    } else if (action === "open" && row !== null) {
      cx.open_url(rowUrl(row, this.snapshot()));
    } else if (action === "refresh") {
      this.refresh(cx);
    } else if (action === "escape") {
      this.expanded = false;
    } else if (action === "close") {
      this.closePane();
    }
    cx.notify();
  }

  /**
   * Closes this pane: the focused one of this mod in its tab, else the only one.
   * Not named `close`: Herdr calls a view's `close` as the pane goes, and this would then take a second pane with it.
   */
  closePane() {
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

  /** What the Merge row is right now. The row is drawn from it and a press goes by it. */
  offer(now) {
    const s = this.state;
    const shown = "shown" in s ? s.shown : null;
    if (shown === null) return /** @type {import("./merge.js").Offer} */ ({ look: "none" });
    const { pr } = shown.snapshot;
    return mergeOffer(this.merge, {
      offered: offersMerge(summarize(shown.snapshot)), replay: s.phase === "replay", live: s.phase === "showing" && liveShown(shown, s.trouble),
      method: s.phase === "showing" ? s.method : undefined, head: pr.head, base: pr.baseRef, now,
    });
  }

  pressMerge(cx, held = false) {
    if (this.merge.step === "done") this.merge = IDLE;
    const now = Date.now();
    const press = mergePress(this.offer(now), { now, held });
    if (press === "arm") this.merge = { step: "armed", head: this.snapshot().pr.head, at: now };
    if (press === "confirm") this.merge = { step: "running", head: /** @type {Extract<MergeUi, { step: "armed" }>} */ (this.merge).head };
    cx.notify();
    this.pump(cx);
  }

  async runMerge(cx, gen) {
    const s = this.showing(gen);
    const { merge } = this;
    if (s === null || !s.method || merge.step !== "running") {
      this.merge = IDLE;
      return cx.notify();
    }
    const done = await confirmMerge((argv) => this.gh(argv, s.place), s.target, s.method, merge.head);
    if (gen !== this.gen) return;
    this.merge = done;
    this.due = Date.now();
    cx.notify();
  }

  /**
   * The first draw. A pane just split off is Herdr's focused pane, yet nothing hands it the keyboard: "focus" comes
   * only from pane.go. Taking it during this draw does not hold, so it is taken right after.
   */
  opened(cx) {
    this.tab = focused()?.tab ?? null;
    if (this.tab === null) return;
    cx.timer.after(0, () => {
      if (panes().some((p) => p.mod === "pr" && p.tab === this.tab && p.focused)) this.handle.focus();
    });
  }

  resized(size, cx) {
    const wide = size.width / Number(settings().zoom ?? 1) >= WIDE_PX;
    if (wide === this.wide) return;
    this.wide = wide;
    this.more = true;
    cx.notify();
  }

  render(cx) {
    if (this.tab === null) this.opened(cx);
    this.track(cx);
    return drawPane(this, Date.now());
  }
}
