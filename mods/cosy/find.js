// The lists you pick from, on the menu's stock: every agent (Ctrl-f a), this
// space's tabs (Ctrl-f b) and the looks (Ctrl-f r). They are the café's own
// cards for what the navigation and appearance mods show in Herdr's frame:
// the same lists, order and keys, since the rows come from those mods' own
// model.js (install.sh puts a copy of each beside this file; a mod can't
// import another mod's code).
//
// Agents open to browse: n / d go straight to the next agent that needs you
// / is ready, w shows the ones brewing, a all, / searches, j / k or the
// arrows move, Enter goes, Esc leaves. Tabs open in search; looks are a
// short list.

import { div } from "gpui-kit";
import { h_flex, v_flex, Input, InputState, ScrollHandle } from "gpui-base";
import { agents, appHome, closeOverlay, focused, layouts, nextCommand, notify, openOverlay, panes, props,
  readTextFile, run, settings, shared, spaces, terminals, themes } from "herdr";
import { look, alpha, onCard, heading, field, MOOD, SERIF } from "./look.js";

// A card is as tall as its list, up to 560: what stands around the rows
// (the agents' includes room for the search field), and a row.
const WIDTH = { agents: 600, tabs: 600, looks: 440 };
const AROUND = { agents: 190, tabs: 160, looks: 124 };
const ROW = 48;
const count = (kind) => (kind === "agents" ? agents().length
  : kind === "tabs" ? spaces().find((s) => s.id === focused()?.space)?.tabs.length ?? 1 : 3);
const TITLE = { agents: "Agents", tabs: "Tabs", looks: "Looks" };
// Which mod's model a list is read with.
const MODEL = { agents: "navigation", tabs: "navigation", looks: "appearance" };
const model = (kind) => (MODEL[kind] === "navigation" ? import("./navigation/model.js") : import("./appearance/model.js"));

/** Opens the list of `kind`: "agents", "tabs" or "looks". */
export const openFind = (kind) => openOverlay({ mod: "cosy", kind: "dialog", frame: "none",
  width: WIDTH[kind], height: Math.min(560, AROUND[kind] + Math.max(3, count(kind)) * ROW), props: { role: "find", kind, space: focused()?.space } });

/**
 * The layout's Ctrl-f keys (cosy.agents, cosy.tabs, cosy.looks, cosy.back),
 * hosted by the beam: it is always shown, and it is this mod's one
 * nextCommand() listener, since a key command goes to a single waiting one.
 * Back needs to have seen where you were, so the beam calls observe() as it
 * draws.
 *
 * The listener is its own task, waiting from the beam's init on. Behind the
 * model's import it went deaf: a module outlives a visit to the layout, and
 * on the next visit the import already made resumed outside the beam's copy,
 * so the nextCommand() after it was no copy's and the keys reached no one.
 */
export class Ways {
  constructor(cx) {
    cx.spawn(async (cx) => {
      try {
        this.nav = await model("agents");
        this.history = new this.nav.FocusHistory();
      } catch (e) {
        this.missing = `Ctrl-f Tab needs the navigation mod's model.js beside the cosy mod: run mods/cosy/install.sh (${e})`;
      }
    });
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        this.observe();
        if (command === "back") this.back();
        else if (command in WIDTH) {
          if (this.overlay) closeOverlay(this.overlay);
          this.overlay = openFind(command);
        }
        cx.notify();
      }
    });
  }

  target() { return this.nav.focusTarget(focused(), panes(), agents(), terminals()); }
  observe() { this.history?.observe(this.target()); }

  back() {
    if (!this.history) return notify({ title: "Can't go back", body: this.missing ?? "The navigation model is still loading.", level: "error" });
    const to = this.history.previous(this.target(), (t) => this.nav.targetAlive(t, panes(), terminals()));
    if (this.overlay) closeOverlay(this.overlay);
    if (to) run(to.action.command, to.action.args);
    else notify({ title: "No previous location yet", level: "info" });
  }
}

export default class Find {
  init(pr, cx) {
    this.kind = pr.kind;
    this.handle = cx.focus_handle();
    const origin = focused();
    this.space = pr.space ?? origin?.space;
    this.originAgent = origin?.shown || origin?.terminal;
    this.mode = this.kind === "tabs" ? "search" : "browse";
    this.statusFilter = null;
    this.emptyStatus = null;
    this.query = "";
    this.selected = null;
    this.scroll = ScrollHandle.new();
    this.input = InputState.new({ placeholder: this.kind === "agents"
      ? "An agent by task, space, program or address…" : "A tab in this space…" });
    this.input.on("change", (_e, cx) => {
      this.query = this.input.value();
      this.selected = this.rows()[0]?.id ?? null;
      this.scroll.scroll_to_item(0);
      cx.notify();
    });
    this.input.on("submit", (_e, cx) => this.choose(undefined, cx));
    if (this.mode === "browse") this.handle.focus();
    else this.input.focus();
    cx.spawn(async (cx) => {
      try {
        this.model = await model(this.kind);
      } catch (e) {
        this.failed = `This list is read with the ${MODEL[this.kind]} mod's model.js, and it isn't beside the cosy mod: run mods/cosy/install.sh. (${e})`;
      }
      // The field is drawn only now, and the keyboard doesn't stay on what isn't drawn.
      if (this.mode === "search") this.input.focus();
      cx.notify();
    });
  }

