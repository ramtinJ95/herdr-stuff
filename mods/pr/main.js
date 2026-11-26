import { View } from "gpui-kit";
import { InputState, ScrollHandle, VirtualListScrollHandle } from "gpui-base";
import { appHome, checking, closeOverlay, exec, focused, hc, nextCommand, openOverlay, panes, props, readTextFile, run, setShared, settings, shared, spaces, window as appWindow } from "herdr";
import * as fs from "fs/promises";
import { aboutArgs, filesArgs, prArgs, stepsArgs } from "./query.js";
import { classifyFailure, classifyRejection, firstLine, frameAnswer, mergeSteps, parseAbout, parseFiles, parseLookup, parsePin, parsePr, prLookupArgs, readAnswer } from "./github.js";
import { failureDelay, keepSteps, nextPollDelay, offersMerge, plural, stepsWanted, summarize, troubleAfter } from "./model.js";
import { liveShown, moveSelection, paneRows, rowUrl, selectedRow } from "./view.js";
import { coloursOf, diffOf, helperInput, noColours, plainNote, rowLines } from "./diff.js";
import { confirmMerge, mergeMethod, mergeOffer, mergePress } from "./merge.js";
import { EMPTY, KINDS, REVIEW_KEYS, activeAnnotation, agentOf, annotatedRows, dropAnnotation, formatQuestion, formatReview, isMove, markAsked, moveCursor, saveDraft,
  sendResult, sortAnnotations, stepAnnotation, stretch, targetOf, toSend } from "./review.js";
import { WIDE_PX, drawPane, lineHeight, wrapColumns } from "./draw.js";

/** @typedef {import("./github.js").Snapshot} Snapshot */
/** @typedef {import("./github.js").About} About */
/** @typedef {import("./github.js").File} File */
/** @typedef {import("./github.js").Target} Target */
/** @typedef {import("./model.js").Trouble} Trouble */
/** @typedef {import("./merge.js").MergeMethod} MergeMethod */
/** @typedef {import("./merge.js").MergeUi} MergeUi */
/** Where gh runs. A pinned pane has no folder or branch: `pin` names the pull request it was given. @typedef {{ cwd: string | null, branch: string | null, machine: string | null, pin: string | null }} Place */
/**
 * What is drawn of a pull request: the poll's snapshot, and the description and the files read apart from it.
 * `files` are those of the head commit named beside them, and are not saved.
 * @typedef {{ snapshot: Snapshot, about: About | null, files: { head: string, list: File[], colours?: import("./diff.js").Colours } | null, fetchedAt: number, source: "cache" | "live" | "replay" }} Shown
 */
/**
 * `method` is undefined until GitHub has answered with the repository's merge methods.
 * @typedef {{ phase: "showing", place: Place, target: Target, localHead: string | null, method: MergeMethod | null | undefined,
 *   shown: Shown | null, trouble: Trouble | null, stepsError: string | null, aboutError: string | null, filesError: string | null }} Showing
 */
/**
 * @typedef {{ phase: "idle" }
 *   | { phase: "locating", place: Place, shown: Shown | null }
 *   | { phase: "failed", place: Place, trouble: Trouble }
 *   | { phase: "no-pr", place: Place }
 *   | Showing
 *   | { phase: "replay", file: string, shown: Shown | null, trouble: Trouble | null }
 *   | { phase: "bad-pin", text: string }} State
 */

const TICK_MS = 1_000;
const STEPS_MAX = 6;
const GH_TIMEOUT_MS = 20_000;
const HELPER_TIMEOUT_MS = 60_000;
const CACHE_KEPT = 20;
const PLACES_KEPT = 50;
const CACHE_ORDER = "pr:v1:order";
const PLACES = "pr:v1:places";
/** A pull request's name in what is stored. GitHub reads an owner and a repository in any case, so one case is kept. */
const prKey = (target) => `${target.host}/${target.owner}/${target.name}#${target.number}`.toLowerCase();
const cacheKey = (target) => `pr:v1:${prKey(target)}`;
/**
 * What every copy of the pane agrees on is in Herdr's shared state. localStorage is one store per mod and props, so a
 * pane that follows its tab, a pane pinned to a pull request and a window each have their own: it holds only the cache.
 */
