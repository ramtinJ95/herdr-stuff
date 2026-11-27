/**
 * Watches one pull request for a pane: turns the place the pane is at, or the pull request or replay frame it was
 * given, into a State, and keeps that State current by asking gh. The pane says where it is and what it wants; all
 * that asks GitHub to read is here.
 */
import { appHome, checking, exec, readTextFile, window as appWindow } from "herdr";
import * as fs from "fs/promises";
import { aboutArgs, filesArgs, lookupArgs, prArgs, stepsArgs } from "./query.js";
import { classifyFailure, classifyRejection, frameAnswer, mergeSteps, parseAbout, parseFiles, parseLookup, parsePin, parsePr, readAnswer } from "./github.js";
import { failureDelay, keepSteps, nextPollDelay, stepsWanted, summarize, troubleAfter } from "./model.js";
import { colourFiles } from "./pierre/colours.js";
import { guess, keep, recall, remember } from "./cache.js";
import { NO_ERRORS, placeKey } from "./state.js";
import { firstLine } from "./text.js";

/** @typedef {import("./state.js").Place} Place */
/** @typedef {import("./state.js").State} State */
/** @typedef {import("./state.js").Showing} Showing */
/** @typedef {import("./github.js").Target} Target */
/**
 * What the pane wants read beside the snapshot: the description, the files, and the steps of the check it draws.
 * @typedef {{ aboutOpen: boolean, filesOpen: boolean, check: string | null }} Wants
 */
/** Something to run when nothing else is; `gen` goes to `showing`. @typedef {(cx: any, gen: number) => Promise<void>} Job */
/** @template T @typedef {{ value: T, failure: null } | { value: null, failure: import("./github.js").Failure }} Answer */

const STEPS_MAX = 6;
const GH_TIMEOUT_MS = 20_000;
const after = (ms) => (ms === null ? null : Date.now() + ms);

/** Runs gh where the pane is. It never rejects: `failure` says what went wrong, null when gh exited 0. @param {Place} place */
export async function gh(argv, place) {
  try {
    const r = await exec("gh", argv, { cwd: place.cwd ?? undefined, on: place.machine, timeout: GH_TIMEOUT_MS });
    return { stdout: r.stdout, failure: r.code === 0 ? null : classifyFailure(r) };
  } catch (e) {
    return { stdout: "", failure: classifyRejection(e) };
  }
}

/** A gh run read with `parse`: `{ value, failure }`. @template T @param {(stdout: string) => T} parse @returns {Promise<Answer<T>>} */
const ask = async (argv, place, parse) => readAnswer(await gh(argv, place), parse);

/** The commit checked out where the pane is; null where that is not known. @param {Place} place */
async function headAt(place) {
  if (place.cwd === null) return null;
  try {
    const r = await exec("git", ["rev-parse", "HEAD"], { cwd: place.cwd, on: place.machine });
    return r.code === 0 ? r.stdout.trim() : null;
  } catch {
    return null;
  }
}

export class Watch {
  /** @param {{ replay: string | null, pr: string | null }} given a replay frame's file, or the pull request a pinned pane names */
  constructor({ replay, pr }) {
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
    /** Counts the places the pane has been at: what was asked at an earlier one is not written to this one. */
    this.gen = 0;
    /** When the next poll or lookup is due, in ms; null is "not until asked". */
    this.due = null;
    /** Set when what is wanted beside the snapshot may have changed: the wants moved, or the pane wrote to GitHub. */
    this.more = false;
    /** @type {Wants} */
    this.wants = { aboutOpen: false, filesOpen: false, check: null };
    this.seen = false;
    this.busy = false;
    /** @type {Job | null} */
    this.next = null;
    /** When GitHub's rate limit starts over, in ms, as last heard. */
    this.resetAt = null;
    /** Set when the pane has written to GitHub, or was asked to look again: what people wrote there is then read again whatever its date. */
    this.stale = false;
    /** The files the helper is colouring. */
    this.colouring = null;
  }

  /** Starts a replay, which is read once and not watched. */
  start(cx) {
    if (this.state.phase === "replay") this.replay(cx, this.state.file);
  }

  /** Takes the place the pane is at, null for none, and says whether that is another than before. A replay and a pane given what it cannot read stay as they are. */
  turn(place) {
    const s = this.state;
    if (s.phase === "replay" || s.phase === "bad-pin" || placeKey(place) === placeKey("place" in s ? s.place : null)) return false;
    this.gen++;
    this.state = place === null ? { phase: "idle" } : this.pin === null ? { phase: "locating", place, shown: guess(place) } : this.opening(place, this.pin);
    this.next = null;
    this.more = false;
    this.due = Date.now();
    return true;
  }

  /**
   * Runs what is due. `seen` is whether this copy of the pane is the one in front in the tab shown.
   * @param {Wants} wants
   */
  tend(cx, wants, seen) {
    if (wants.aboutOpen !== this.wants.aboutOpen || wants.filesOpen !== this.wants.filesOpen || wants.check !== this.wants.check) this.more = true;
    this.wants = wants;
    const shown = this.onScreen(seen);
    if (shown && !this.seen && this.due === null) this.due = Date.now();
    this.seen = shown;
    this.pump(cx);
  }