  baseRows() {
    const m = this.model;
    if (!m) return [];
    if (this.kind === "agents") return m.agentRows(agents(), terminals(), this.space);
    if (this.kind === "tabs") return m.tabRows(spaces(), panes(), this.space);
    return m.layoutChoices(layouts()).map((c) => ({ id: `look:${c.name}`, label: c.label, detail: c.detail,
      current: shared("layout") === c.name, look: c }));
  }

  rows(base = this.baseRows()) {
    return this.model.filterRows?.(this.statusFilter ? base.filter((r) => r.status === this.statusFilter) : base, this.query) ?? base;
  }

  currentAgentId() {
    const f = focused();
    const address = f?.shown || f?.terminal || this.originAgent;
    return address ? `agent:${address}` : null;
  }

  jumpStatus(status, cx) {
    const to = this.model.nextStatusRow(this.baseRows(), status, this.currentAgentId());
    if (to) this.choose(to, cx);
    else { this.emptyStatus = status; cx.notify(); }
  }

  setFilter(status, cx) {
    this.statusFilter = status;
    this.emptyStatus = null;
    this.selected = this.rows()[0]?.id ?? null;
    this.scroll.scroll_to_item(0);
    cx.notify();
  }

  search(cx) {
    this.mode = "search";
    this.emptyStatus = null;
    this.input.focus();
    cx.notify();
  }

  key(e, cx) {
    if (!this.model) { if (e.key === "escape") closeOverlay(props().overlay); return; }
    const control = e.modifiers.control;
    const plain = !control && !e.modifiers.alt && !e.modifiers.platform && !e.modifiers.shift;
    // Herdr closes a dialog on Esc before a mod can do anything else with it.
    if (e.key === "escape") closeOverlay(props().overlay);
    else if (e.key === "down" || (control && e.key === "j")) this.move(1, cx);
    else if (e.key === "up" || (control && e.key === "k")) this.move(-1, cx);
    else if (this.mode === "browse" && plain) {
      const agentsList = this.kind === "agents";
      if (e.key === "j") this.move(1, cx);
      else if (e.key === "k") this.move(-1, cx);
      else if (e.key === "enter") this.choose(undefined, cx);
      else if (agentsList && e.key === "n") this.jumpStatus("blocked", cx);
      else if (agentsList && e.key === "d") this.jumpStatus("done", cx);
      else if (agentsList && e.key === "w") this.setFilter("working", cx);
      else if (agentsList && e.key === "a") this.setFilter(null, cx);
      else if (agentsList && e.key === "/") this.search(cx);
      else return;
    } else return;
    cx.stop_propagation();
  }

  choose(row = this.rows().find((r) => r.id === this.selected), cx) {
    if (!row || this.busy) return;
    if (row.look) return this.wear(row.look, cx);
    closeOverlay(props().overlay);
    run(row.action.command, row.action.args);
  }

