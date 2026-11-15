// The panel's pages other than a thread: the thread lists, the start form, pipeline items, the cluster and usage.
import { Background, PathBuilder, div } from "gpui-kit";
import { v_flex, h_flex, Textarea } from "gpui-base";
import { ago, attentionLabel, byProject, clusterNode, gib, inFlight, itemGroups, lastActivity, needsYou, placementRows, tokens, unstarted } from "./model.js";
import { graphRanges, plotOf } from "./graphs.js";

function threadRow(app, ui, r, now, attached) {
  const { t, dot, tone } = ui;
  return h_flex().id(`row-${r.id}`).gap(10).px(8).py(7).rounded(6).items_center().cursor_pointer()
    .when(app.view.thread === r.id, (el) => el.bg(t.selected))
    .hover((s) => s.bg(t.hover))
    .on_click((_e, cx) => app.show(cx, { thread: r.id }))
    .child(dot(tone(r.attention)))
    .child(v_flex().flex_1().overflow_hidden()
      .child(div().truncate().text_size(13).text_color(t.foreground).child(r.title))
      .child(div().truncate().text_size(11.5).text_color(t.muted)
        .child([r.project, attentionLabel[r.attention] ?? r.pylon?.actualState ?? "", ago(lastActivity(r), now)].filter(Boolean).join(" · "))))
    .when(attached, (el) => el.child(div().flex_none().text_size(11.5).font_semibold().text_color(t.done).child("Attached")));
}

export function threadList(app, ui, now) {
  const { heading, empty } = ui;
  const attached = new Set(app.attached().map((a) => a.id));
  const row = (r) => threadRow(app, ui, r, now, attached.has(r.id));
  if (app.view.tab === "needs") {
    const needs = needsYou(app.rows);
    return needs.length === 0 ? [empty("Nothing waits on you.")] : needs.map(row);
  }
  if (app.view.tab === "flight") {
    const flight = inFlight(app.rows);
    return flight.length === 0 ? [empty("No open thread is in flight.")] : flight.flatMap((g) => [heading(`${g.title} ${g.threads.length}`), ...g.threads.map(row)]);
  }
  return byProject(app.rows, app.projects).flatMap((g) => [heading(`${g.project} ${g.threads.length || ""}`), ...(g.threads.length === 0 ? [empty("No open threads.")] : g.threads.map(row))]);
}

export function startForm(app, ui) {
  const { t, chip, heading, button } = ui;
  return [
    heading("Project"),
    h_flex().flex_wrap().gap(6).children(app.projects.map((p) => chip(`proj-${p.id}`, p.id, app.project === p.id, () => { app.project = p.id; }))),
    heading("Worker"),
    h_flex().gap(6)
      .child(chip("w-claude", "Claude Code", app.worker === "claude", () => { app.worker = "claude"; }))
      .child(chip("w-harness", "Nexus agent", app.worker === "harness", () => { app.worker = "harness"; })),
    heading(app.worker === "claude" ? "Prompt" : "First message"),
    Textarea.new(app.prompt).w_full().h(140).p(8).rounded(6).border_1().border_color(t.input).bg(t.surface).text_size(12.5).text_color(t.foreground),
    h_flex().pt(10).justify_end().child(button("start-go", app.sending ? "Starting…" : "Start thread", (cx) => app.startThread(cx), { primary: true })),
  ];
}

/** A page whose data loads when shown: what it is waiting for, or why it failed. */
function pending(ui, page) {
  if (page === undefined || (page.data === null && page.error === null)) return [ui.empty("Loading…")];
  if (page.data === null) return [ui.line(page.error, ui.t.blocked)];
  return null;
}