const VIEW = "pr.view";
const REVIEWS = "pr.reviews";
/** Which of Description and Files are open, and the list's width beside a diff or a check's steps. @returns {{ aboutOpen: boolean, filesOpen: boolean, listWidth: number }} */
const view = () => ({ aboutOpen: true, filesOpen: false, listWidth: 320, .../** @type {object} */ (shared(VIEW) ?? {}) });
/** The annotations on each pull request, by `prKey`. @returns {Record<string, import("./review.js").Review>} */
const reviews = () => /** @type {any} */ (shared(REVIEWS) ?? {});
const placeKey = (place) => (place === null ? null : JSON.stringify([place.machine, place.cwd, place.branch]));
const after = (ms) => (ms === null ? null : Date.now() + ms);
const save = (key, value) => localStorage.setItem(key, JSON.stringify(value));
const IDLE = /** @type {MergeUi} */ ({ step: "idle" });
const KEYS = { j: "down", down: "down", k: "up", up: "up", enter: "toggle", space: "toggle", l: "read", right: "read", o: "open", r: "refresh", w: "window", escape: "escape", q: "close" };
/** What `herdr-app do pr.<command>` and key bindings may do. Merge is not here: it takes two presses in the pane, by someone looking at it. */
const COMMANDS = new Set(["down", "up", "toggle", "read", "open", "refresh", "window", "escape", "close"]);
/** The same, while the keyboard is in a diff. */
const READ_COMMANDS = new Set(Object.values(REVIEW_KEYS));
/** The copies of this mod that float in a window. While there is one, the commands are its own: a pane under it leaves them be. */
const WINDOWS = new Set();
/**
 * What a pane has loaded of the pull request it opens a window on, and its place in the diff, for the window to start
 * from in place of asking GitHub again. Module code is shared by a mod's copies; the window takes it as it starts.
 * @type {{ key: string, shown: Shown, reading: { path: string, cursor: number, anchor: number | null } | null } | null}
 */
let handed = null;

export default class PullRequest extends View {
  init(_props, cx) {
    // Set by the first draw: a pane is drawn only while its tab is the one shown, and init also runs for a pane in another tab.
    /** @type {string | null} */
    this.tab = null;
    const { replay = null, pr = null, overlay = null, follow = null, file = null } = props() ?? {};
    /** The window this copy floats in, when a pane opened it there with `w`; null in a pane. @type {string | null} */
    this.overlay = overlay;
    /** What a window opens on: the file its pane had selected, and what the pane handed it. */
    this.first = file === null ? null : `file:${file}`;
    this.handed = overlay === null ? null : handed;
    if (overlay !== null) handed = null;
    /** @type {State} */
    this.state = replay === null ? { phase: "idle" } : { phase: "replay", file: replay, shown: null, trouble: null };
    /** The pull request this pane was given to show, in place of the one its tab is on. @type {Target | null} */
    this.pin = null;
    if (pr !== null && replay === null) {
      try {
        this.pin = parsePin(pr);
      } catch (e) {
        this.state = { phase: "bad-pin", text: classifyRejection(e).text };
      }
    }
    /** @type {MergeUi} */
    this.merge = IDLE;
    this.follow = follow;
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
    /** The diff last drawn, parsed once, and why it is plain when it is. @type {({ key: string, path: string, why: string | null } & ReturnType<typeof diffOf>) | null} */
    this.diffed = null;
    this.expanded = file !== null;
    this.wide = false;
    this.handle = cx.focus_handle();
    this.scroll = ScrollHandle.new();
    /** The annotations on the pull request shown, as the shared state has them under `reviewKey`. @type {import("./review.js").Review} */
    this.review = EMPTY;
    this.reviewKey = null;
    /** The stored text `review` was read from. */
    this.reviewStored = null;
    /** The keyboard's place in the diff of the file at `path`; null while it is in the list. @type {{ path: string, cursor: number, anchor: number | null } | null} */
    this.reading = null;
    /** The annotation being typed in the field. @type {import("./review.js").Draft | null} */
    this.draft = null;
    this.typing = false;
    this.activeId = null;
    /** A line under the diff on what the last key did or could not do. */
    this.notice = null;
    /** `y` was pressed: Enter sends the review. */
    this.confirming = false;
    /** What is on its way to the agent: the ids of questions, and "review" for the review. */
    this.sending = new Set();
    this.shift = false;
    /** A press began on a window's header, which it is dragged by. */
    this.grip = false;
    /** The diff's rows with the annotations among them, laid out once per diff and review. */
    this.listed = null;
    this.lines = VirtualListScrollHandle.new();
    /** The width the diff is drawn at, in px; null until it has been drawn once. */
    this.diffWidth = null;
    this.input = InputState.new({ placeholder: "" });
    this.input.on("submit", (_e, cx) => this.submit(cx));
    this.input.on("focus", (_e, cx) => {
      this.typing = true;
      cx.notify();
    });
    this.input.on("blur", (_e, cx) => {
      this.typing = false;
      cx.notify();
    });
    if (checking()) return;
    if (overlay !== null) WINDOWS.add(this);
    if (replay !== null) cx.spawn(async (cx) => this.readReplay(cx, replay));
    cx.timer.every(TICK_MS, (cx) => {
      if (this.track(cx)) cx.notify();
    });
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "focus") this.handle.focus();
        else if (focused()?.tab === this.tab && (this.overlay !== null || WINDOWS.size === 0)) {
          if (this.reader() !== null && READ_COMMANDS.has(command)) this.readAct(command, cx);
          else if (COMMANDS.has(command)) this.listAct(command, cx);
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
    return { cwd: pane.cwd, branch: pane.branch, machine: this.machine(), pin: null };
  }

