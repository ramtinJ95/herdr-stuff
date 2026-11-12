// Nexus in Herdr: what waits on you, the work in flight, every open thread with its live conversation, questions,
// review and changes, the pipeline items, the cluster and usage.
// Docked as a pane (pane.split {mod: "nexus"}) or as a floating window (mod.open:nexus); each can switch to the other.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, TextareaState } from "gpui-base";
import { closeOverlay, exec, focused, nextCommand, notify, panes, props, run, setShared, shared, spaces, theme, window as appWindow } from "herdr";
import { call, connect, follow, latestCursor, requestId } from "./api.js";
import { ago, arrivalKey, arrivals, askBody, attentionLabel, attentionOf, changesThreads, countOpen, inFlight, needsYou, openItems, openQuestions, pick, presenceDue, workerTerminal } from "./model.js";
import { addMachine, reconcileMachines, showMachine } from "./machines.js";
import { applyClaude, applyHarness, emptyLive } from "./transcript.js";
import { kit } from "./ui.js";
import { pageBlocks, threadView } from "./thread.js";
import { clusterPage, itemsPage, startForm, threadList, usagePage } from "./pages.js";

const pollMs = 3_000;
/** Archiving and other changes that emit no event still show within this long; so do a shown page's items, nodes and usage. */
const fullRefreshMs = 60_000;
/** A press that asks again forgets the first press after this long. */
const confirmMs = 6_000;
/** How long Attach waits for a paused pylon to run, as `nexus attach` does. */
const wakeMs = 120_000;
/** How often a shown thread machine counts as a person present: well inside the control plane's 20 human-idle minutes. */
const presenceMs = 240_000;
const presenceKey = "nexus.presence";
const viewKey = "nexus.view";
const notifiedKey = "nexus.notified";
const pageTabs = ["items", "cluster", "usage"];
/** Keeps a press from dragging the window, so the control under it gets it. */
const stop = (_e, cx) => cx.stop_propagation();

