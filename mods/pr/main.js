import { View } from "gpui-kit";
import { InputState, ScrollHandle, VirtualListScrollHandle } from "gpui-base";
import { checking, closeOverlay, focused, hc, nextCommand, openOverlay, panes, props, run, setShared, settings, shared, spaces } from "herdr";
import { replyArgs, resolveArgs, reviewArgs } from "./query.js";
import { prKey, prRef, prUrl } from "./github.js";
import { offersMerge, summarize } from "./model.js";
import { detailOf, moveSelection, paneRows, rowIndex, rowUrl, selectedRow } from "./view.js";
import { rowLines } from "./diff.js";
import { colouredDiff } from "./pierre/colours.js";
import { confirmMerge, mergeOffer, mergePress } from "./merge.js";
import { EMPTY, activeNote, annotatedRows, itemId, markAsked, toSend } from "./review.js";
import { READ_KEYS, isMove, readClick, readStep, retryReply, startReading, typing } from "./reading.js";
import { agentOf, formatQuestion, formatReview, formatThread, postBlock, postingOf, sendResult } from "./send.js";
import { liveShown, sceneOf } from "./state.js";
import { errorText, firstLine, oneLine, plural } from "./text.js";
import { handOver, takeOver } from "./cache.js";
import { Watch, gh } from "./watch.js";
import { WIDE_PX, drawPane, lineHeight, wrapColumns } from "./draw.js";

/** @typedef {import("./github.js").File} File */
/** @typedef {import("./github.js").Thread} Thread */
/** @typedef {import("./state.js").Showing} Showing */
/** @typedef {import("./merge.js").MergeUi} MergeUi */
/** @typedef {import("./reading.js").Reading} Reading */
/** @typedef {import("./review.js").Review} Review */
/**
 * What the pane holds of the pull request it is looking at, made anew when it turns to another. `reading` is the
 * keyboard's place in a diff, null while it is in the list; `notice` is a line under the diff on what the last key did
 * or could not do. `diffs` are the files' diffs ready to draw by path, each parsed once per `files` as it is shown,
 * with why it is plain when it is, null for a file without a diff. `laid` is the diff drawn with the annotations and
 * threads among its rows, and `listed` that layout with each row's height at the width it is drawn at.
 * @typedef {{ selected: string | null, folds: Map<string, boolean>, expanded: boolean, merge: MergeUi, reading: Reading | null, notice: string | null,
 *   diffs: { files: object, byPath: Map<string, ReturnType<typeof colouredDiff> | null> } | null, laid: any, listed: any }} Look
 */

const TICK_MS = 1_000;
/**
 * What every copy of the pane agrees on is in Herdr's shared state. localStorage is one store per mod and props, so a
 * pane that follows its tab, a pane pinned to a pull request and a window each have their own.
 */
const VIEW = "pr.view";
const REVIEWS = "pr.reviews";
/** Which of Description and Files are open, and the list's width beside a diff or a check's steps. @returns {{ aboutOpen: boolean, filesOpen: boolean, listWidth: number }} */
const view = () => ({ aboutOpen: true, filesOpen: false, listWidth: 320, .../** @type {object} */ (shared(VIEW) ?? {}) });
/** The annotations on each pull request, by `prKey`. @returns {Record<string, Review>} */
const reviews = () => /** @type {any} */ (shared(REVIEWS) ?? {});
const IDLE = /** @type {MergeUi} */ ({ step: "idle" });
const KEYS = { j: "down", down: "down", k: "up", up: "up", enter: "toggle", space: "toggle", l: "read", right: "read", o: "open", r: "refresh", w: "window", escape: "escape", q: "close" };
/** What `herdr-app do pr.<command>` and key bindings may do. Merge is not here: it takes two presses in the pane, by someone looking at it. */
const COMMANDS = new Set(["down", "up", "toggle", "read", "open", "refresh", "window", "escape", "close"]);
/** The same, while the keyboard is in a diff: what its keys do. */
const READ_COMMANDS = new Set(Object.values(READ_KEYS));
/** A length the app reports, in the px the pane lays out in. */
const unzoomed = (px) => px / Number(settings().zoom ?? 1);
/** The copies of this mod that float in a window. While there is one, it is the copy in front: a pane under it neither asks GitHub nor takes commands. */
const WINDOWS = new Set();
/** @type {Set<string>} */
const NOTHING = new Set();