export function itemsPage(app, ui, now) {
  const { t, button, heading, empty, line } = ui;
  const page = app.pages.items;
  const wait = pending(ui, page);
  if (wait !== null) return wait;
  const groups = itemGroups(page.data);
  if (groups.length === 0) return [empty("The pipeline holds no items.")];
  return groups.flatMap((g) => [heading(`${g.title} ${g.items.length}`), ...g.items.map((item) => {
    const done = g.key === "done";
    const actions = unstarted(item) ? [
      ...item.approved === null ? [button(`approve-${item.id}`, "Approve", (cx) => app.act(cx, "Approving", () => app.post(`/v1/items/${item.id}/approve`, {}), "items"))] : [],
      app.confirm === `cancel:${item.id}`
        ? button(`cancel-${item.id}`, "Cancel: press again", (cx) => app.act(cx, "Cancelling", () => app.post(`/v1/items/${item.id}/cancel`, {}), "items"), { danger: true })
        : button(`cancel-${item.id}`, "Cancel", (cx) => app.ask(cx, `cancel:${item.id}`)),
    ] : [];
    return v_flex().id(`item-${item.id}`).px(8).py(6).rounded(6)
      .when(item.thread !== null, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => app.show(cx, { thread: item.thread })))
      .child(div().truncate().text_size(12.5).text_color(done ? t.muted : t.foreground).child(item.title))
      .child(div().text_size(11.5).text_color(g.key === "held" ? t.blocked : t.dim).child(`${item.project} · ${item.phase.why} · added ${ago(item.addedAt, now)}`))
      .children(actions.length === 0 ? [] : [h_flex().pt(4).gap(6).children(actions)]);
  }), ...g.key === "done" ? [line("The 20 most recently added of the finished items.", t.dim)] : []]);
}

const bar = (ui, meter, h = 6) => div().mt(3).h(h).w_full().rounded(h / 2).bg(ui.t.border)
  .children(meter.percent === null ? [] : [div().h_full().rounded(h / 2).bg(ui.t[meter.tone])
    .w(/** @type {`${number}%`} */ (`${meter.percent.toFixed(1)}%`))]);

/** The release in one line, every role's state when opened, and a role that is not healthy always. */
function releaseRows(app, ui, release) {
  const { t, line } = ui;
  const roles = release.nodes ?? [];
  const healthy = roles.filter((n) => n.state === "healthy").length;
  const shown = app.releaseOpen ? roles : roles.filter((n) => n.state !== "healthy");
  const head = `${release.desired?.commit?.slice(0, 12) ?? "No release desired"}${release.desired?.requestedBy ? ` by ${release.desired.requestedBy}` : ""}`;
  return [
    h_flex().id("release").pt(4).gap(8).items_center().cursor_pointer().on_click((_e, cx) => { app.releaseOpen = !app.releaseOpen; cx.notify(); })
      .child(div().text_size(12.5).text_color(t.foreground).child(head))
      .child(div().flex_1().text_size(12).text_color(healthy === roles.length ? t.muted : t.blocked).child(`${healthy} of ${roles.length} healthy`))
      .child(div().text_size(11.5).text_color(t.accent).child(app.releaseOpen ? "Less" : "Roles")),
    ...shown.map((n) => line(`${n.role} on ${n.node}: ${n.state} at ${n.commit?.slice(0, 12) ?? "nothing"}${n.reason ? ` (${n.reason})` : ""}`, n.state === "healthy" ? t.muted : t.blocked)),
  ];
}

/** A small meter: its label and value on one line, its bar under them. */
const smallMeter = (ui, id, m) => v_flex().id(id).flex_1().min_w(110)
  .child(h_flex().gap(4).text_size(11.5)
    .child(div().flex_none().text_color(ui.t.dim).child(m.label))
    .child(div().flex_1().truncate().text_color(m.tone === "muted" ? ui.t.foreground : ui.t[m.tone]).child(m.value)))
  .child(bar(ui, m, 4));

