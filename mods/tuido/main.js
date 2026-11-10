// tuido in Herdr: your todo lists in a floating window, read from the markdown files tuido keeps.
// mod.open:tuido toggles it as the window mod.json describes; pane.split {mod: "tuido"} docks it beside a pane instead.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { closeOverlay, nextCommand, props, run, setShared, shared, theme, watchFolder } from "herdr";
import { tuido } from "./cli.js";
import { addArgs, ageLabel, destinations, dueLabel, glyph, groups, hiddenSummary, isoDay, locator, parseRoot, parseUse, rows } from "./model.js";

const viewKey = "tuido.view";
/** A press that asks again (Archive) forgets the first press after this long. */
const confirmMs = 4_000;
/** Start and scheduled dates hide a task until their day, and no file changes when that day comes. */
const dayCheckMs = 10 * 60_000;
/** Runs the person's editor as tuido open does, at a line when given. nvim, vim, nano and emacs take +N. */
const editor = 'exec ${TUIDO_EDITOR:-${VISUAL:-${EDITOR:-nvim}}} "$@"';

/** Keeps a press on a control from dragging the window, so the control gets the click. */
const stop = (_e, cx) => cx.stop_propagation();
const message = (e) => (e instanceof Error ? e.message : String(e));

export default class Tuido extends View {
  init(_props, cx) {
    const saved = shared(viewKey) ?? {};
    this.allWorkspaces = saved.allWorkspaces === true;
    this.showHidden = saved.showHidden === true;
    /** Where quick add writes: a destination's spec (workspace/list[/section]), or null for tuido's capture list. */
    this.target = typeof saved.target === "string" ? saved.target : null;
    this.picking = false;
    this.tasks = [];
    this.lists = [];
    this.workspaces = [];
    this.current = null;
    this.root = null;
    this.today = isoDay(new Date());
    this.loaded = false;
    this.loading = false;
    this.again = false;
    this.watching = null;
    /** What the last command said, or why it failed: { level: "info" | "error", text }. */
    this.status = null;
    /** What tuido printed on stderr beside its JSON: sync trouble, a newer release. */
    this.warning = null;
    /** Task locators and actions running now. */
    this.busy = new Set();
    this.confirm = null;
    this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: "Add a task   -p high  -d fri  -t tag" });
    this.input.on("submit", (_e, cx) => this.add(cx));
    // A window opened by its key is for typing a task straight away.
    if (props()?.overlay) {
      this.input.focus();
      cx.timer.after(300, () => this.input.focus());
    }
    this.refresh(cx);
    cx.timer.every(dayCheckMs, (cx) => this.refresh(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        if ((await nextCommand()) === "focus") this.input.focus();
        cx.notify();
      }
    });
  }

  close() {
    this.watching = null;
  }

  save() {
    setShared(viewKey, { allWorkspaces: this.allWorkspaces, showHidden: this.showHidden, target: this.target });
  }

  /** Reads everything again. A refresh asked for while one runs runs once more after it, not alongside. */
  refresh(cx) {
    if (this.loading) {
      this.again = true;
      return;
    }
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        do {
          this.again = false;
          await this.load();
          cx.notify();
        } while (this.again);
        if (this.root !== null && this.watching !== this.root) this.watch(cx, this.root);
      } catch (e) {
        this.status = { level: "error", text: message(e) };
        cx.notify();
      } finally {
        this.loading = false;
      }
    });
  }

  async load() {
    const [ls, current, names, lists] = await Promise.all([
      tuido(["ls", "--json", "--all"]),
      // `use` exits 1 only when no workspace is selected; anything worse already fails `ls`.
      tuido(["use"]).then((r) => parseUse(r.stdout), () => null),
      tuido(["_workspaces"]),
      tuido(["_lists", "--json"]),
    ]);
    this.tasks = JSON.parse(ls.stdout);
    try {
      this.lists = JSON.parse(lists.stdout);
    } catch {
      throw new Error("This tuido has no `_lists --json`. Update it: `tuido upgrade`.");
    }
    if (this.target !== null && !destinations(this.lists, null).some((d) => d.usable && d.spec === this.target)) {
      this.status = { level: "info", text: `${this.target} is gone, so new tasks go to the default list again.` };
      this.target = null;
      this.save();
    }
    this.warning = ls.stderr.trim() || null;
    this.current = current;
    this.workspaces = names.stdout.split("\n").filter((w) => w !== "");
    this.today = isoDay(new Date());
    if (this.root === null) {
      this.root = parseRoot((await tuido(["sync", "--status"])).stdout);
      if (this.root === null) throw new Error("`tuido sync --status` named no todo root.");
    }
    this.loaded = true;
  }

  /** Refreshes when a list changes on disk: an edit in the editor, a pull, another tuido. */
  watch(cx, root) {
    this.watching = root;
    cx.spawn(async (cx) => {
      while (this.watching === root) {
        let paths;
        try {
          paths = await watchFolder(root);
        } catch (e) {
          this.watching = null;
          this.status = { level: "info", text: `Not watching ${root} (${message(e)}). Edits made elsewhere show on ↻.` };
          cx.notify();
          return;
        }
        if (this.watching === root && paths.some((p) => p === root || (p.endsWith(".md") && !p.includes("/.git/")))) this.refresh(cx);
      }
    });
  }

  /** Runs one tuido command, shows what it said, and reads the lists again. */
  act(cx, key, args, { timeout, after } = {}) {
    if (this.busy.has(key)) return;
    this.busy.add(key);
    this.status = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const r = await tuido(args, timeout);
        this.status = { level: "info", text: r.stdout.trim() };
        after?.();
      } catch (e) {
        this.status = { level: "error", text: message(e) };
      } finally {
        this.busy.delete(key);
        cx.notify();
        this.refresh(cx);
      }
    });
  }

  // The description goes after --, so one starting with a dash is not read as a flag. tuido refuses if the line no
  // longer holds a task matching it.
  complete(cx, task) {
    this.act(cx, locator(task), ["done", "--at", locator(task), "--", task.desc]);
  }

  // The chosen destination goes first, so an -l typed into the text still wins: pflag keeps the last value.
  add(cx) {
    const args = addArgs(this.input.value());
    if (args.length === 0) return;
    const to = this.target === null ? [] : ["-l", this.target, "--all"];
    this.act(cx, "add", ["add", ...to, ...args], { after: () => this.input.set_value("") });
  }

  pick(target) {
    this.target = target;
    this.picking = false;
    this.save();
    this.input.focus();
  }

  use(cx, workspace) {
    this.allWorkspaces = false;
    this.save();
    if (workspace !== this.current) this.act(cx, `use:${workspace}`, ["use", workspace]);
  }

  // An exact ref wins over tuido's fuzzy list matching, and --all lets it reach a list in another workspace.
  sort(cx, group) {
    this.act(cx, `sort:${group.ref}`, ["sort", group.ref, "--all"]);
  }

  archive(cx, group) {
    const key = `archive:${group.ref}`;
    if (this.confirm === key) {
      this.confirm = null;
      this.act(cx, key, ["archive", group.ref, "--all"]);
      return;
    }
    this.confirm = key;
    cx.timer.after(confirmMs, (cx) => {
      if (this.confirm === key) {
        this.confirm = null;
        cx.notify();
      }
    });
  }

  open(path, line) {
    const argv = ["sh", "-c", editor, "tuido-open", ...(line ? [`+${line}`] : []), path];
    run("terminal.open", { argv, place: "right", ...(this.root ? { folder: this.root } : {}) });
  }

  render(_cx) {
    const t = theme();
    const tone = { highest: t.ansi1, high: t.ansi3, medium: t.accent, normal: t.muted, low: t.dim, lowest: t.dim, done: t.done, cancelled: t.dim, progress: t.working, blocked: t.blocked };
    const overlay = props()?.overlay ?? null;
    const shown = groups(this.tasks, { workspace: this.allWorkspaces ? null : this.current, showHidden: this.showHidden });
    const open = shown.reduce((n, g) => n + g.tasks.filter((k) => !k.hidden).length, 0);

    const control = (id, text, action, look = {}) => div().id(id).px(7).h(22).flex().items_center().rounded(5).flex_none()
      .text_size(11.5).text_color(look.on ? t.foreground : look.danger ? t.blocked : t.muted).when(Boolean(look.on), (el) => el.bg(t.selected))
      .when(!look.busy, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => { action(cx); cx.notify(); }))
      .on_mouse_down("left", stop)
      .child(look.busy ? div().frames(["◐", "◓", "◑", "◒"], 120) : text);

    const header = h_flex().h(38).flex_none().px(12).gap(6).items_center().border_b(1).border_color(t.border)
      .child(div().text_size(13.5).font_semibold().text_color(t.foreground).child("Todos"))
      .child(div().text_size(11).text_color(t.dim).child(this.loaded ? `${open} open` : ""))
      .child(div().flex_1())
      .child(control("refresh", "↻", (cx) => this.refresh(cx), { busy: this.loading }))
      .child(control("sync", "Sync", (cx) => this.act(cx, "sync", ["sync"], { timeout: 120_000 }), { busy: this.busy.has("sync") }))
      .when(overlay !== null, (el) => el.child(control("close", "✕", () => closeOverlay(overlay))));

    const scopes = h_flex().flex_none().px(10).pt(8).gap(4).items_center().flex_wrap()
      .children(this.workspaces.map((w) => control(`ws-${w}`, w, (cx) => this.use(cx, w), { on: !this.allWorkspaces && w === this.current, busy: this.busy.has(`use:${w}`) })))
      .child(control("ws-all", "All", () => { this.allWorkspaces = true; this.save(); }, { on: this.allWorkspaces }))
      .child(div().flex_1())
      .child(control("hidden", "Show hidden", () => { this.showHidden = !this.showHidden; this.save(); }, { on: this.showHidden }));

    // Where a new task goes: the chosen list or section, shown by name; clicking it opens the choices below.
    const named = (d) => `${this.allWorkspaces || d.workspace !== this.current ? `${d.workspace}/${d.list}` : d.list}${d.section ? ` › ${d.section}` : d.capture ? ` › ${d.capture}` : ""}`;
    const chosen = this.target === null ? null : destinations(this.lists, null).find((d) => d.spec === this.target) ?? null;
    const adder = h_flex().mx(10).mt(8).h(32).flex_none().gap(6)
      .child(h_flex().id("target").h_full().max_w(190).flex_none().px(9).gap(5).items_center().rounded(7).border_1()
        .border_color(this.picking ? t.accent : t.input).bg(t.surface).cursor_pointer().hover((s) => s.bg(t.hover))
        .on_mouse_down("left", stop).on_click((_e, cx) => { this.picking = !this.picking; cx.notify(); })
        .child(div().text_size(11).text_color(t.dim).child("to"))
        .child(div().min_w(0).truncate().text_size(12).text_color(t.foreground).child(chosen === null ? "default list" : named(chosen)))
        .child(div().text_size(10).text_color(t.dim).child(this.picking ? "▴" : "▾")))
      .child(div().id("add").h_full().flex_1().min_w(0).px(10).flex().items_center().rounded(7).border_1()
        .border_color(this.busy.has("add") ? t.accent : t.input).bg(t.surface).cursor_text().on_mouse_down("left", stop)
        .child(Input.new(this.input).h_full().w_full().text_size(12.5).text_color(t.foreground)));

    const choice = (id, label, target, look) => h_flex().id(id).min_h(24).pl(10 + look.depth * 14).pr(10).gap(6).items_center().rounded(5)
      .on_mouse_down("left", stop)
      .when(target === this.target, (el) => el.bg(t.selected))
      .when(look.usable, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => { this.pick(target); cx.notify(); }))
      .child(div().min_w(0).truncate().text_size(12).when(look.depth === 0, (el) => el.font_semibold())
        .text_color(look.usable ? t.foreground : t.dim).child(label))
      .when(Boolean(look.note), (el) => el.child(div().flex_none().text_size(10.5).text_color(t.dim).child(look.note)));
    const picker = v_flex().id("targets").mx(10).mt(4).p(4).max_h(260).flex_none().overflow_y_scrollbar().rounded(7).border_1()
      .border_color(t.border).bg(t.surface)
      .child(choice("to-default", "default list", null, { depth: 0, usable: true, note: "tuido's capture list" }))
      .children(destinations(this.lists, this.allWorkspaces ? null : this.current).map((d) => d.section === null
        ? choice(`to-${d.key}`, this.allWorkspaces ? d.key : d.list, d.spec, { depth: 0, usable: d.usable, note: d.usable ? (d.capture ? `→ ${d.capture}` : "") : "pick a section" })
        : choice(`to-${d.key}`, d.section, d.spec, { depth: 1, usable: true })));

    const notes = v_flex().flex_none().px(12).pt(6).gap(2)
      .when(this.warning !== null, (el) => el.child(div().text_size(11.5).text_color(t.ansi3).child(this.warning)))
      .when(this.status !== null && this.status.text !== "", (el) => el.child(div().id("status").text_size(11.5).cursor_pointer()
        .text_color(this.status.level === "error" ? t.blocked : t.muted).on_mouse_down("left", stop)
        .on_click((_e, cx) => { this.status = null; cx.notify(); }).child(this.status.text)));

    const taskRow = (task, depth) => {
      const loc = locator(task);
      const g = glyph(task);
      const due = dueLabel(task.due, this.today);
      const age = ageLabel(task.created, this.today);
      const closed = task.state === "done" || task.state === "cancelled";
      const busy = this.busy.has(loc);
      const check = div().id(`done-${loc}`).size(15).flex_none().rounded(8).border_1().flex().items_center().justify_center()
        .text_size(10).on_mouse_down("left", stop)
        .when(closed, (el) => el.border_color(t.border).text_color(g.tone === "done" ? t.done : t.dim).child(g.text))
        .when(!closed && busy, (el) => el.border_color(t.accent).text_color(t.accent).child(div().frames(["◐", "◓", "◑", "◒"], 120)))
        .when(!closed && !busy, (el) => el.border_color(t.input).cursor_pointer().hover((s) => s.border_color(t.accent).bg(t.hover))
          .on_click((_e, cx) => { this.complete(cx, task); cx.notify(); }));
      return h_flex().id(`task-${loc}`).min_h(26).pl(12 + depth * 12).pr(12).gap(8).items_center().rounded(5)
        .hover((s) => s.bg(t.hover)).cursor_pointer().on_mouse_down("left", stop).on_click(() => this.open(task.path, task.line))
        .child(check)
        .child(div().w(10).flex_none().text_size(11).text_color(tone[g.tone] ?? t.muted).child(closed ? "" : g.text))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(task.hidden ? t.dim : t.foreground).child(task.desc))
        .when(Boolean(task.hidden) && !closed, (el) => el.child(div().flex_none().text_size(10.5).text_color(t.dim).child(task.hidden)))
        .when(due !== null, (el) => el.child(div().flex_none().text_size(11).text_color(due.overdue ? t.ansi1 : due.soon ? t.ansi3 : t.dim).child(due.text)))
        .when(age !== null, (el) => el.child(div().w(28).flex_none().text_size(11).text_color(t.dim).child(age)));
    };

    const groupBlock = (group) => {
      const hidden = hiddenSummary(group.hidden);
      const archiving = this.confirm === `archive:${group.ref}`;
      return v_flex().id(`list-${group.ref}`).pt(10).gap(1)
        .child(h_flex().h(24).px(12).gap(4).items_center()
          .child(div().id(`open-${group.ref}`).flex_1().min_w(0).truncate().cursor_pointer().on_mouse_down("left", stop).on_click(() => this.open(group.path))
            .text_size(11.5).font_semibold().text_color(t.muted).hover((s) => s.text_color(t.foreground))
            .child(this.allWorkspaces ? group.ref : group.list))
          .child(control(`sort-${group.ref}`, "Sort", (cx) => this.sort(cx, group), { busy: this.busy.has(`sort:${group.ref}`) }))
          .child(control(`archive-${group.ref}`, archiving ? "Archive closed?" : "Archive", (cx) => this.archive(cx, group),
            { danger: archiving, busy: this.busy.has(`archive:${group.ref}`) })))
        .children(rows(group).map((row) => row.kind === "heading"
          ? div().pl(12 + row.depth * 12).pt(4).text_size(11).text_color(t.dim).child(row.text)
          : taskRow(row.task, row.depth)))
        .when(group.tasks.length === 0, (el) => el.child(div().px(12).text_size(11.5).text_color(t.dim).child(`nothing to do · ${hidden}`)))
        .when(group.tasks.length > 0 && hidden !== "", (el) => el.child(div().px(12).pt(2).text_size(11).text_color(t.dim).child(`${hidden} hidden`)));
    };

    const empty = (text) => div().px(12).py(16).text_size(12).text_color(t.muted).child(text);
    const body = v_flex().id("lists").flex_1().min_h(0).overflow_y_scrollbar().pb(12)
      .when(!this.loaded && this.status?.level !== "error", (el) => el.child(empty("Reading your lists…")))
      .when(this.loaded && shown.length === 0, (el) => el.child(empty(this.allWorkspaces || this.current === null ? "No tasks yet. Add one above." : `No tasks in ${this.current}. Add one above.`)))
      .children(shown.map(groupBlock));

    return v_flex().id("tuido").track_focus(this.handle).size_full().min_h(0).bg(t.background).text_color(t.foreground)
      .on_key_down((e, cx) => {
        if (e.key !== "escape") return;
        if (this.picking) {
          this.picking = false;
          cx.stop_propagation();
          cx.notify();
        } else if (overlay !== null) {
          cx.stop_propagation();
          closeOverlay(overlay);
        }
      })
      .child(header).child(scopes).child(adder).when(this.picking, (el) => el.child(picker)).child(notes).child(body);
  }
}