  // A look is a layout and the palette that goes with it (the appearance
  // mod's rule). The switch takes this card with it.
  wear(choice, cx) {
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        const defaults = JSON.parse(await readTextFile(`${appHome()}/settings.json`));
        const palette = this.model.paletteFor(choice, themes(), defaults.theme, settings().dark);
        closeOverlay(props().overlay);
        run("layout.switch", { name: choice.name });
        if (palette) run("app.theme", { name: palette });
      } catch (e) {
        this.busy = false;
        notify({ title: "Could not switch look", body: String(e), level: "error" });
        cx.notify();
      }
    });
  }

  move(by, cx) {
    const rows = this.rows();
    if (!rows.length) return;
    const at = Math.max(0, rows.findIndex((r) => r.id === this.selected));
    const next = (at + by + rows.length) % rows.length;
    this.selected = rows[next].id;
    this.scroll.scroll_to_item(next);
    cx.notify();
  }

  chip(L, id, label, on, act) {
    return div().id(id).h(22).px(8).flex().items_center().rounded(4).cursor_pointer().text_size(10.5)
      .border(1).border_color(on ? L.card.solid : alpha(L.card.wash, 0.25)).bg(on ? L.card.solid : alpha(L.card.wash, 0))
      .text_color(on ? L.card.solidText : L.card.key)
      .hover((s) => (on ? s : s.bg(alpha(L.card.wash, 0.08)))).on_click((_e, cx) => act(cx)).child(label);
  }

  line(L, row) {
    const on = row.id === this.selected;
    const mark = row.number != null ? String(row.number) : row.current ? "›" : "";
    return h_flex().id(row.id).h(ROW).flex_none().px(8).gap(9).items_center().rounded(4).cursor_pointer()
      .bg(alpha(L.card.wash, on ? 0.1 : 0)).hover((s) => s.bg(alpha(L.card.wash, on ? 0.1 : 0.05)))
      .on_click((_e, cx) => this.choose(row, cx))
      .child(div().w(16).flex_none().font_family(SERIF).text_size(18).line_height("22px").text_color(L.card.dim).child(mark))
      .child(v_flex().flex_1().min_w(0).gap(1)
        .child(h_flex().gap(7).items_center()
          .child(div().flex_none().max_w(row.status ? 400 : 480).truncate().font_family(SERIF).text_size(19).line_height("22px").text_color(L.card.text).child(row.label))
          // The menu's dotted leader, to what the agent is doing.
          .child(div().flex_1().min_w(8).h(9).border_b(1).border_dashed().border_color(alpha(L.card.wash, 0.22)))
          .when(Boolean(row.status), (el) => el.child(div().flex_none().text_size(10.5).text_color(L.card.status[row.status] ?? L.card.dim).child(MOOD[row.status] ?? row.status))))
        .child(div().truncate().text_size(10.5).text_color(L.card.dim).child(row.detail)));
  }

  render() {
    const L = look();
    const card = onCard(L, v_flex().id("find").track_focus(this.handle).size_full().p(18).gap(9))
      .on_key_down((e, cx) => this.key(e, cx))
      .child(heading(L, TITLE[this.kind]));
    if (!this.model) return card.child(div().flex_1().text_size(12).text_color(L.card.text).child(this.failed ?? ""));

    const base = this.baseRows(), rows = this.rows(base);
    if (!rows.some((r) => r.id === this.selected)) this.selected = ((!this.query && rows.find((r) => r.current)) || rows[0])?.id ?? null;
    const isAgents = this.kind === "agents";
    const counts = isAgents ? this.model.agentCounts(base) : null;
    if (this.emptyStatus && this.model.nextStatusRow(base, this.emptyStatus, this.currentAgentId())) this.emptyStatus = null;
    const notice = this.emptyStatus === "blocked" ? (counts.blocked ? "No other agent needs you." : "No agent needs you.")
      : this.emptyStatus === "done" ? (counts.done ? "No other agent is ready." : "No agent is ready.") : null;
    const where = isAgents ? "every space" : spaces().find((s) => s.id === this.space)?.name ?? "this space";
    const hint = this.kind === "looks" ? (this.busy ? "Switching…" : "j / k or the arrows · Enter wears it · Esc leaves")
      : this.mode === "browse" ? "j / k or the arrows · Enter goes there · Esc leaves"
        : "Type to filter · Ctrl-j / k or the arrows · Enter goes there · Esc leaves";
    return card
      .when(isAgents, (el) => el.child(h_flex().flex_none().gap(5).items_center()
        .child(this.chip(L, "chip-n", `n  needs you ${counts.blocked}`, false, (cx) => this.jumpStatus("blocked", cx)))
        .child(this.chip(L, "chip-d", `d  ready ${counts.done}`, false, (cx) => this.jumpStatus("done", cx)))
        .child(this.chip(L, "chip-w", `w  brewing ${counts.working}`, this.statusFilter === "working", (cx) => this.setFilter("working", cx)))
        .child(this.chip(L, "chip-a", `a  all ${counts.all}`, this.statusFilter === null, (cx) => this.setFilter(null, cx)))
        .child(this.chip(L, "chip-s", "/  search", this.mode === "search", (cx) => this.search(cx)))
        .child(div().flex_1().text_right().text_size(10.5).text_color(L.card.dim).child(where))))
      .when(this.mode === "search", (el) => el.child(field(L, Input.new(this.input))))
      .when(Boolean(notice), (el) => el.child(div().flex_none().text_size(11.5).text_color(L.card.status.blocked).child(notice)))
      .child(v_flex().id("find-rows").flex_1().min_h(0).overflow_y_scrollbar().track_scroll(this.scroll)
        .children(rows.map((row) => this.line(L, row)))
        .when(!rows.length, (el) => el.child(div().p(8).font_family(SERIF).italic().text_size(18).text_color(L.card.dim).child("Nothing by that name."))))
      .child(h_flex().flex_none().text_size(10.5).text_color(L.card.dim)
        .child(div().flex_1().child(hint))
        .when(this.kind === "tabs", (el) => el.child(where)));
  }
}