export function clusterPage(app, ui, now) {
  const { t, heading, line, card } = ui;
  const page = app.pages.cluster;
  const wait = pending(ui, page);
  if (wait !== null) return wait;
  const { nodes, release, health } = page.data;
  const report = page.admission?.data ?? null;
  const out = [];
  if (release !== null) out.push(heading("Release"), ...releaseRows(app, ui, release));
  out.push(...placementSection(app, ui, nodes, now));
  out.push(heading("Nodes"));
  for (const n of nodes) {
    const node = clusterNode(n, health[n.name], now, report?.nodes.find((a) => a.node === n.name), report?.resources);
    const open = app.openNodes.has(n.name);
    const s = node.summary;
    // The border is the node's own state; whether a project's pylon fits is the Placement section's.
    out.push(card(`node-${n.name}`, n.state === "online" && !n.overcommitted ? t.border : t.blocked)
      .child(h_flex().id(`node-head-${n.name}`).gap(8).items_center().cursor_pointer().on_click((_e, cx) => app.toggleNode(cx, n.name))
        .child(div().size(8).rounded(4).flex_none().bg(n.state === "online" ? t.done : t.blocked))
        .child(div().flex_1().truncate().text_size(13).font_semibold().text_color(t.foreground).child(n.name))
        .child(div().text_size(11.5).text_color(t.dim).child(node.status))
        .child(div().w(14).flex_none().text_size(11.5).text_color(t.muted).child(open ? "▾" : "▸")))
      .child(h_flex().pt(8).gap(12).flex_wrap().children(s.meters.map((m, i) => smallMeter(ui, `meter-${n.name}-${i}`, m))))
      .child(div().pt(6).truncate().text_size(12).text_color(t[s.pylons.tone]).child(`Pylons: ${s.pylons.text}`))
      .children(node.healthError === null ? [] : [line(node.healthError, t.blocked)])
      .children(open ? nodeDetails(app, ui, n.name, node) : []));
  }
  return out;
}

/**
 * Which nodes the picked project's default-sized pylon fits on now, as the scheduler decides it. A failed or missing
 * report says placement is unknown, never an estimate from the meters.
 */
function placementSection(app, ui, nodes, now) {
  const { t, heading, line, chip, button } = ui;
  const page = app.pages.cluster;
  const report = page.admission?.data ?? null;
  const size = report?.resources ? `${gib(report.resources.memoryGiB)} memory, ${report.resources.cpus} CPUs, ${gib(report.resources.diskGiB)} disk` : null;
  // Without the scheduler's report placement is unknown, and the meters never stand in for it.
  const status = page.admission?.error ? `Placement unknown. ${page.admission.error}` : report === null ? "Reading placement…" : null;
  return [
    heading("Placement"),
    h_flex().flex_wrap().gap(6).items_center()
      .child(div().text_size(12).text_color(t.muted).child("New pylon for"))
      .children(app.projects.map((p) => chip(`placement-${p.id}`, p.id, app.admissionProject === p.id,
        (cx) => cx.spawn(async (cx) => app.loadAdmission(cx, p.id)))))
      .child(div().flex_1())
      .child(button("placement-refresh", "Refresh", (cx) => cx.spawn(async (cx) => app.loadAdmission(cx)), { disabled: app.admissionProject === null })),
    ...status !== null ? [line(status, page.admission?.error ? t.blocked : t.dim)] : [
      line(`${size === null ? "Its default size" : size}, placed automatically · checked ${ago(report.at, now)}, nothing reserved${report.defaultNode === "auto" ? "" : ` · the project itself is pinned to ${report.defaultNode}`}`, t.dim),
      v_flex().pt(4).children(placementRows(report, nodes.map((n) => n.name)).map((r) => h_flex().id(`fit-${r.node}`).gap(8).py(2).items_center()
        .child(div().size(8).rounded(4).flex_none().bg(t[r.tone]))
        .child(div().w(140).flex_none().truncate().text_size(12.5).text_color(t.foreground).child(r.node))
        .child(div().flex_1().truncate().text_size(12).text_color(t[r.tone]).child(r.text)))),
    ],
  ];
}

/** What a node card opens to: the scheduler's report, the full meters and reservations, and the node's graphs. */
function nodeDetails(app, ui, name, node) {
  const { t, line } = ui;
  const sub = (text) => div().pt(10).text_size(11).font_semibold().text_color(t.dim).child(text.toUpperCase());
  return [
    sub(app.admissionProject === null ? "Placement" : `Placement of a ${app.admissionProject} pylon`),
    ...node.admission.map((a) => line(a.text, t[a.tone])),
    sub("Host"),
    ...node.meters.map((meter, i) => v_flex().id(`meter-full-${name}-${i}`).child(line(meter.text)).child(bar(ui, meter))),
    line(node.committed, t[node.committedTone]),
    line(node.pylons, t[node.pylonsTone]),
    ...node.detail ? [line(node.detail, t.dim)] : [],
    ...graphsView(app, ui, name),
  ];
}