export default class Nexus extends View {
  init(_props, cx) {
    // Props open a given view, such as pane.split {mod: "nexus", props: {thread: "th-..."}}; else the last one shown.
    const given = props() ?? {};
    const saved = given.tab !== undefined || given.thread !== undefined ? given : shared(viewKey);
    this.view = { tab: saved?.tab ?? "needs", thread: saved?.thread ?? null };
    this.conn = null;
    this.rows = [];
    this.projects = [];
    this.detail = null;
    this.cursor = null;
    this.before = null;
    this.status = { level: "info", text: "Connecting", startup: true };
    this.syncedAt = null;
    this.refreshing = false;
    this.refreshAgain = false;
    this.polling = false;
    this.sending = false;
    this.attaching = null;
    this.worker = "claude";
    this.project = null;
    this.message = TextareaState.new({ placeholder: "Message the agent", rows: 3 });
    this.prompt = TextareaState.new({ placeholder: "What should the thread do?", rows: 6 });
    this.handle = cx.focus_handle();
    // A window doesn't take the keyboard when it opens; one opened by its key is meant to be used straight away.
    if (props()?.overlay) this.handle.focus();
    // The open thread's conversation, followed while it is shown.
    this.live = null;
    this.stream = null;
    this.shownBlocks = pageBlocks;
    this.openTools = new Set();
    this.sub = "conversation";
    this.changes = null;
    this.reviewOpen = null;
    // Answers being written to a Claude worker's ask: picks by question ID, own answers by question ID and index.
    this.picks = new Map();
    this.ownInputs = new Map();
    this.seenSent = null;
    this.confirm = null;
    this.confirmAt = 0;
    this.pages = {};
    this.usagePeriod = "7d";
    cx.spawn(async (cx) => {
      try {
        this.conn = await connect();
        this.cursor = await this.newestEvent(cx);
        await this.refresh(cx, true);
        if (this.view.thread !== null) await this.loadDetail(cx, this.view.thread);
        await this.loadPages(cx, true);
      } catch (e) {
        this.fail(cx, e);
      }
    });
    cx.timer.every(pollMs, (cx) => { this.poll(cx); this.autoSeen(cx); this.expireConfirm(cx); this.presence(cx); });
    cx.timer.every(fullRefreshMs, (cx) => cx.spawn(async (cx) => {
      await this.refresh(cx, true);
      await this.loadPages(cx, this.view.thread === null);
    }));
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "focus") this.handle.focus();
        else if (command === "attach" || command === "archive") this.shownThreadCommand(cx, command);
        cx.notify();
      }
    });
  }

  close() {
    this.stream = null;
  }

  /**
   * Where polling starts: the newest event's ID, from a moment on the event stream. When the control plane has no
   * stream to give, the whole retained history instead, which is megabytes, and says so meanwhile.
   */
  async newestEvent(cx) {
    try {
      return await latestCursor(this.conn, (ms) => cx.sleep(ms));
    } catch (e) {
      this.status = { level: "info", text: `Reading the event history, as the stream refused: ${e instanceof Error ? e.message : e}`, startup: true };
      cx.notify();
      const events = await call(this.conn, "GET", "/v1/events");
      return events.at(-1)?.id ?? "0";
    }
  }

  fail(cx, e) {
    this.status = { level: "error", text: e instanceof Error ? e.message : String(e) };
    cx.notify();
  }

  post(path, body) {
    return call(this.conn, "POST", path, body);
  }

  poll(cx) {
    if (this.conn === null || this.cursor === null || this.polling) return;
    this.polling = true;
    cx.spawn(async (cx) => {
      try {
        const events = await call(this.conn, "GET", `/v1/events?since=${encodeURIComponent(this.cursor)}`);
        if (events.length > 0) {
          this.cursor = events.at(-1).id;
          if (changesThreads(events)) await this.refresh(cx, false);
        }
      } catch (e) {
        // A cursor older than the events the control plane keeps: start again from now, and read everything.
        if (/** @type {any} */ (e).status === 409) {
          this.cursor = await this.newestEvent(cx);
          await this.refresh(cx, true);
        } else this.fail(cx, e);
      } finally {
        this.polling = false;
      }
    });
  }

  /**
   * Refetches the open threads, and the projects when `all`; one at a time, with a request made meanwhile run after.
   * With `all`, it also removes the machines Attach added for threads no longer open, such as one archived elsewhere.
   */
  async refresh(cx, all) {
    if (this.conn === null) return;
    if (this.refreshing) { this.refreshAgain = true; return; }
    this.refreshing = true;
    try {
      do {
        this.refreshAgain = false;
        const [rows, projects] = await Promise.all([
          call(this.conn, "GET", "/v1/threads?status=open"),
          all || this.projects.length === 0 ? call(this.conn, "GET", "/v1/projects") : Promise.resolve(this.projects),
        ]);
        this.notifyArrivals(arrivals(this.before, rows));
        this.before = attentionOf(rows);
        this.rows = rows;
        this.projects = projects;
        this.project ??= projects[0]?.id ?? null;
        if (this.view.thread !== null) await this.loadDetail(cx, this.view.thread);
      } while (this.refreshAgain);
      if (all) await reconcileMachines(new Set(this.rows.map((r) => r.id)));
      this.syncedAt = Date.now();
      if (this.status.level === "error" || this.status.startup) this.status = { level: "info", text: "" };
      cx.notify();
    } catch (e) {
      this.fail(cx, e);
    } finally {
      this.refreshing = false;
    }
  }

  /** One toast per arrival across every copy of the panel: the copies share the record of what was posted. */
  notifyArrivals(threads) {
    if (threads.length === 0) return;
    const posted = /** @type {string[]} */ (shared(notifiedKey) ?? []);
    const fresh = threads.filter((r) => !posted.includes(arrivalKey(r)));
    if (fresh.length === 0) return;
    setShared(notifiedKey, [...posted, ...fresh.map(arrivalKey)].slice(-200));
    for (const r of fresh) {
      notify({
        title: `${attentionLabel[r.attention]}: ${r.title}`,
        body: r.project,
        level: r.attention === "reply" ? "info" : "warning",
        action: { name: "mod.open", args: { name: "nexus" } },
      });
    }
  }

  async loadDetail(cx, id) {
    try {
      const detail = await call(this.conn, "GET", `/v1/threads/${encodeURIComponent(id)}`);
      if (this.view.thread !== id) return;
      this.detail = detail;
      this.prepareAnswers(detail);
      this.openStream(cx, detail);
    } catch (e) {
      if (this.view.thread === id) this.detail = null;
      this.fail(cx, e);
    }
    cx.notify();
  }

  /** The own-answer boxes of each open ask, made here since render may not make state. */
  prepareAnswers(detail) {
    for (const q of openQuestions(detail)) {
      if (q.kind !== "ask") continue;
      q.ask.questions.forEach((_a, i) => {
        const key = `${q.id}:${i}`;
        if (!this.ownInputs.has(key)) this.ownInputs.set(key, TextareaState.new({ placeholder: "Or answer in your own words", rows: 2 }));
      });
    }
  }

  ownInput(question, index) {
    return this.ownInputs.get(`${question}:${index}`) ?? null;
  }

  pickOption(q, index, label, multi) {
    const picks = this.picks.get(q.id) ?? q.ask.questions.map(() => []);
    picks[index] = pick(picks[index] ?? [], label, multi);
    this.picks.set(q.id, picks);
  }

  answerAsk(cx, q) {
    let body;
    try {
      const own = q.ask.questions.map((_a, i) => this.ownInput(q.id, i)?.value() ?? "");
      body = askBody(q, this.picks.get(q.id) ?? [], own);
    } catch (e) {
      return this.fail(cx, e);
    }
    this.answer(cx, q, body);
  }

  answer(cx, q, body) {
    this.act(cx, "Answering", async () => {
      await this.post(`/v1/questions/${encodeURIComponent(q.id)}/answer`, body);
      this.picks.delete(q.id);
    });
  }

  land(cx, thread, body) {
    this.act(cx, "Landing", () => this.post(`/v1/threads/${thread}/land`, body));
  }

  /** A press that needs a second one: the first arms `key`, which a second press within confirmMs acts on. */
  ask(cx, key) {
    this.confirm = key;
    this.confirmAt = Date.now();
    cx.notify();
  }

  expireConfirm(cx) {
    if (this.confirm !== null && Date.now() - this.confirmAt > confirmMs) {
      this.confirm = null;
      cx.notify();
    }
  }

  /**
   * Follows the shown thread's conversation: a Claude worker's transcript or a Nexus agent's view, as frames,
   * reconnecting with backoff while the thread stays shown. One stream per copy, closed when the thread is left.
   */
  openStream(cx, detail) {
    const id = detail.thread.id;
    if (this.live?.thread === id && this.stream !== null) return;
    const kind = detail.claudeWorker ? "claude" : "harness";
    const path = kind === "claude" ? `/v1/threads/${id}/claude/events` : `/v1/threads/${id}/events`;
    const apply = kind === "claude" ? applyClaude : applyHarness;
    const token = {};
    this.stream = token;
    this.live = emptyLive(id, kind);
    this.shownBlocks = pageBlocks;
    this.openTools.clear();
    const mine = () => this.stream === token;
    cx.spawn(async (cx) => {
      let delay = 1_000;
      while (mine()) {
        try {
          await follow(this.conn, path, ({ data }) => {
            if (!mine()) return false;
            if (data === null) return true;
            this.live = { ...apply(this.live, data), error: null };
            delay = 1_000;
            cx.notify();
            return true;
          }, mine, (ms) => cx.sleep(ms));
          if (mine()) this.live = { ...this.live, error: "the stream ended" };
        } catch (e) {
          if (mine()) this.live = { ...this.live, error: e instanceof Error ? e.message : String(e) };
        }
        if (!mine()) return;
        cx.notify();
        await cx.sleep(delay);
        delay = Math.min(delay * 2, 30_000);
      }
    });
  }

  /**
   * Marks the shown reply seen, as the dashboard does once it shows the conversation: only while the window is
   * active and this copy is on screen, with the reply's own timestamp, so one that lands after is not marked.
   */
  autoSeen(cx) {
    const d = this.detail;
    if (d === null || this.view.thread !== d.thread.id || d.attention !== "reply" || d.lastReplyAt === null) return;
    if (this.live?.thread !== d.thread.id || !this.live.loaded || this.seenSent === `${d.thread.id}:${d.lastReplyAt}`) return;
    if (!appWindow().active || !this.onScreen()) return;
    this.seenSent = `${d.thread.id}:${d.lastReplyAt}`;
    cx.spawn(async (cx) => {
      try {
        await this.post(`/v1/threads/${d.thread.id}/seen`, { lastReplyAt: d.lastReplyAt });
        await this.refresh(cx, false);
      } catch (e) {
        this.fail(cx, e);
      }
    });
  }

  /** A window is on screen while open; a docked copy while its tab is the one shown. */
  onScreen() {
    if (props()?.overlay) return true;
    const mine = panes().find((p) => p.pane === this.ownPane());
    return mine !== undefined && mine.tab === focused()?.tab;
  }

  show(cx, view) {
    const leaving = view.thread !== undefined && view.thread !== this.view.thread;
    this.view = { ...this.view, ...view };
    setShared(viewKey, this.view);
    this.confirm = null;
    if (leaving) {
      this.stream = null;
      this.live = null;
      this.detail = null;
      this.changes = null;
      this.sub = "conversation";
    }
    if (view.thread) cx.spawn(async (cx) => this.loadDetail(cx, view.thread));
    if (this.view.thread === null && pageTabs.includes(this.view.tab)) cx.spawn(async (cx) => this.loadPage(cx, this.view.tab));
    cx.notify();
  }

  /** Loads the items, whose open count the Queued tab shows from any view, and the shown page when `shown`. */
  async loadPages(cx, shown) {
    const tabs = new Set(["items", ...shown && pageTabs.includes(this.view.tab) ? [this.view.tab] : []]);
    await Promise.all([...tabs].map((tab) => this.loadPage(cx, tab)));
  }

  /** Loads a page's data; the page keeps what it showed while it loads again. */
  async loadPage(cx, tab) {
    if (this.conn === null) return;
    const page = this.pages[tab] ?? { data: null, error: null };
    this.pages[tab] = page;
    try {
      if (tab === "items") page.data = await call(this.conn, "GET", "/v1/items");
      if (tab === "usage") page.data = await call(this.conn, "GET", `/v1/usage?since=${this.usagePeriod}&by=model,project,day`);
      if (tab === "cluster") {
        const [nodes, release] = await Promise.all([call(this.conn, "GET", "/v1/nodes"), call(this.conn, "GET", "/v1/release").catch(() => null)]);
        const health = Object.fromEntries(await Promise.all(nodes.map(async (n) =>
          [n.name, await call(this.conn, "GET", `/v1/nodes/${encodeURIComponent(n.name)}/health`)
            .then((data) => ({ data, error: null }), (e) => ({ data: null, error: e instanceof Error ? e.message : String(e) }))])));
        page.data = { nodes, release, health };
      }
      page.error = null;
    } catch (e) {
      page.error = e instanceof Error ? e.message : String(e);
    }
    cx.notify();
  }

  setUsagePeriod(cx, period) {
    this.usagePeriod = period;
    this.pages.usage = { data: null, error: null };
    cx.spawn(async (cx) => this.loadPage(cx, "usage"));
  }

  /** Reading the changes wakes a paused pylon, so they load only on a press. */
  loadChanges(cx, thread, base = "start") {
    this.changes = { thread, base, loading: true, error: null, data: null, diff: null };
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const data = await call(this.conn, "GET", `/v1/threads/${thread}/changes?base=${base}`);
        if (this.changes?.thread === thread && this.changes.base === base) this.changes = { ...this.changes, loading: false, data };
      } catch (e) {
        if (this.changes?.thread === thread) this.changes = { ...this.changes, loading: false, error: e instanceof Error ? e.message : String(e) };
      }
      cx.notify();
    });
  }

  loadDiff(cx, file) {
    const c = this.changes;
    if (c.diff?.path === file.path) { this.changes = { ...c, diff: null }; return cx.notify(); }
    this.changes = { ...c, diff: { path: file.path, text: null } };
    cx.notify();
    const paths = [file.path, ...file.oldPath ? [file.oldPath] : []].map((p) => `&path=${encodeURIComponent(p)}`).join("");
    cx.spawn(async (cx) => {
      try {
        const diff = await call(this.conn, "GET", `/v1/threads/${c.thread}/diff?base=${c.base}${paths}`);
        if (this.changes?.diff?.path === file.path) this.changes = { ...this.changes, diff: { path: file.path, text: diff.diff + (diff.truncated ? "\n… the diff was cut short" : "") } };
      } catch (e) {
        if (this.changes?.diff?.path === file.path) this.changes = { ...this.changes, diff: { path: file.path, text: `Could not read the diff: ${e instanceof Error ? e.message : e}` } };
      }
      cx.notify();
    });
  }

  act(cx, label, work, page = null) {
    if (this.sending) return;
    this.sending = true;
    this.confirm = null;
    this.status = { level: "info", text: `${label}…` };
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await work(cx);
        this.status = { level: "success", text: `${label}: done` };
        await this.refresh(cx, false);
        if (page !== null) await this.loadPage(cx, page);
      } catch (e) {
        this.fail(cx, e);
      } finally {
        this.sending = false;
        cx.notify();
      }
    });
  }

  startThread(cx) {
    const text = this.prompt.value().trim();
    if (this.project === null) return this.fail(cx, new Error("Pick a project first"));
    if (text === "") return this.fail(cx, new Error("Say what the thread should do"));
    const brief = this.worker === "claude" ? { claude: text } : { message: text };
    this.act(cx, "Starting", async (cx) => {
      const thread = await call(this.conn, "POST", "/v1/threads", { project: this.project, ...brief, requestId: requestId("start") });
      this.prompt.set_value("");
      this.show(cx, { tab: "needs", thread: thread.id });
    });
  }

  /** `followUp` waits for the current turn; `steer` joins a Nexus agent's run after its current tool round. */
  sendMessage(cx, id, mode) {
    const text = this.message.value().trim();
    if (text === "") return;
    this.act(cx, mode === "steer" ? "Steering" : "Sending", async () => {
      await this.post(`/v1/threads/${encodeURIComponent(id)}/messages`, { text, requestId: requestId("msg"), mode });
      this.message.set_value("");
    });
  }

  /**
   * `nexus.attach` and `nexus.archive`, for keys.json and `herdr-app do`: the shown thread's Attach and Archive buttons,
   * Archive with the same second press within 6 seconds.
   */
  shownThreadCommand(cx, command) {
    const d = this.detail;
    if (d === null || d.thread.id !== this.view.thread) return this.fail(cx, new Error(`nexus.${command} needs a thread shown`));
    const id = d.thread.id;
    if (d.thread.status !== "active") return this.fail(cx, new Error(`nexus.${command}: ${id} is ${d.thread.status}`));
    if (command === "attach") {
      this.attach(cx, id);
    } else if (this.confirm === `archive:${id}`) this.archive(cx, id);
    else this.ask(cx, `archive:${id}`);
  }

  /** Archives the thread and removes the machine Attach added for its pylon. */
  archive(cx, id) {
    this.act(cx, "Archiving", async () => {
      await this.post(`/v1/threads/${id}/archive`);
      await reconcileMachines(new Set(this.rows.map((r) => r.id).filter((t) => t !== id)));
    });
  }

  /**
   * Makes the thread's pylon a Herdr Core machine and shows its terminals, the worker's in front. The machine goes
   * through `nexus exec`, which never wakes a pylon, so a paused one is woken first.
   */
  attach(cx, id) {
    if (this.attaching !== null) return;
    this.attaching = id;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const detail = await this.runningPylon(cx, id);
        this.status = { level: "info", text: `Adding the pylon of ${id} as a machine…` };
        cx.notify();
        const name = await addMachine(id);
        this.status = { level: "info", text: `Waiting for Herdr to show ${name}…` };
        cx.notify();
        await showMachine(cx, name, workerTerminal(detail), detail.thread.title);
        this.status = { level: "success", text: `Attached: ${name}` };
      } catch (e) {
        this.fail(cx, e);
      } finally {
        this.attaching = null;
        cx.notify();
      }
    });
  }

  /**
   * The thread's detail once its pylon runs and its sessions are back, waking it as a person's request does, and
   * saying meanwhile what the pylon is doing. Throws for a thread not open, a failed pylon, or one still not running
   * after wakeMs.
   */
  async runningPylon(cx, id) {
    const path = `/v1/threads/${encodeURIComponent(id)}`;
    const ready = (d) => d.pylon.actualState === "running" && d.sessions.every((s) => s.state !== "paused");
    const start = Date.now();
    let woke = false;
    for (;;) {
      const d = await call(this.conn, "GET", path);
      if (d.thread.status !== "active") throw new Error(`${id} is ${d.thread.status}, so its pylon does not run: unarchive it to attach`);
      if (ready(d)) return d;
      if (d.pylon.failed) throw new Error(`The pylon of ${id} failed: ${d.pylon.failed.message ?? JSON.stringify(d.pylon.failed)}. Retry the pylon, then attach`);
      const waited = Date.now() - start;
      const state = d.pylon.actualState === "running" ? "running, its sessions not back yet" : d.pylon.actualState;
      if (waited > wakeMs) throw new Error(`The pylon of ${id} is still ${state} after ${wakeMs / 1000} s`);
      if (!woke) {
        await this.post(`${path}/activity`, { kind: "human" });
        woke = true;
      }
      this.status = { level: "info", text: `Waking the pylon of ${id}: ${state}, ${Math.round(waited / 1000)} s…` };
      cx.notify();
      await cx.sleep(2_000);
    }
  }

  /**
   * Posts human activity for the thread whose machine space the active window shows, as `nexus wake` does, so a pylon
   * a person watches in Herdr does not pause under them, and a paused one wakes. The shared record keeps the copies of
   * the panel to one post per thread per presenceMs.
   */
  presence(cx) {
    if (this.conn === null || !appWindow().active) return;
    const shown = spaces().find((s) => s.active)?.machine ?? null;
    const posted = /** @type {Record<string, number>} */ (shared(presenceKey) ?? {});
    const now = Date.now();
    const id = presenceDue(shown, new Set(this.rows.map((r) => r.id)), shown === null ? undefined : posted[shown], now, presenceMs);
    if (id === null) return;
    setShared(presenceKey, Object.fromEntries([...Object.entries(posted).filter(([, at]) => now - at < presenceMs), [id, now]]));
    cx.spawn(async (cx) => {
      try {
        await this.post(`/v1/threads/${encodeURIComponent(id)}/activity`, { kind: "human" });
      } catch (e) {
        this.fail(cx, new Error(`Counting you present in ${id} failed: ${e instanceof Error ? e.message : e}`));
      }
    });
  }

  openUrl(url) {
    exec(appWindow().platform === "macos" ? "open" : "xdg-open", [url]);
  }

  /** The pane this copy is docked in, or null in the window. */
  ownPane() {
    if (props()?.overlay) return null;
    const mine = panes().filter((p) => p.mod === "nexus");
    return (mine.find((p) => p.focused) ?? mine[0])?.pane ?? null;
  }

  popOut() {
    const pane = this.ownPane();
    run("mod.open", { name: "nexus" });
    if (pane !== null) run("pane.close", { pane });
  }

  dock() {
    closeOverlay(props().overlay);
    run("pane.split", { direction: "right", mod: "nexus" });
  }

  render(cx) {
    const ui = kit(theme());
    const { t, button } = ui;
    const now = Date.now();
    const inOverlay = Boolean(props()?.overlay);
    const host = this.conn === null ? "" : this.conn.url.replace(/^https?:\/\//, "").split(/[.:]/)[0];
    const counts = { needs: needsYou(this.rows).length, flight: inFlight(this.rows).reduce((n, g) => n + g.threads.length, 0), threads: countOpen(this.rows), items: openItems(this.pages.items?.data ?? []).length };

    const tab = (key, text) => h_flex().id(`tab-${key}`).h(28).px(10).gap(6).items_center().rounded(6).cursor_pointer()
      .bg(this.view.tab === key && this.view.thread === null ? t.selected : t.surface).hover((s) => s.bg(t.hover))
      .text_size(12.5).text_color(this.view.tab === key ? t.foreground : t.muted)
      .on_click((_e, cx) => this.show(cx, { tab: key, thread: null }))
      .child(text).when((counts[key] ?? 0) > 0, (el) => el.child(div().text_size(11).text_color(key === "needs" ? t.blocked : t.dim).child(String(counts[key]))));

    const body = this.view.thread !== null ? threadView(this, ui, now)
      : this.view.tab === "start" ? startForm(this, ui)
      : this.view.tab === "items" ? itemsPage(this, ui, now)
      : this.view.tab === "cluster" ? clusterPage(this, ui, now)
      : this.view.tab === "usage" ? usagePage(this, ui)
      : threadList(this, ui, now);
    const statusText = this.status.text || (this.syncedAt === null ? "" : `${countOpen(this.rows)} open · synced ${ago(this.syncedAt, now)}`);

    // The window drags by its header; presses below it stay with the tabs, rows, text and fields.
    return v_flex().id("nexus").track_focus(this.handle).size_full().bg(t.background).text_color(t.foreground)
      .on_key_down((e, cx) => {
        if (e.key === "escape" && inOverlay) {
          cx.stop_propagation();
          closeOverlay(props().overlay);
        }
      })
      .child(h_flex().flex_none().h(40).px(12).gap(8).items_center().border_b_1().border_color(t.border)
        .child(div().text_size(14).font_semibold().child("Nexus"))
        .child(div().flex_1().truncate().text_size(11.5).text_color(t.dim).child(host))
        .child(button("new", "New thread", (cx) => this.show(cx, { tab: "start", thread: null }), { primary: true }))
        .child(inOverlay ? button("dock", "Dock", () => this.dock()) : button("popout", "Pop out", () => this.popOut()))
        .when(inOverlay, (el) => el.child(button("close", "✕", () => closeOverlay(props().overlay)))))
      .child(h_flex().id("tabs").flex_none().flex_wrap().px(8).py(6).gap(4).border_b_1().border_color(t.border).on_mouse_down("left", stop)
        .child(tab("needs", "Needs you"))
        .child(tab("flight", "In flight"))
        .child(tab("threads", "Threads"))
        .child(tab("items", "Queued"))
        .child(tab("cluster", "Cluster"))
        .child(tab("usage", "Usage")))
      .child(v_flex().id("body").flex_1().min_h(0).px(12).pb(12).overflow_y_scrollbar().on_mouse_down("left", stop).children(body))
      .child(h_flex().flex_none().h(26).px(12).items_center().border_t_1().border_color(t.border)
        .child(div().truncate().text_size(11).text_color(this.status.level === "error" ? t.blocked : t.dim).child(statusText)));
  }
}