  /** The machine the tab's space lives on, where gh runs. */
  machine() {
    return spaces().find((s) => s.tabs.some((tab) => tab.id === this.tab))?.machine ?? null;
  }

  /** @returns {Place} */
  pinned() {
    const { owner, name, number } = this.pin;
    return { cwd: null, branch: null, machine: this.machine(), pin: `${owner}/${name}#${number}` };
  }

  /** @returns {Showing} */
  opening(place, target) {
    // What a pane handed its window is shown as a cached copy is: at once, and not to be acted on until GitHub has answered here.
    const shown = this.handed?.key === prKey(target) ? { ...this.handed.shown, source: /** @type {const} */ ("cache") } : this.cached(target);
    return { phase: "showing", place, target, localHead: null, method: undefined, shown, trouble: null, stepsError: null, aboutError: null, filesError: null };
  }

  track(cx) {
    if (this.tab === null || this.state.phase === "replay" || this.state.phase === "bad-pin") return false;
    const place = this.pin === null ? this.followed() : this.pinned();
    const moved = placeKey(place) !== placeKey("place" in this.state ? this.state.place : null);
    if (moved) {
      this.gen++;
      this.state = place === null ? { phase: "idle" } : this.pin === null ? { phase: "locating", place, shown: this.guess(place) } : this.opening(place, this.pin);
      this.merge = IDLE;
      this.selected = this.first;
      this.first = null;
      this.folds = new Map();
      this.more = false;
      this.due = Date.now();
      this.leave();
      if (this.handed !== null && "target" in this.state && this.handed.key === prKey(this.state.target)) this.reading = this.handed.reading;
      this.handed = null;
      // The row a window opens on is brought into view once the list has been drawn: before that there is nothing to scroll.
      cx.timer.after(0, () => this.scroll.scroll_to_item(Math.max(0, this.rows().findIndex((r) => r.key === this.selected))));
    }
    const lapsed = this.merge.step === "armed" && this.offer(Date.now()).look !== "armed";
    if (lapsed) this.merge = IDLE;
    this.pump(cx);
    return moved || lapsed;
  }

  /** @param {State} s */
  onScreen(s) {
    // Opening the pane, or its terminal moving, is asked for, so the first look, until GitHub has answered once, goes ahead even in a hidden window.
    const first = s.phase === "locating" || (s.phase === "showing" && s.shown?.source !== "live" && s.trouble === null);
    return (appWindow()?.visible !== false || first) && focused()?.tab === this.tab;
  }

  /** Runs the one thing there is to do, if nothing is running; whatever it was, it looks again when done. */
  pump(cx) {
    const s = this.state;
    if (checking() || s.phase === "idle" || s.phase === "replay" || s.phase === "bad-pin") return;
    const shown = this.onScreen(s);
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
      const r = await exec("gh", argv, { cwd: place.cwd ?? undefined, on: place.machine, timeout: GH_TIMEOUT_MS });
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
    if (place.cwd === null) return null;
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
    this.state = this.opening(place, target);
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
      if (list.failure.kind === "no-pr" && place.pin === null) {
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
      shown: { snapshot, about: s.shown?.about ?? null, files: s.shown?.files ?? null, fetchedAt: Date.now(), source: "live" } };
    this.state = steps === null ? landed : this.withSteps(landed, steps);
    this.due = after(nextPollDelay(summarize(snapshot).ci.kind, snapshot.pr.state));
    cx.notify();
    await this.parts(cx, gen, asked);
    const done = this.showing(gen);
    if (done !== null) this.store(done);
  }