const percent = (v) => /** @type {`${number}%`} */ (`${v}%`);

/** The theme's colours for the charts' lines: a line keeps its slot's colour, and from the ninth on it is dashed as well. */
const palette = (t) => [t.ansi4, t.ansi3, t.ansi2, t.ansi5, t.ansi6, t.ansi1, t.ansi12, t.ansi11];
const slotsDashed = 8;
const points = (list) => list.map(([x, y]) => /** @type {[`${number}%`, `${number}%`]} */ ([percent(x), percent(y)]));

/**
 * A chart's geometry, built as the metrics API answers rather than on each render: each line's stroke, one
 * polyline per run, and its bands. Paths are immutable native geometry, so each render paints the same ones in the
 * theme's colours.
 */
export function geometry(chart, h, slots) {
  const plot = plotOf(chart, h, slots);
  return {
    chart, plot,
    paths: plot.lines.map((l) => {
      const dash = "ref" in l.look ? [5, 4] : l.look.slot >= slotsDashed ? [8, 3] : null;
      let stroke = dash === null ? PathBuilder.stroke(1.5) : PathBuilder.stroke(1.5).dash_array(dash);
      // A lone reading has no neighbour to draw to, so it gets a short tick of its own.
      for (const run of l.runs) stroke = stroke.add_polygon(points(run.length === 1 ? [[Math.max(0, run[0][0] - 0.6), run[0][1]], [Math.min(100, run[0][0] + 0.6), run[0][1]]] : run), false);
      return {
        stroke: l.runs.length === 0 ? null : stroke.build(),
        bands: l.bands.filter((b) => b.length > 2).map((b) => PathBuilder.fill().add_polygon(points(b), true).build()),
      };
    }),
    guide: plot.guide === null ? null : PathBuilder.stroke(1).dash_array([2, 3]).move_to("0%", percent(plot.guide)).line_to("100%", percent(plot.guide)).build(),
  };
}

function graphsView(app, ui, name) {
  const { t, chip, line } = ui;
  const m = app.metrics.get(name);
  const ranges = h_flex().pt(10).gap(4).flex_wrap().items_center()
    .child(div().flex_1().text_size(11).font_semibold().text_color(t.dim).child("GRAPHS"))
    .children(graphRanges.map(([key]) => chip(`range-${name}-${key}`, key, app.graphRange === key, (cx) => app.setGraphRange(cx, key))));
  if (m === undefined || (m.drawn === null && m.error === null)) return [ranges, line("Loading the graphs…", t.dim)];
  if (m.drawn === null) return [ranges, line(m.error, t.blocked)];
  return [ranges, h_flex().pt(6).gap(8).flex_wrap().children(m.drawn.map((g) => chartView(app, ui, name, g, m.range)))];
}