/** Where a pane is in a pull request as it opens a window on it. @typedef {{ selected: string, reading: Reading | null }} First */

/** @param {First | null} first what a window opens on @returns {Look} */
const freshLook = (first) =>
  ({ selected: first?.selected ?? null, folds: new Map(), expanded: first !== null, merge: IDLE, reading: first?.reading ?? null, notice: null, diffs: null, laid: null, listed: null });

export default class PullRequest extends View {
  init(_props, cx) {
    // Set by the first draw: a pane is drawn only while its tab is the one shown, and init also runs for a pane in another tab.
    /** @type {string | null} */
    this.tab = null;
    const { replay = null, pr = null, overlay = null, follow = null } = props() ?? {};
    /** The window this copy floats in, when a pane opened it there with `w`; null in a pane. @type {string | null} */
    this.overlay = overlay;
    /** The terminal pane this one follows in its tab. */
    this.follow = follow;
    this.watch = new Watch({ replay, pr });
    /** What a window opens on: the file its pane had selected, and the keyboard's place in its diff. @type {First | null} */
    this.first = overlay === null || this.watch.pin === null ? null : takeOver(this.watch.pin);
    this.look = freshLook(this.first);
    /**
     * What is on its way out of the pane, by the pull request it left from (`prKey`): the ids of questions and of
     * threads written to, and "send", "post" or "forward". It outlasts a turn away and back, so nothing goes twice.
     * @type {Map<string, Set<string>>}
     */
    this.going = new Map();
    /** The annotations last read from the shared state, and the stored text they were read from. @type {Review} */
    this.review = EMPTY;
    this.reviewStored = null;
    this.wide = false;
    this.shift = false;
    /** A press began on a window's header, which it is dragged by. */
    this.grip = false;
    /** The width and height the diff is drawn at, in px; null until it has been drawn once. */
    this.diffWidth = null;
    this.diffHeight = null;
    this.handle = cx.focus_handle();
    this.scroll = ScrollHandle.new();
    this.lines = VirtualListScrollHandle.new();
    this.fieldFocused = false;
    this.input = InputState.new({ placeholder: "" });
    this.input.on("submit", (_e, cx) => this.read("confirm", cx));
    this.input.on("focus", (_e, cx) => {
      this.fieldFocused = true;
      cx.notify();
    });
    this.input.on("blur", (_e, cx) => {
      this.fieldFocused = false;
      cx.notify();
    });
    if (checking()) return;
    if (overlay !== null) WINDOWS.add(this);
    this.watch.start(cx);
    cx.timer.every(TICK_MS, (cx) => {
      if (this.track(cx)) cx.notify();
    });
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "focus") this.handle.focus();
        else if (this.inFront()) this.command(command, cx);
        cx.notify();
      }
    });
  }

  /** Whether this copy is the one in front in the tab shown: a window covers the panes under it. */
  inFront() {
    return focused()?.tab === this.tab && (this.overlay !== null || WINDOWS.size === 0);
  }

  /** The machine the tab's space lives on, where gh runs. */
  machine() {
    return spaces().find((s) => s.tabs.some((tab) => tab.id === this.tab))?.machine ?? null;
  }

  /** Where the pane is: at the pull request it was given, else where the terminal it follows is. @returns {import("./state.js").Place | null} */
  place() {
    if (this.watch.pin !== null) return { cwd: null, branch: null, machine: this.machine(), pin: prRef(this.watch.pin) };
    const mine = panes().filter((p) => p.tab === this.tab && p.terminal);
    const pane = mine.find((p) => p.focused) ?? mine.find((p) => p.pane === this.follow) ?? mine[0];
    if (!pane?.cwd) return null;
    this.follow = pane.pane;
    return { cwd: pane.cwd, branch: pane.branch, machine: this.machine(), pin: null };
  }

  /** Looks at where the pane is and has the watch run what is due. Says whether anything changed that is to be drawn. */
  track(cx) {
    if (this.tab === null) return false;
    const moved = this.watch.turn(this.place());
    if (moved) {
      this.field(cx, this.look.reading, null);
      this.look = freshLook(this.first);
      this.first = null;
      // The row a window opens on is brought into view once the list has been drawn: before that there is nothing to scroll.
      cx.timer.after(0, () => this.scroll.scroll_to_item(rowIndex(this.rows(), this.look.selected)));
    }
    const lapsed = this.look.merge.step === "armed" && this.offer(Date.now()).look !== "armed";
    if (lapsed) this.look.merge = IDLE;
    const { aboutOpen, filesOpen } = view();
    this.watch.tend(cx, { aboutOpen, filesOpen, check: this.detailCheck() }, this.inFront());
    return moved || lapsed;
  }

  /** A command from outside the pane: `herdr-app do pr.<command>`, or a key bound to one. */
  command(action, cx) {
    if (this.reader() !== null && READ_COMMANDS.has(action)) this.read(action, cx, true);
    else if (COMMANDS.has(action)) this.act(action, cx);
  }

  key(e, cx) {
    if (typing(this.look.reading)) {
      // Enter in the field is the field's to report (its `submit`), so it is taken here only when the keyboard has left it.
      if (e.key === "escape") this.read("escape", cx);
      else if (e.key === "enter" && !this.fieldFocused) this.read("confirm", cx);
      else return;
    } else if (this.reader() !== null) {
      const action = READ_KEYS[e.keystroke];
      if (action === undefined || (e.is_held === true && !isMove(action))) return;
      this.read(action, cx);
    } else if (e.keystroke === "m") {
      this.pressMerge(cx, e.is_held === true);
    } else {
      const action = KEYS[e.keystroke];
      if (action === undefined) return void this.disarm(cx);
      this.act(action, cx);
    }
    cx.stop_propagation();
  }

  modifiers(e) {
    this.shift = e.modifiers.shift;
  }

  state() {
    return this.watch.state;
  }

  scene() {
    return sceneOf(this.watch.state);
  }

  /** The pull request shown, while a diff of it is read. @returns {Showing} */
  showing() {
    const s = this.watch.state;
    if (s.phase !== "showing" || s.shown === null) throw new Error("no pull request is shown");
    return s;
  }

  snapshot() {
    return this.scene()?.shown.snapshot ?? null;
  }

  /** The files read for the pull request shown: not null while one's diff is drawn. */
  files() {
    return this.scene()?.shown.files ?? null;
  }

  rows() {
    const shown = this.scene()?.shown ?? null;
    if (shown === null) return [];
    return paneRows(shown.snapshot, { folds: this.look.folds, ...view(), files: shown.files?.list ?? null });
  }

  /** The selected file or check whose diff or steps are drawn. */
  detail() {
    return detailOf(this.rows(), this.look.selected, this.wide, this.look.expanded);
  }

  /** The file whose diff is drawn. @returns {File | null} */
  detailFile() {
    const row = this.detail();
    return row?.kind === "file" ? row.file : null;
  }

  /** The check whose steps are drawn. */
  detailCheck() {
    const row = this.detail();
    return row?.kind === "check" ? row.check.id : null;
  }

  /** The diff of the file at `path`, ready to draw; null when the file is not among them or has no diff. */
  diffAt(path) {
    const files = this.files();
    const { look } = this;
    if (look.diffs?.files !== files) look.diffs = { files, byPath: new Map() };
    if (!look.diffs.byPath.has(path)) {
      const patch = files.list.find((file) => file.path === path)?.patch ?? null;
      look.diffs.byPath.set(path, patch === null ? null : colouredDiff(patch, files.colours, path));
    }
    return look.diffs.byPath.get(path);
  }

  /** A file's diff rows by its path, as they are numbered in annotations and threads; none for a file without a diff. */
  patched(path) {
    return this.diffAt(path)?.rows ?? [];
  }

  select(key) {
    if (key !== this.look.selected) this.lines.scroll_to_item(0);
    this.look.selected = key;
  }

  clickRow(cx, row) {
    const { look } = this;
    this.leave(cx);
    if (row.kind === "group") look.folds.set(row.group.key, !row.open);
    if (row.kind === "about") setShared(VIEW, { ...view(), aboutOpen: !row.open });
    if (row.kind === "files") setShared(VIEW, { ...view(), filesOpen: !row.open });
    if (row.kind === "hidden" || row.kind === "more-files") cx.open_url(rowUrl(row, this.snapshot()));
    if (row.kind === "check" || row.kind === "file") look.expanded = row.key === selectedRow(this.rows(), look.selected)?.key ? !look.expanded : true;
    this.select(row.key);
    cx.notify();
  }

  /** An action while the keyboard is in the list. Any of them takes back Merge's first press, and Esc then does no more. */
  act(action, cx) {
    if (this.disarm(cx) && action === "escape") return;
    const { look } = this;
    const rows = this.rows();
    const row = selectedRow(rows, look.selected);
    if (action === "down" || action === "up") {
      this.select(moveSelection(rows, look.selected, action === "down" ? 1 : -1));
      this.scroll.scroll_to_item(rowIndex(rows, look.selected));
    } else if ((action === "toggle" || action === "read") && row?.kind === "file" && row.file.patch !== null) {
      look.expanded = true;
      look.reading = startReading(row.file.path);
      this.lines.scroll_to_item(0);
    } else if (action === "toggle" && row !== null) {
      if (row.kind === "check" || row.kind === "file") look.expanded = !look.expanded;
      else this.clickRow(cx, row);
    } else if (action === "open" && row !== null) {
      cx.open_url(rowUrl(row, this.snapshot()));
    } else if (action === "refresh") {
      this.watch.refresh(cx);
    } else if (action === "escape") {
      if (this.overlay !== null && (this.wide || !look.expanded)) this.closePane();
      else look.expanded = false;
    } else if (action === "window") {
      this.popOut();
    } else if (action === "close") {
      this.closePane();
    }
    cx.notify();
  }

  /** The keyboard's place in the diff, while the file it is in is still the one drawn. @returns {Reading | null} */
  reader() {
    const { reading } = this.look;
    return reading !== null && this.detailFile()?.path === reading.path ? reading : null;
  }

  /** Gives the keyboard back to the list, and gives up what is half done in the diff. */
  leave(cx) {
    const { look } = this;
    this.field(cx, look.reading, null);
    look.reading = null;
    look.notice = null;
  }

  /** Opens the field when a reading comes to have something to type, and closes it when it no longer has. @param {Reading | null} before @param {Reading | null} after */
  field(cx, before, after) {
    if (typing(after) && after.mode !== before?.mode) {
      this.input.set_value(after.mode.body);
      // The field is drawn by the draw this asks for, and takes the keyboard only once it is.
      cx.timer.after(0, () => this.input.focus());
    } else if (typing(before) && !typing(after)) {
      this.input.set_value("");
      this.handle.focus();
    }
  }

  /** An action while the keyboard is in a diff. `command` is whether it came from outside the pane. */
  read(action, cx, command = false) {
    const { look } = this;
    const before = look.reading;
    if (before === null) return;
    // The pull request can go while a diff of it is read: the keyboard then goes back to the list.
    if (this.files() === null) {
      this.leave(cx);
      return void cx.notify();
    }
    const review = this.notes();
    const step = readStep(before, action, {
      rowsOf: (path) => this.patched(path), head: this.files().head, review, threads: this.threads(), paths: this.paths(),
      readable: this.rows().filter((r) => r.kind === "file" && r.file.patch !== null).map((r) => r.file.path),
      page: Math.floor(this.lines.viewport_size().height / lineHeight() / 2), agent: this.agent(), blocked: (event) => this.postBlocked(event),
      sending: this.sending(), typed: this.input.value(), command,
    });
    look.reading = step.reading;
    this.field(cx, before, step.reading);
    if (step.notice !== undefined) look.notice = step.notice;
    if (step.review !== review) this.keep(step.review);
    if (step.reading === null) {
      if (!this.wide) look.expanded = false;
    } else if (step.reading.path !== before.path) {
      this.openDiff(step.reading);
    } else if (step.reveal) {
      this.reveal();
    }
    for (const effect of step.effects) this.perform(cx, effect);
    if (!typing(before) && action === "window") this.popOut();
    if (!typing(before) && action === "close") this.closePane();
    cx.notify();
  }

  /** Draws another file's diff, with the keyboard's place in it near the top. @param {Reading} reading */
  openDiff(reading) {
    const row = this.rows().find((r) => r.kind === "file" && r.file.path === reading.path);
    this.select(row.key);
    const line = this.listing(row.file).at[reading.cursor];
    this.lines.scroll_to_item(Math.max(0, Math.min(line, this.notedItem(row.file) ?? line) - 3));
  }

  /**
   * A click in the diff: on a line it moves the cursor, on an annotation or a thread it makes that the one the keys
   * act on. `key` is the row's place in the list.
   */
  clickLine(cx, file, key) {
    const item = this.listing(file).items[Number(key)];
    if (item === undefined) return;
    const { look } = this;
    const before = look.reading;
    look.reading = readClick(this.reader(), file.path, item, this.shift);
    this.field(cx, before, look.reading);
    look.notice = null;
    look.expanded = true;
    cx.notify();
  }

  /** GitHub's threads on the pull request shown; none until what people wrote there has been read. @returns {Thread[]} */
  threads() {
    return this.scene()?.shown.about?.threads ?? [];
  }

  /** The files' paths in GitHub's order, which the annotations are sorted by. */
  paths() {
    return (this.files()?.list ?? []).map((file) => file.path);
  }

  /** What `r`, `x`, `z` and `f` act on at the cursor in the diff drawn: an annotation, or one of GitHub's threads. */
  active() {
    const { path, activeId, cursor } = this.reader();
    return activeNote(this.notes().annotations, this.threads(), activeId, path, this.files().head, this.patched(path), cursor);
  }

  /**
   * The annotations on the pull request shown. Every copy on the same pull request writes them to the shared state, so
   * they are read again whenever what is there is no longer what was read; the same object is kept while it is.
   */
  notes() {
    const key = this.reviewKey();
    if (key === null) return EMPTY;
    const stored = JSON.stringify(this.reviewAt(key));
    if (this.reviewStored !== stored) {
      this.reviewStored = stored;
      this.review = JSON.parse(stored);
    }
    return this.review;
  }

  /** The name the annotations on the pull request shown are saved under; null while none is shown. */
  reviewKey() {
    const { target } = this.scene() ?? { target: null };
    return target === null ? null : prKey(target);
  }

  /** The review saved under `key`: that of the pull request a send was for, which the pane may have left since. */
  reviewAt(key) {
    return reviews()[key] ?? EMPTY;
  }

  keep(review, key = this.reviewKey()) {
    setShared(REVIEWS, { ...reviews(), [key]: review });
  }

  /** A file's diff with the annotations and threads among its lines, and each row's height at the width it is drawn at. */
  listing(file) {
    const { look } = this;
    const { rows, digits } = this.diffAt(file.path);
    const { annotations } = this.notes();
    const about = this.scene().shown.about;
    if (look.laid?.rows !== rows || look.laid.annotations !== annotations || look.laid.about !== about) {
      look.laid = { rows, annotations, about, ...annotatedRows(rows, annotations, file.path, this.files().head, about?.threads ?? []) };
    }
    const { laid } = look;
    const columns = wrapColumns(this.diffWidth, digits), height = lineHeight();
    if (look.listed?.laid !== laid || look.listed.columns !== columns || look.listed.height !== height) {
      const sizes = laid.items.map((item) => (item.type === "line" ? rowLines(item.row, columns) : 1) * height);
      let end = 0;
      const tops = sizes.map((size) => (end += size) - size);
      look.listed = { laid, items: laid.items, at: laid.at, columns, height, sizes, tops };
    }
    return look.listed;
  }

  /** The diff's width as it is drawn, which its lines fold at. The cursor's line is kept on screen as they fold anew. */
  diffResized(size, cx) {
    const width = Math.round(unzoomed(size.width)), height = Math.round(unzoomed(size.height));
    if (width === this.diffWidth && height === this.diffHeight) return;
    this.diffWidth = width;
    this.diffHeight = height;
    if (this.reader() !== null) this.reveal();
    cx.notify();
  }

  /** Brings the cursor's row on screen when part of it is off it, and with it the annotation or thread stepped to or clicked. */
  reveal() {
    const file = this.detailFile();
    const { at, tops, sizes } = this.listing(file);
    const line = at[this.look.reading.cursor], noted = this.notedItem(file) ?? line;
    const from = tops[Math.min(line, noted)], to = tops[Math.max(line, noted)] + sizes[Math.max(line, noted)];
    const top = this.lines.offset().y;
    if (from < top || to > top + this.lines.viewport_size().height) this.lines.scroll_to_item(noted, "center");
  }

  /** Where in a file's listing the annotation or thread stepped to or clicked stands; null when none is, or it is not in this file. */
  notedItem(file) {
    const id = this.look.reading?.activeId ?? null;
    if (id === null) return null;
    const found = this.listing(file).items.findIndex((item) => item.type !== "line" && itemId(item) === id);
    return found < 0 ? null : found;
  }

  /** The pull request as the agent is told of it, while a diff of it is read. @returns {import("./send.js").Subject} */
  subject() {
    const { target, shown } = this.showing();
    return { ref: prRef(target), title: shown.snapshot.pr.title, url: shown.snapshot.pr.url, head: shown.files.head };
  }

  /** The tab's agent, which questions and the review go to. */
  agent() {
    return agentOf(panes().filter((p) => p.tab === this.tab), this.follow, this.machine());
  }

  /** Why the review cannot be posted on GitHub right now, or null. */
  postBlocked(event) {
    const { shown, trouble } = this.showing();
    return postBlock({ event, count: toSend(this.notes().annotations).length, live: liveShown(shown, trouble), busy: this.sending().has("post"),
      mine: shown.about?.mine ?? null, state: shown.snapshot.pr.state });
  }

  /** Runs what a step in the diff asked to have leave the pane. @param {import("./reading.js").Effect} effect */
  perform(cx, effect) {
    const { host } = this.showing().target;
    if (effect.do === "ask") this.askAgent(cx, effect.question);
    else if (effect.do === "send") this.sendReview(cx);
    else if (effect.do === "post") this.post(cx, effect.event);
    else if (effect.do === "forward") this.forward(cx, effect.thread);
    else if (effect.do === "resolve") this.write(cx, effect.thread, resolveArgs(host, effect.thread.id, effect.to), effect.to ? "Resolved on GitHub." : "Open again on GitHub.");
    else if (effect.do === "reply") this.write(cx, effect.thread, replyArgs(host, effect.thread.id, effect.body), "Replied on GitHub.", effect.body);
  }

  /** What is on its way out of the pane from the pull request shown. */
  sending() {
    return this.going.get(this.reviewKey()) ?? NOTHING;
  }

  /**
   * Runs what leaves the pane, with `tag` among the `sending` of the pull request it leaves from while it is on its way.
   * `then` is told how it went, by which time the pane may show another pull request: what it needs of this one is read
   * before the call.
   * @template T @param {() => Promise<T>} go @param {(result: T, cx: any) => void} then
   */
  out(cx, tag, go, then) {
    const key = this.reviewKey();
    const sending = this.going.get(key) ?? new Set();
    this.going.set(key, sending.add(tag));
    cx.spawn(async (cx) => {
      const result = await go().finally(() => sending.delete(tag));
      then(result, cx);
      cx.notify();
    });
  }

  /** Types `text` into the agent's terminal and submits it. @returns {Promise<"sent" | { failed: string }>} */
  async send(text, to = this.agent()) {
    if (to.terminal === null) return { failed: to.why };
    try {
      return sendResult(await hc(["send", to.terminal, text]));
    } catch (e) {
      return { failed: firstLine(errorText(e)) };
    }
  }

  /** A question goes to the agent as it is saved. */
  askAgent(cx, question) {
    const key = this.reviewKey();
    const text = formatQuestion(this.subject(), question);
    this.out(cx, question.id, () => this.send(text), (ask) => this.keep(markAsked(this.reviewAt(key), question.id, ask), key));
  }

  /**
   * What `y` and `Y` send, and `sent`, which takes it out of the pane once it has gone: all of the annotations there
   * were when the key was pressed, from the review of the pull request they were on.
   */
  leaving() {
    const { annotations } = this.notes();
    const key = this.reviewKey(), gone = new Set(annotations.map((one) => one.id));
    const sent = () => {
      const now = this.reviewAt(key);
      this.keep({ ...now, annotations: now.annotations.filter((one) => !gone.has(one.id)) }, key);
    };
    return { annotations, count: toSend(annotations).length, sent };
  }

  /** `y`, then Enter: the review goes to the agent, and what was sent leaves the pane. */
  sendReview(cx) {
    const { annotations, count, sent } = this.leaving();
    const to = this.agent();
    const text = formatReview(this.subject(), annotations, this.paths());
    this.out(cx, "send", () => this.send(text, to), (went) => {
      if (went === "sent") sent();
      this.look.notice = went === "sent" ? `Sent ${plural(count, "annotation")} to ${to.name}.` : `Not sent, and kept here: ${went.failed}`;
    });
  }

  /**
   * `Y` or `A`, then Enter: the annotations go to GitHub as one review, a comment each on its lines, and leave the pane.
   * @param {"COMMENT" | "APPROVE"} event
   */
  post(cx, event) {
    const { target, place, shown } = this.showing();
    const { annotations, count, sent } = this.leaving();
    const posting = postingOf(annotations, this.paths(), shown.files.head, (path) => this.patched(path), event);
    this.out(cx, "post", () => gh(reviewArgs(target.host, shown.about.id, posting), place), ({ failure }, cx) => {
      if (failure !== null) return void (this.look.notice = `Not posted, and kept here: ${oneLine(failure.text)}`);
      sent();
      this.look.notice = event === "APPROVE" ? `Approved on GitHub${count === 0 ? "" : `, with ${plural(count, "annotation")}`}.` : `Posted ${plural(count, "annotation")} on GitHub.`;
      this.watch.reread(cx);
    });
  }

  /**
   * Writes to one of GitHub's threads, then reads them again. The words of a reply that did not go are put back in the
   * field where the thread is still at hand, and said in the line under the diff where it is not.
   */
  write(cx, thread, argv, done, reply = null) {
    const { place } = this.showing();
    const from = this.look;
    this.out(cx, thread.id, () => gh(argv, place), ({ failure }, cx) => {
      const { look } = this;
      const before = look === from ? this.reader() : null;
      if (failure === null) {
        look.notice = done;
        this.watch.reread(cx);
      } else if (reply !== null && before !== null && !typing(before)) {
        look.reading = retryReply(before, thread, reply, oneLine(failure.text));
        this.field(cx, before, look.reading);
      } else {
        look.notice = `GitHub did not take it: ${oneLine(failure.text)}${reply === null ? "" : ` Your words: ${reply}`}`;
      }
    });
  }

  /** `f`, then Enter: one of GitHub's threads goes to the tab's agent, with the lines it is on. */
  forward(cx, thread) {
    const to = this.agent();
    const text = formatThread(this.subject(), thread, this.patched(thread.path));
    this.out(cx, "forward", () => this.send(text, to), (went) => {
      this.look.notice = went === "sent" ? `Sent the thread to ${to.name}.` : `Not sent: ${went.failed}`;
    });
  }

  /**
   * Closes this pane: the focused one of this mod in its tab, else the only one.
   * Not named `close`: Herdr calls a view's `close` as the pane goes, and this would then take a second pane with it.
   */
  closePane() {
    if (this.overlay !== null) return void closeOverlay(this.overlay);
    const mine = this.copies();
    const pane = (mine.find((p) => p.focused) ?? mine[0])?.pane;
    if (pane !== undefined) run("pane.close", { pane });
  }

  /** The panes of this mod in this one's tab. */
  copies() {
    return panes().filter((p) => p.mod === "pr" && p.tab === this.tab);
  }

  /** Takes back Merge's first press, or the line on how a merge went. Says whether there was one. */
  disarm(cx) {
    const { look } = this;
    if (look.merge.step !== "armed" && look.merge.step !== "done") return false;
    look.merge = IDLE;
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

  /** A press on a window's header, on its way up to the pane: Herdr drags the window by it. */
  gripped() {
    this.grip = true;
  }

  pressed(cx) {
    this.handle.focus();
    this.disarm(cx);
    // Herdr drags a window by any press its mod does not stop. Only the header's is let through.
    if (this.overlay !== null && !this.grip) cx.stop_propagation();
    this.grip = false;
  }

  /** What the Merge row is right now. The row is drawn from it and a press goes by it. @returns {import("./merge.js").Offer} */
  offer(now) {
    const scene = this.scene();
    if (scene === null) return { look: "none" };
    const { snapshot, source } = scene.shown;
    return mergeOffer(this.look.merge, {
      offered: offersMerge(summarize(snapshot)), replay: source === "replay", live: liveShown(scene.shown, scene.trouble),
      method: snapshot.method, head: snapshot.pr.head, base: snapshot.pr.baseRef, now,
    });
  }

  pressMerge(cx, held = false) {
    const { look } = this;
    if (look.merge.step === "done") look.merge = IDLE;
    const now = Date.now();
    const press = mergePress(this.offer(now), { now, held });
    if (press === "arm") look.merge = { step: "armed", head: this.snapshot().pr.head, at: now };
    if (press === "confirm") {
      const { head } = /** @type {Extract<MergeUi, { step: "armed" }>} */ (look.merge);
      look.merge = { step: "running", head };
      this.watch.run(cx, async (cx, s) => {
        const method = s?.shown?.snapshot.method ?? null;
        look.merge = s === null || method === null ? IDLE : await confirmMerge((argv) => gh(argv, s.place), s.target, method, head);
        cx.notify();
        if (look === this.look) this.watch.refresh(cx);
      });
    }
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
      if (this.overlay !== null || this.copies().some((p) => p.focused)) this.handle.focus();
    });
  }

  /**
   * `w`: opens the pull request shown in a window that floats over the layout, most of the app's size, on the file
   * selected and the keyboard's place in it. The pane stays as it is; the annotations are the same ones, kept per pull
   * request, and the window starts from what this pane has read.
   */
  popOut() {
    const { target } = this.scene() ?? { target: null };
    if (target === null || this.overlay !== null) return;
    const row = selectedRow(this.rows(), this.look.selected);
    const reading = this.reader();
    handOver(target, row?.kind !== "file" ? null : { selected: row.key, reading: reading === null ? null : startReading(reading.path, reading.cursor, reading.anchor) });
    openOverlay({ mod: "pr", kind: "window", key: "pr", width: 0.94, height: 0.92, props: { pr: prUrl(target), follow: this.follow } });
  }

  /** Herdr's last call as the pane or window goes. */
  async close() {
    WINDOWS.delete(this);
  }

  resized(size, cx) {
    const wide = unzoomed(size.width) >= WIDE_PX;
    if (wide === this.wide) return;
    this.wide = wide;
    cx.notify();
  }

  render(cx) {
    if (this.tab === null) this.opened(cx);
    this.track(cx);
    return drawPane(this, Date.now());
  }
}