  onScreen(seen) {
    const s = this.state;
    // Opening the pane, or its terminal moving, is asked for, so the first look, until GitHub has answered once, goes ahead even in a hidden window.
    const first = s.phase === "locating" || (s.phase === "showing" && s.shown?.source !== "live" && s.trouble === null);
    return seen && (appWindow()?.visible !== false || first);
  }

  /** Runs the one thing there is to do, if nothing is running; whatever it was, it looks again when done. */
  pump(cx) {
    // A check of the mod draws it as far as it can without asking anything.
    if (checking() || this.busy) return;
    const job = this.job();
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
   * What to do now: what the pane asked to have run, else, while the pane is on screen, the poll or lookup that is
   * due, else whatever is wanted beside the snapshot.
   * @returns {Job | null}
   */
  job() {
    const s = this.state;
    if (this.next !== null) {
      const job = this.next;
      this.next = null;
      return job;
    }
    if (!this.seen || !("place" in s)) return null;
    if (this.due !== null && Date.now() >= this.due) {
      this.due = null;
      return s.phase === "showing" ? (cx, gen) => this.poll(cx, gen) : (cx, gen) => this.lookup(cx, gen, s.place);
    }
    if (s.phase !== "showing" || !this.more) return null;
    return async (cx, gen) => {
      this.more = false;
      await Promise.all([this.steps(cx, gen), this.written(cx, gen)]);
    };
  }

  /**
   * Has `job` run next, between polls: a merge, which is not to cross one. It is given what is shown by then, null when
   * the pane has turned elsewhere.
   * @param {(cx: any, showing: Showing | null) => Promise<void>} job
   */
  run(cx, job) {
    this.next = (cx, gen) => job(cx, this.showing(gen));
    this.pump(cx);
  }

  /** Looks again now: `r`, or after the pane changed the pull request. */
  refresh(cx) {
    if (this.state.phase === "replay") return this.replay(cx, this.state.file);
    // Resolving a thread on GitHub does not move the pull request's date, so a look that is asked for reads what people wrote again.
    this.stale = true;
    this.due = Date.now();
    this.pump(cx);
  }

  /** Has what people wrote on GitHub read again, now: the pane has just written there itself. */
  reread(cx) {
    this.stale = true;
    this.more = true;
    this.pump(cx);
  }

  /** The showing state an async step may still write to: null once the pane has turned elsewhere or the pull request is no longer shown. @returns {Showing | null} */
  showing(gen) {
    return gen === this.gen && this.state.phase === "showing" ? this.state : null;
  }

  /**
   * Sets what is shown, and keeps a copy for the next pane to open on it. `answers` are GitHub's own that it was read from.
   * @param {Showing} s
   */
  land(cx, s, answers = {}) {
    this.state = s;
    cx.notify();
    if (s.shown !== null) keep(s.target, s.shown, answers);
  }

  /** @returns {Showing} */
  opening(place, target) {
    return { phase: "showing", place, target, localHead: null, shown: recall(target), trouble: null, errors: NO_ERRORS };
  }

  async lookup(cx, gen, place) {
    const found = await ask(lookupArgs(), place, parseLookup);
    if (gen !== this.gen) return;
    if (found.failure !== null) {
      const trouble = troubleAfter(this.state.phase === "failed" ? this.state.trouble : null, found.failure, this.resetAt);
      this.state = found.failure.kind === "no-pr" ? { phase: "no-pr", place } : { phase: "failed", place, trouble };
      this.due = after(failureDelay(trouble));
      return cx.notify();
    }
    remember(place, found.value);
    this.state = this.opening(place, found.value);
    cx.notify();
    await this.poll(cx, gen);
  }

  async poll(cx, gen) {
    const was = this.showing(gen);
    if (was === null) return;
    const { target, place } = was;
    this.more = false;
    const [list, localHead] = await Promise.all([
      ask(prArgs(target), place, (stdout) => {
        const answer = JSON.parse(stdout);
        return { answer, snapshot: parsePr(answer) };
      }),
      headAt(place),
    ]);
    const s = this.showing(gen);
    if (s === null) return;
    if (list.failure !== null) {
      if (list.failure.kind === "no-pr" && place.pin === null) {
        this.state = { phase: "locating", place, shown: null };
        this.due = Date.now();
        return cx.notify();
      }
      const trouble = troubleAfter(s.trouble, list.failure, this.resetAt);
      this.state = { ...s, localHead, trouble };
      this.due = after(failureDelay(trouble));
      return cx.notify();
    }
    const fetchedAt = Date.now();
    const fresh = s.shown === null ? list.value.snapshot : keepSteps(list.value.snapshot, s.shown.snapshot);
    this.resetAt = fresh.resetAt ?? this.resetAt;
    this.due = after(nextPollDelay(summarize(fresh).ci.kind, fresh.pr.state));
    // The steps land with the list they belong to, so a running job's step is never missing between the two.
    const steps = await this.askSteps(target, place, fresh);
    const now = this.showing(gen);
    if (now === null) return;
    this.land(cx, this.withSteps({ ...now, localHead, trouble: null, errors: { ...now.errors, steps: null },
      shown: { snapshot: fresh, about: now.shown?.about ?? null, files: now.shown?.files ?? null, fetchedAt, source: "live" } }, steps), { pr: list.value.answer });
    await this.written(cx, gen);
  }

  /** Asks for the steps `snapshot` wants and lacks: those of the check the pane draws and of the running jobs. Null when it lacks none. */
  askSteps(target, place, snapshot) {
    const lacking = stepsWanted(snapshot, this.wants.check, STEPS_MAX).filter((id) => snapshot.checks.find((c) => c.id === id).steps === null);
    return lacking.length === 0 ? null : gh(stepsArgs(target.host, lacking), place);
  }

  /** `s` with the steps of an `askSteps` run set on its checks. gh exits 1 beside a partial answer, so its stdout is read either way. @returns {Showing} */
  withSteps(s, result) {
    if (result === null) return s;
    try {
      return { ...s, errors: { ...s.errors, steps: null }, shown: { ...s.shown, snapshot: mergeSteps(s.shown.snapshot, JSON.parse(result.stdout)) } };
    } catch (e) {
      return { ...s, errors: { ...s.errors, steps: firstLine((result.failure ?? classifyRejection(e)).text) } };
    }
  }

  /** Reads the steps the check now drawn wants, between polls. */
  async steps(cx, gen) {
    const was = this.showing(gen);
    if (was === null || was.shown === null || was.shown.source !== "live") return;
    const result = await this.askSteps(was.target, was.place, was.shown.snapshot);
    const s = this.showing(gen);
    if (result !== null && s !== null && s.shown !== null) this.land(cx, this.withSteps(s, result));
  }

  /**
   * Reads what people wrote and the files, each only while wanted and behind: the description and the threads while
   * either is open and older than the pull request, the files while they are open and of another head commit, with
   * their colours after them.
   */
  async written(cx, gen) {
    const was = this.showing(gen);
    if (was === null || was.shown === null || was.shown.source !== "live") return;
    const { target, place } = was;
    const { snapshot, about, files } = was.shown;
    const { aboutOpen, filesOpen } = this.wants;
    const behind = (aboutOpen || filesOpen) && (this.stale || about?.updatedAt !== snapshot.pr.updatedAt);
    const moved = filesOpen && files?.head !== snapshot.pr.head;
    if (behind) this.stale = false;
    const [read, listed] = await Promise.all([
      behind ? ask(aboutArgs(target), place, (stdout) => {
        const answer = JSON.parse(stdout);
        return { answer, about: parseAbout(answer) };
      }) : null,
      moved ? ask(filesArgs(target), place, (stdout) => parseFiles(JSON.parse(stdout))) : null,
    ]);
    let s = this.showing(gen);
    if (s === null || s.shown === null) return;
    if (read !== null) {
      s = read.failure === null ? { ...s, errors: { ...s.errors, about: null }, shown: { ...s.shown, about: read.value.about } }
        : { ...s, errors: { ...s.errors, about: firstLine(read.failure.text) } };
    }
    if (listed !== null) {
      s = listed.failure === null ? { ...s, errors: { ...s.errors, files: null }, shown: { ...s.shown, files: { head: snapshot.pr.head, list: listed.value } } }
        : { ...s, errors: { ...s.errors, files: firstLine(listed.failure.text) } };
    }
    if (read !== null || listed !== null) this.land(cx, s, read?.failure === null ? { about: read.value.answer } : {});
    this.colour(cx, gen);
  }

  /**
   * Has the helper in `pierre/` colour the files shown, where they have no colours yet. The files are drawn plain as
   * they land and their colours follow apart from any job: no poll waits for node. The helper runs on this computer
   * wherever gh ran: the diffs are already here, and it is this computer's node and `npm install` the README asks for.
   */
  colour(cx, gen) {
    const files = this.showing(gen)?.shown?.files ?? null;
    if (files === null || files.colours !== undefined || this.colouring === files.list) return;
    this.colouring = files.list;
    cx.spawn(async (cx) => {
      const colours = await colourFiles(files.list, { helper: `${appHome()}/mods/pr/pierre/highlight.mjs`, folder: `${appHome()}/cache/pr`, exec, fs });
      if (this.colouring === files.list) this.colouring = null;
      const s = this.showing(gen);
      if (s !== null && s.shown?.files?.list === files.list) this.land(cx, { ...s, shown: { ...s.shown, files: { ...s.shown.files, colours } } });
    });
  }

  replay(cx, file) {
    cx.spawn(async (cx) => {
      try {
        const text = await readTextFile(file);
        if (text === null) throw new Error(`${file} does not exist`);
        const frame = JSON.parse(text);
        this.state = { phase: "replay", file, shown: { snapshot: parsePr(frameAnswer(frame)), about: null, files: null, fetchedAt: Date.parse(frame.at), source: "replay" }, trouble: null };
      } catch (e) {
        this.state = { phase: "replay", file, shown: null, trouble: troubleAfter(null, classifyRejection(e), null) };
      }
      cx.notify();
    });
  }
}
