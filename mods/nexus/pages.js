// The panel's pages other than a thread: the thread lists, the start form, pipeline items, the cluster and usage.
import { div } from "gpui-kit";
import { v_flex, h_flex, Textarea } from "gpui-base";
import { ago, attentionLabel, byProject, clusterNode, inFlight, itemGroups, lastActivity, needsYou, tokens, unstarted } from "./model.js";

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

const bar = (ui, meter) => div().mt(3).h(6).w_full().rounded(3).bg(ui.t.border)
  .children(meter.percent === null ? [] : [div().h_full().rounded(3).bg(ui.t[meter.tone])
    .w(/** @type {`${number}%`} */ (`${meter.percent.toFixed(1)}%`))]);

export function clusterPage(app, ui, now) {
  const { t, heading, line, card } = ui;
  const page = app.pages.cluster;
  const wait = pending(ui, page);
  if (wait !== null) return wait;
  const { nodes, release, health } = page.data;
  const out = [];
  if (release !== null) {
    out.push(heading("Release"), line(`Desired ${release.desired?.commit?.slice(0, 12) ?? "none"}${release.desired?.requestedBy ? `, by ${release.desired.requestedBy}` : ""}`, t.foreground));
    for (const n of release.nodes ?? []) out.push(line(`${n.role} on ${n.node}: ${n.state} at ${n.commit?.slice(0, 12) ?? "nothing"}${n.reason ? ` (${n.reason})` : ""}`, n.state === "healthy" ? t.muted : t.blocked));
  }
  out.push(heading("Nodes"));
  for (const n of nodes) {
    const node = clusterNode(n, health[n.name], now);
    out.push(card(`node-${n.name}`, n.state === "online" ? t.border : t.blocked)
      .child(h_flex().gap(8).items_center()
        .child(div().size(8).rounded(4).bg(n.state === "online" ? t.done : t.blocked))
        .child(div().flex_1().text_size(13).font_semibold().text_color(t.foreground).child(n.name))
        .child(div().text_size(11.5).text_color(t.dim).child(node.status)))
      .children(node.healthError === null ? [] : [line(node.healthError, t.blocked)])
      .children(node.meters.map((meter, i) => v_flex().id(`meter-${n.name}-${i}`)
        .child(line(meter.text)).child(bar(ui, meter))))
      .child(line(node.committed, n.overcommitted ? t.blocked : t.muted))
      .child(line(node.pylons, t[node.pylonsTone]))
      .children(node.detail ? [line(node.detail, t.dim)] : []));
  }
  return out;
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