function chartView(app, ui, node, { chart, plot, paths, guide }, span) {
  const { t } = ui;
  const colours = palette(t);
  const colourOf = (look) => "ref" in look ? t.dim : colours[look.slot % colours.length];
  const key = (l) => `${node}:${chart.id}:${l.id}`;
  const layer = (path, fill) => window.paint_path(path, fill).absolute().top(0).left(0).size_full();
  const layers = [];
  plot.lines.forEach((l, i) => {
    if (app.hiddenLines.has(key(l))) return;
    for (const band of paths[i].bands) layers.push(layer(band, Background.solid(colourOf(l.look)).opacity("ref" in l.look ? 0.08 : 0.18)));
    if (paths[i].stroke !== null) layers.push(layer(paths[i].stroke, colourOf(l.look)));
  });
  if (guide !== null) layers.push(layer(guide, t.dim));
  const [lo, hi] = plot.y;
  const grid = [0, 50, 100].map((y) => div().absolute().left(0).top(percent(y)).w_full().h(1).bg(t.border));
  const legend = plot.lines.map((l) => {
    const hidden = app.hiddenLines.has(key(l));
    // A long label, such as a pylon's thread title, is cut short; its reading never is.
    return h_flex().id(`legend-${key(l)}`).max_w_full().min_w_0().gap(5).items_center().cursor_pointer().when(hidden, (el) => el.opacity(0.4))
      .on_click((_e, cx) => { if (!app.hiddenLines.delete(key(l))) app.hiddenLines.add(key(l)); cx.notify(); })
      .child(div().w(10).h(2).flex_none().bg(colourOf(l.look)))
      .child(div().min_w_0().truncate().text_size(11).text_color(t.muted).child(l.label))
      .child(div().flex_none().text_size(11).text_color(t.foreground).child(l.latest ?? "–"));
  });
  return v_flex().id(`chart-${node}-${chart.id}`).flex_1().min_w(240).p(8).rounded(6).border_1().border_color(t.border).bg(t.surface)
    .child(h_flex().gap(6).items_center()
      .child(div().text_size(12).font_semibold().text_color(t.foreground).child(chart.title))
      .child(div().flex_1().truncate().text_size(11).text_color(t.dim).child(chart.unit)))
    .child(h_flex().pt(6).h(96).gap(4)
      .child(v_flex().w(32).flex_none().h_full().justify_between().text_size(10).text_color(t.dim)
        .child(div().text_right().child(chart.tick(hi))).child(div().text_right().child(chart.tick((lo + hi) / 2))).child(div().text_right().child(chart.tick(lo))))
      .child(div().relative().flex_1().h_full().children([...grid, ...plot.note === null ? layers : [div().absolute().top(0).left(0).size_full().p(6).text_size(11).text_color(t.dim).child(plot.note)]])))
    .child(h_flex().pl(36).text_size(10).text_color(t.dim).child(div().flex_1().child(`${span} ago`)).child(div().child("now")))
    .child(h_flex().pt(4).gap_x(10).gap_y(2).flex_wrap().children(legend));
}

export const usagePeriods = [["today", "Today"], ["7d", "7 days"], ["30d", "30 days"], ["all", "All"]];

export function usagePage(app, ui) {
  const { t, chip, heading, line } = ui;
  const page = app.pages.usage;
  const periods = h_flex().pt(8).gap(4).children(usagePeriods.map(([key, label]) => chip(`period-${key}`, label, app.usagePeriod === key, (cx) => app.setUsagePeriod(cx, key))));
  const wait = pending(ui, page);
  if (wait !== null) return [periods, ...wait];
  const u = page.data;
  const total = u.total;
  const table = (title, rows, limit) => [heading(title), ...rows.slice(0, limit).map((r) => h_flex().id(`u-${title}-${r.key}`).gap(8).py(2)
    .child(div().flex_1().truncate().text_size(12).text_color(t.foreground).child(r.key))
    .child(div().w(96).flex_none().text_size(11.5).text_color(t.muted).child(`${tokens(r.calls)} calls`))
    .child(div().w(56).flex_none().text_size(12).font_semibold().text_color(t.foreground).child(tokens(r.total))))];
  return [
    periods,
    heading("Total"),
    div().text_size(20).font_semibold().text_color(t.foreground).child(`${tokens(total.total)} tokens`),
    line(`${tokens(total.calls)} calls · in ${tokens(total.input)} · out ${tokens(total.output)} · cache write ${tokens(total.cacheWrite)} · cache read ${tokens(total.cacheRead)}`),
    ...table("By model", u.by.model ?? [], 8),
    ...table("By project", u.by.project ?? [], 8),
    ...table("By day (UTC)", u.by.day ?? [], 14),
    line(`Counting since ${new Date(u.countingSince).toISOString().slice(0, 10)}${u.backfill.state === "running" ? ` · backfill reading ${u.backfill.read} of ${u.backfill.of}` : ""}`, t.dim),
  ];
}