  /**
   * Reads what the snapshot leaves out, each only when wanted and missing: steps for the selected check and the running ones,
   * the description while it is open and older than the pull request, and the files while they are open and of another
   * head commit, with their colours after them. `asked` are the checks whose steps were just asked for.
   */
  async parts(cx, gen, asked = []) {
    this.more = false;
    const was = this.showing(gen);
    if (was === null || was.shown === null || was.shown.source !== "live") return;
    const { target, place } = was;
    const { snapshot, about, files } = was.shown;
    const missing = stepsWanted(snapshot, this.detailId(), STEPS_MAX)
      .filter((id) => !asked.includes(id) && snapshot.checks.find((c) => c.id === id).steps === null);
    const { aboutOpen, filesOpen } = view();
    const behind = aboutOpen && about?.updatedAt !== snapshot.pr.updatedAt;
    const moved = filesOpen && files?.head !== snapshot.pr.head;
    if (missing.length === 0 && !behind && !moved) return;
    const [steps, read, listed] = await Promise.all([
      missing.length === 0 ? null : this.gh(stepsArgs(missing, target.host), place),
      behind ? this.ask(aboutArgs(target), place, (stdout) => parseAbout(JSON.parse(stdout))) : null,
      moved ? this.ask(filesArgs(target), place, (stdout) => parseFiles(JSON.parse(stdout))) : null,
    ]);
    let s = this.showing(gen);
    if (s === null || s.shown === null) return;
    if (steps !== null) s = this.withSteps(s, steps);
    if (read !== null) s = read.failure === null ? { ...s, aboutError: null, shown: { ...s.shown, about: read.value } } : { ...s, aboutError: firstLine(read.failure.text) };
    if (listed !== null) {
      s = listed.failure === null ? { ...s, filesError: null, shown: { ...s.shown, files: { head: snapshot.pr.head, list: listed.value } } }
        : { ...s, filesError: firstLine(listed.failure.text) };
    }
    this.state = s;
    cx.notify();
    if (listed === null || listed.failure !== null) return;
    // The files are drawn plain as they land; their colours follow.
    const colours = await this.colour(listed.value);
    const now = this.showing(gen);
    if (now === null || now.shown?.files?.list !== listed.value) return;
    this.state = { ...now, shown: { ...now.shown, files: { ...now.shown.files, colours } } };
    cx.notify();
  }

  /**
   * The files' syntax colours, from the helper in `pierre/`. It runs on this computer wherever gh ran: the diffs are
   * already here, and it is this computer's node and `npm install` the README asks for. It never rejects: no colours
   * is an answer, with the reason in its `note`.
   * @param {File[]} list
   * @returns {Promise<import("./diff.js").Colours>}
   */
  async colour(list) {
    const folder = `${appHome()}/cache/pr`;
    const input = `${folder}/highlight-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
    const why = (e) => firstLine(classifyRejection(e).text);
    try {
      await fs.mkdir(folder, { recursive: true });
      await fs.writeFile(input, JSON.stringify(helperInput(list)));
      const colours = await exec("node", [`${appHome()}/mods/pr/pierre/highlight.mjs`, input], { timeout: HELPER_TIMEOUT_MS })
        .then(coloursOf, (e) => noColours(`No syntax colours: node did not run. ${why(e)}`));
      await fs.unlink(input);
      return colours;
    } catch (e) {
      return noColours(`No syntax colours: the helper's input could not be written or removed. ${why(e)}`);
    }
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
      this.state = { phase: "replay", file, shown: { snapshot: parsePr(frameAnswer(frame)), about: null, files: null, fetchedAt: Date.parse(frame.at), source: "replay" }, trouble: null };
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
    return saved === null ? null : { snapshot: saved.snapshot, about: saved.about ?? null, files: null, fetchedAt: saved.fetchedAt, source: "cache" };
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
    const shown = "shown" in this.state ? this.state.shown : null;
    if (shown === null) return [];
    return paneRows(shown.snapshot, { folds: this.folds, ...view(), files: shown.files?.list ?? null });
  }

  /** The file whose diff is drawn: the selected one, beside the list in a wide pane, in place of it once opened in a narrow one. @returns {File | null} */
  detailFile() {
    const row = selectedRow(this.rows(), this.selected);
    return row?.kind === "file" && (this.wide || this.expanded) ? row.file : null;
  }

  /** A file's diff ready to draw, parsed once for as long as it is the one drawn. `patch` is not null. */
  diff(file) {
    const { head, colours } = /** @type {Showing} */ (this.state).shown.files;
    const lines = colours?.byPath.get(file.path);
    const key = `${head}:${file.path}:${colours === undefined ? "plain" : "asked"}`;
    if (this.diffed?.key !== key) {
      // One scroll position serves whichever file is drawn, so another file starts at its top.
      if (this.diffed?.path !== file.path) this.lines.scroll_to_item(0);
      this.diffed = { key, path: file.path, ...diffOf(file.patch, Array.isArray(lines) ? lines : null), why: null };
    }
    this.diffed.why = plainNote(colours, file.path, this.diffed.coloured);
    return this.diffed;
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
    this.leave();
    if (row.kind === "group") this.folds.set(row.group.key, !row.open);
    if (row.kind === "about") setShared(VIEW, { ...view(), aboutOpen: !row.open });
    if (row.kind === "files") setShared(VIEW, { ...view(), filesOpen: !row.open });
    if (row.kind === "hidden" || row.kind === "more-files") cx.open_url(rowUrl(row, this.snapshot()));
    if (row.kind === "check" || row.kind === "file") this.expanded = row.key === selectedRow(this.rows(), this.selected)?.key ? !this.expanded : true;
    this.select(row.key);
    cx.notify();
  }

  key(e, cx) {
    if (this.draft !== null) {
      // While the field is open the keys are its own: Esc gives up what is typed, and Enter saves it. Enter in the field
      // is the field's to report, so it is taken here only when the keyboard has left it.
      if (e.key === "escape") this.drop();
      else if (e.key === "enter" && !this.typing) this.submit(cx);
      else return;
      cx.notify();
    } else if (this.reader() !== null) {
      const action = REVIEW_KEYS[e.keystroke];
      // A held key moves the cursor; it starts and sends nothing.
      if (action === undefined || (e.is_held === true && !isMove(action))) return;
      this.readAct(action, cx);
    } else if (e.keystroke === "m") {
      this.pressMerge(cx, e.is_held === true);
    } else {
      const action = KEYS[e.keystroke];
      if (action === undefined) return void this.disarm(cx);
      this.listAct(action, cx);
    }
    cx.stop_propagation();
  }

  /** An action while the keyboard is in the list. Any of them takes back Merge's first press, and Esc then does no more. */
  listAct(action, cx) {
    if (this.disarm(cx) && action === "escape") return;
    this.act(action, cx);
  }

  act(action, cx) {
    const rows = this.rows();
    const row = selectedRow(rows, this.selected);
    if (action === "down" || action === "up") {
      this.select(moveSelection(rows, this.selected, action === "down" ? 1 : -1));
      // Each row is one child of the list, so its place in `rows` is the child to reveal.
      this.scroll.scroll_to_item(Math.max(0, rows.findIndex((r) => r.key === this.selected)));
    } else if ((action === "toggle" || action === "read") && row?.kind === "file" && row.file.patch !== null) {
      // A diff is opened to be read: the keyboard goes into it.
      this.expanded = true;
      this.reading = { path: row.file.path, cursor: 0, anchor: null };
      this.lines.scroll_to_item(0);
    } else if (action === "toggle" && row !== null) {
      if (row.kind === "check" || row.kind === "file") this.expanded = !this.expanded;
      else this.clickRow(cx, row);
      this.more = true;
    } else if (action === "open" && row !== null) {
      cx.open_url(rowUrl(row, this.snapshot()));
    } else if (action === "refresh") {
      this.refresh(cx);
    } else if (action === "escape") {
      // Esc leaves what a narrow pane shows in place of its list. With nothing to leave, a window closes.
      if (this.overlay !== null && (this.wide || !this.expanded)) this.closePane();
      else this.expanded = false;
    } else if (action === "window") {
      this.popOut();
    } else if (action === "close") {
      this.closePane();
    }
    cx.notify();
  }

  /** The keyboard's place in the diff, while the file it is in is still the one drawn. */
  reader() {
    return this.reading !== null && this.detailFile()?.path === this.reading.path ? this.reading : null;
  }

  /** Gives the keyboard back to the list, and gives up what is half done in the diff. */
  leave() {
    this.reading = null;
    this.confirming = false;
    this.notice = null;
    this.activeId = null;
    this.drop();
  }

  /** Gives up the annotation being typed. */
  drop() {
    if (this.draft === null) return;
    this.draft = null;
    this.input.set_value("");
    this.handle.focus();
  }

  /**
   * The annotations on the pull request shown. Every copy on the same pull request writes them to the shared state, so
   * they are read again whenever what is there is no longer what was read; the same object is kept while it is.
   */
  notes() {
    if (this.state.phase !== "showing") return EMPTY;
    const key = prKey(this.state.target);
    const stored = JSON.stringify(reviews()[key] ?? EMPTY);
    if (this.reviewKey !== key || this.reviewStored !== stored) {
      this.reviewKey = key;
      this.reviewStored = stored;
      this.review = JSON.parse(stored);
    }
    return this.review;
  }

  /** The review saved under `key`: that of the pull request the send was for, which the pane may have left since. */
  reviewAt(key) {
    return reviews()[key] ?? EMPTY;
  }

  keep(review, key = this.reviewKey) {
    setShared(REVIEWS, { ...reviews(), [key]: review });
  }

  /** A file's diff with the annotations among its lines. */
  listing(file) {
    const { rows, digits } = this.diff(file);
    const { annotations } = this.notes();
    const columns = wrapColumns(this.diffWidth, digits), height = lineHeight();
    const was = this.listed;
    if (was?.rows !== rows || was.annotations !== annotations || was.columns !== columns || was.height !== height) {
      const laid = annotatedRows(rows, annotations, file.path, /** @type {Showing} */ (this.state).shown.files.head);
      // A row is as high as the lines its text folds into at this width; `tops` is where each starts.
      const sizes = laid.items.map((item) => (item.type === "line" ? rowLines(item.row, columns) : 1) * height);
      let end = 0;
      const tops = sizes.map((size) => (end += size) - size);
      this.listed = { rows, annotations, columns, height, ...laid, sizes, tops };
    }
    return this.listed;
  }

  /** The diff's width as it is drawn, which its lines fold at. The cursor's line is kept on screen as they fold anew. */
  diffResized(size, cx) {
    const width = Math.round(size.width / Number(settings().zoom ?? 1));
    if (width === this.diffWidth) return;
    this.diffWidth = width;
    const file = this.detailFile();
    if (file !== null && this.reader() !== null) this.reveal(file);
    cx.notify();
  }

  /** Brings the cursor's row on screen when part of it is off it. */
  reveal(file) {
    const { at, tops, sizes } = this.listing(file);
    const item = at[this.reading.cursor], top = this.lines.offset().y;
    if (tops[item] < top || tops[item] + sizes[item] > top + this.lines.viewport_size().height) this.lines.scroll_to_item(item, "center");
  }

  /** The pull request as the agent is told of it, while a diff of it is read. @returns {import("./review.js").Subject} */
  subject() {
    const { target, shown } = /** @type {Showing} */ (this.state);
    return { ref: `${target.owner}/${target.name}#${target.number}`, title: shown.snapshot.pr.title, url: shown.snapshot.pr.url, head: shown.files.head };
  }

  /** The tab's agent, which questions and the review go to. */
  agent() {
    return agentOf(panes().filter((p) => p.tab === this.tab), this.follow, this.machine());
  }

  /** Types `text` into the agent's terminal and submits it. @returns {Promise<"sent" | { failed: string }>} */
  async send(text) {
    const to = this.agent();
    if (to.terminal === null) return { failed: to.why };
    try {
      return sendResult(await hc(["send", to.terminal, text]));
    } catch (e) {
      return { failed: firstLine(classifyRejection(e).text) };
    }
  }

  /** What a key does while the keyboard is in a diff. */
  readAct(action, cx) {
    const file = this.detailFile();
    const at = this.reading;
    const { rows } = this.diff(file);
    const { head } = /** @type {Showing} */ (this.state).shown.files;
    const review = this.notes();
    const confirming = this.confirming;
    this.confirming = false;
    this.notice = null;
    // The diff under the cursor may have got shorter: the pull request can move while it is read.
    at.cursor = Math.min(at.cursor, rows.length - 1);
    at.anchor = at.anchor === null ? null : Math.min(at.anchor, rows.length - 1);
    if (isMove(action)) {
      at.cursor = moveCursor(action, at.cursor, rows.length, Math.floor(this.lines.viewport_size().height / lineHeight() / 2));
      this.activeId = null;
      this.reveal(file);
    } else if (action === "range") {
      at.anchor = at.anchor === null ? at.cursor : null;
    } else if (action in KINDS) {
      const { start, end } = stretch(at.cursor, at.anchor);
      this.type(cx, { kind: action, target: targetOf(file.path, head, rows, start, end), editingId: null }, "");
    } else if (action === "overall") {
      this.type(cx, { kind: "comment", target: null, editingId: null }, "");
    } else if (action === "next" || action === "previous") {
      this.step(action === "next" ? 1 : -1);
    } else if (action === "edit" || action === "delete") {
      const one = activeAnnotation(review.annotations, this.activeId, file.path, head, at.cursor);
      if (one === null) this.notice = "No annotation on this line.";
      else if (action === "edit") this.type(cx, { kind: one.kind, target: one.target, editingId: one.id }, one.body);
      else {
        this.keep(dropAnnotation(review, one.id));
        this.activeId = null;
      }
    } else if (action === "finish") {
      this.finish(cx, false);
    } else if (action === "confirm") {
      if (this.draft !== null) this.submit(cx);
      else if (confirming) this.finish(cx, true);
    } else if (action === "next-file" || action === "previous-file") {
      this.turn(action === "next-file" ? 1 : -1);
    } else if (action === "escape") {
      // One thing at a time is given up: the field, the question before sending, the range, then the diff.
      if (this.draft !== null) this.drop();
      else if (!confirming && at.anchor !== null) at.anchor = null;
      else if (!confirming) {
        this.leave();
        if (!this.wide) this.expanded = false;
      }
    } else if (action === "window") {
      this.popOut();
    } else if (action === "close") {
      this.closePane();
    }
    cx.notify();
  }

  /** Opens the field on a draft. */
  type(cx, draft, body) {
    this.draft = draft;
    this.input.set_value(body);
    cx.notify();
    // The field is drawn by the draw this asks for, and takes the keyboard only once it is.
    cx.timer.after(0, () => this.input.focus());
  }

  /** Enter in the field: the draft is saved, and a question goes to the agent at once. */
  submit(cx) {
    if (this.draft === null) return;
    const { review, saved } = saveDraft(this.notes(), this.draft, this.input.value());
    this.drop();
    if (saved !== null) {
      this.keep(review);
      this.activeId = saved.id;
      if (this.reading !== null) this.reading.anchor = null;
      if (saved.kind === "question") this.askAgent(cx, saved);
    }
    cx.notify();
  }

  askAgent(cx, question) {
    const key = this.reviewKey;
    const text = formatQuestion(this.subject(), question);
    this.sending.add(question.id);
    cx.spawn(async (cx) => {
      const ask = await this.send(text);
      this.sending.delete(question.id);
      this.keep(markAsked(this.reviewAt(key), question.id, ask), key);
      cx.notify();
    });
  }

  /** `y`, then Enter: the review goes to the agent, and what was sent leaves the pane. */
  finish(cx, confirmed) {
    const review = this.notes();
    const count = toSend(review.annotations).length;
    const to = this.agent();
    if (count === 0) this.notice = review.annotations.length === 0 ? "Nothing to send yet: c, s or i notes the line." : "Nothing to send: the questions went as they were asked.";
    else if (to.terminal === null) this.notice = to.why;
    else if (this.sending.has("review")) this.notice = "The review is on its way.";
    else if (!confirmed) this.confirming = true;
    else {
      const key = this.reviewKey;
      const gone = new Set(review.annotations.map((one) => one.id));
      const text = formatReview(this.subject(), review.annotations, this.paths());
      this.sending.add("review");
      cx.spawn(async (cx) => {
        const sent = await this.send(text);
        this.sending.delete("review");
        if (sent === "sent") {
          const now = this.reviewAt(key);
          this.keep({ ...now, annotations: now.annotations.filter((one) => !gone.has(one.id)) }, key);
          this.notice = `Sent ${plural(count, "annotation")} to ${to.name}.`;
        } else {
          this.notice = `Not sent, and kept here: ${sent.failed}`;
        }
        cx.notify();
      });
    }
  }

  /** The files' paths in GitHub's order, which the annotations are sorted by. */
  paths() {
    return (/** @type {Showing} */ (this.state).shown.files?.list ?? []).map((file) => file.path);
  }

  /** Puts the keyboard in another file's diff, at `cursor`, when that file is in the list. */
  openDiff(path, cursor) {
    const row = this.rows().find((r) => r.kind === "file" && r.file.path === path && r.file.patch !== null);
    if (row === undefined) return false;
    this.select(row.key);
    this.reading = { path, cursor, anchor: null };
    // Reading the diff here starts it at its top; the cursor is then brought on screen.
    this.diff(row.file);
    this.lines.scroll_to_item(Math.max(0, this.listing(row.file).at[cursor] - 3));
    return true;
  }

  /** `h` and `l`: the annotation before or after the active one, in whichever file it is. */
  step(delta) {
    const ordered = sortAnnotations(this.notes().annotations, this.paths());
    if (ordered.length === 0) return void (this.notice = "No annotations yet.");
    const { target, id } = stepAnnotation(ordered, this.activeId, delta);
    const { head } = /** @type {Showing} */ (this.state).shown.files;
    this.activeId = id;
    if (target === null) return;
    const cursor = target.head === head ? target.start : 0;
    if (target.path !== this.reading.path) {
      if (!this.openDiff(target.path, cursor)) this.notice = `${target.path} is not among the files listed.`;
      return;
    }
    this.reading.cursor = Math.min(cursor, this.diff(this.detailFile()).rows.length - 1);
    this.reading.anchor = null;
    this.reveal(this.detailFile());
  }

  /** `n` and `p`: the next or previous file that has a diff. */
  turn(delta) {
    const files = this.rows().filter((r) => r.kind === "file" && r.file.patch !== null);
    const next = files[files.findIndex((r) => r.file.path === this.reading.path) + delta];
    if (next === undefined) this.notice = delta > 0 ? "This is the last file." : "This is the first file.";
    else this.openDiff(next.file.path, 0);
    this.activeId = null;
  }

  /**
   * A click in the diff. On a line it puts the cursor there, and with Shift held makes it the end of a range from where
   * the cursor was; on an annotation it makes that the one `r` and `x` act on. `key` is the row's place in the list.
   */
  clickLine(cx, file, key) {
    const item = this.listing(file).items[Number(key)];
    if (item === undefined) return;
    const was = this.reader();
    this.confirming = false;
    this.notice = null;
    this.expanded = true;
    if (item.type === "annotation") {
      this.reading = was ?? { path: file.path, cursor: 0, anchor: null };
      this.activeId = item.annotation.id;
    } else {
      this.reading = { path: file.path, cursor: item.index, anchor: this.shift && was !== null ? was.anchor ?? was.cursor : null };
      this.activeId = null;
    }
    cx.notify();
  }

  /**
   * Closes this pane: the focused one of this mod in its tab, else the only one.
   * Not named `close`: Herdr calls a view's `close` as the pane goes, and this would then take a second pane with it.
   */
  closePane() {
    if (this.overlay !== null) return void closeOverlay(this.overlay);
    const mine = panes().filter((p) => p.mod === "pr" && p.tab === this.tab);
    const pane = (mine.find((p) => p.focused) ?? mine[0])?.pane;
    if (pane !== undefined) run("pane.close", { pane });
  }

  /** Takes back Merge's first press, or the line on how a merge went. Says whether there was one. */
  disarm(cx) {
    if (this.merge.step !== "armed" && this.merge.step !== "done") return false;
    this.merge = IDLE;
    cx.notify();
    return true;
  }

  /** The list's width beside a diff or a check's steps, as it was last dragged to. */
  listWidth() {
    return view().listWidth;
  }

  /** A drag of the divider has ended: the list's width is kept for the next pane or window. */
  splitResized(sizes) {
    setShared(VIEW, { ...view(), listWidth: Math.round(sizes[0]) });
  }

  pressed(cx) {
    this.handle.focus();
    this.disarm(cx);
    // Herdr drags a window by any press its mod does not stop. Only the header's is let through: it sets `grip` on its way up.
    if (this.overlay !== null && !this.grip) cx.stop_propagation();
    this.grip = false;
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
      if (this.overlay !== null || panes().some((p) => p.mod === "pr" && p.tab === this.tab && p.focused)) this.handle.focus();
    });
  }

  /**
   * `w`: opens the pull request shown in a window that floats over the layout, most of the app's size, on the file
   * selected. The pane stays as it is; the annotations are the same ones, kept per pull request.
   */
  popOut() {
    if (this.state.phase !== "showing" || this.state.shown === null || this.overlay !== null) return;
    const { target, shown } = this.state;
    const row = selectedRow(this.rows(), this.selected);
    const reading = this.reader();
    // Files whose colours are still on their way are left out: the window reads them itself, colours and all.
    handed = { key: prKey(target), shown: shown.files?.colours === undefined ? { ...shown, files: null } : shown, reading: reading === null ? null : { ...reading } };
    openOverlay({
      mod: "pr", kind: "window", key: "pr", width: 0.94, height: 0.92,
      // The pull request as this pane names it, so that the window's is the same one in what is stored.
      props: { pr: `https://${target.host}/${target.owner}/${target.name}/pull/${target.number}`, follow: this.follow, file: row?.kind === "file" ? row.file.path : null },
    });
  }

  /** Herdr's last call as the pane or window goes. */
  async close() {
    WINDOWS.delete(this);
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
