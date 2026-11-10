// One thread: what it waits on you for, its review, its conversation as it streams, its changes, and the composer.
import { div } from "gpui-kit";
import { v_flex, h_flex, Textarea, TextView } from "gpui-base";
import { ago, attentionLabel, landOffer, openQuestions } from "./model.js";
import { blocks, queued } from "./transcript.js";

/** The newest blocks shown at first; Show earlier adds this many more. */
export const pageBlocks = 40;

export function threadView(app, ui, now) {
  const { t, button, chip, heading, empty, line, card, row, dot, tone } = ui;
  const d = app.detail;
  if (d === null || d.thread.id !== app.view.thread) return [empty("Loading the thread…")];
  const th = d.thread;
  const id = th.id;
  const open = th.status === "active";
  const worker = d.claudeWorker ? `Claude Code (${d.claudeWorker.model ?? "default model"}, ${d.claudeWorker.state})` : "Nexus agent";
  const working = th.agentTurnRunning || app.live?.working === true;
  const confirming = (key) => app.confirm === key;

  const toolbar = row(
    button("back", "← Back", (cx) => app.show(cx, { thread: null })),
    div().flex_1(),
    button("dash", "Dashboard", () => app.openUrl(`${app.conn.url}/threads/${id}`)),
    button("attach", "Attach", (cx) => app.attach(cx, id), { disabled: !open }),
  );

  const actions = row(
    d.attention === "reply"
      ? button("seen", "Mark seen", (cx) => app.act(cx, "Marking seen", () => app.post(`/v1/threads/${id}/seen`, { lastReplyAt: d.lastReplyAt })))
      : button("unseen", "Mark unread", (cx) => app.act(cx, "Marking unread", () => app.post(`/v1/threads/${id}/unseen`, {})), { disabled: d.lastReplyAt === null }),
    ...working && open ? [button("abort", "Stop the turn", (cx) => app.act(cx, "Stopping the turn", () => app.post(`/v1/threads/${id}/abort`)), { danger: true })] : [],
    ...d.pylon.failed ? [button("retry", "Retry the pylon", (cx) => app.act(cx, "Retrying the pylon", () => app.post(`/v1/threads/${id}/pylon/retry`)))] : [],
    ...d.attention === "failed" && !d.pylon.failed ? [button("retry-turn", "Retry the turn", (cx) => app.act(cx, "Retrying", () => app.post(`/v1/threads/${id}/retry`)))] : [],
    open
      ? confirming(`archive:${id}`)
        ? button("archive", "Archive: press again", (cx) => app.act(cx, "Archiving", () => app.post(`/v1/threads/${id}/archive`)), { danger: true })
        : button("archive", "Archive", (cx) => app.ask(cx, `archive:${id}`))
      : th.status === "archived" ? button("unarchive", "Unarchive", (cx) => app.act(cx, "Unarchiving", () => app.post(`/v1/threads/${id}/unarchive`))) : null,
  );

  const header = [
    div().pt(12).text_size(15).font_semibold().text_color(t.foreground).child(th.title),
    h_flex().pt(6).gap(8).items_center().child(dot(tone(d.attention)))
      .child(div().text_size(12).text_color(t.muted).child([attentionLabel[d.attention] ?? "Nothing waits on you", th.project, th.status, id].join(" · "))),
    line(`${worker} · pylon ${d.pylon.actualState} on ${d.pylon.node}, asked to be ${d.desired}`),
    ...d.pylon.failed ? [line(`Failed: ${d.pylon.failed.message ?? JSON.stringify(d.pylon.failed)}`, t.blocked)] : [],
    div().pt(8).child(actions),
  ];

  const prs = d.pullRequests.length === 0 ? [] : [heading("Pull requests"), ...d.pullRequests.map((pr) => h_flex().id(`pr-${pr.number}`).gap(8).py(4).rounded(4).cursor_pointer().hover((s) => s.bg(t.hover))
    .on_click(() => app.openUrl(pr.url))
    .child(div().flex_1().truncate().text_size(12.5).text_color(t.foreground).child(`#${pr.number} ${pr.title}`))
    .child(div().text_size(11.5).text_color(t.muted).child(`${pr.state} · checks ${pr.checks} · review ${pr.review}${pr.conflict ? " · conflict" : ""}`)))];

  return [
    toolbar, ...header,
    ...questionCards(app, ui, d),
    ...reviewSection(app, ui, d),
    ...prs,
    composer(app, ui, d, open),
    h_flex().pt(14).gap(4)
      .child(chip("sub-conv", "Conversation", app.sub === "conversation", () => { app.sub = "conversation"; }))
      .child(chip("sub-changes", "Changes", app.sub === "changes", () => { app.sub = "changes"; })),
    ...app.sub === "changes" ? changesView(app, ui, id) : conversationView(app, ui, now),
  ];
}

function questionCards(app, ui, d) {
  const { t, button, chip, heading, line, card } = ui;
  const questions = openQuestions(d);
  if (questions.length === 0) return [];
  return [heading(`Waiting on you ${questions.length}`), ...questions.map((q) => {
    const deployer = q.answerer === "deployer" ? [line("Answering it may deploy, so it needs a deployer.", t.dim)] : [];
    if (q.kind === "ask") {
      const picks = app.picks.get(q.id) ?? [];
      const asked = q.ask.questions.map((a, i) => v_flex().pt(8).gap(4)
        .child(div().text_size(11).font_semibold().text_color(t.dim).child(a.header.toUpperCase() + (a.multiSelect ? " · pick any" : "")))
        .child(div().text_size(12.5).text_color(t.foreground).child(a.question))
        .child(v_flex().pt(2).gap(4).children(a.options.map((o, oi) => chip(`q-${q.id}-${i}-${oi}`, o.description ? `${o.label}: ${o.description}` : o.label, (picks[i] ?? []).includes(o.label), () => app.pickOption(q, i, o.label, a.multiSelect)))))
        .children(app.ownInput(q.id, i) === null ? [] : [Textarea.new(app.ownInput(q.id, i)).w_full().h(48).p(6).rounded(6).border_1().border_color(t.input).bg(t.background).text_size(12).text_color(t.foreground)]));
      return card(`qcard-${q.id}`, t.blocked).child(div().text_size(12).text_color(t.muted).child("Claude asks"))
        .children(asked)
        .child(h_flex().pt(8).justify_end().child(button(`qsend-${q.id}`, app.sending ? "Answering…" : "Answer", (cx) => app.answerAsk(cx, q), { primary: true })));
    }
    const offers = q.options.map((option) => {
      const key = `q:${q.id}:${option}`;
      const waives = q.kind === "holds" && option === "Land";
      return waives && app.confirm !== key
        ? button(`qopt-${q.id}-${option}`, option, (cx) => app.ask(cx, key), { primary: true })
        : button(`qopt-${q.id}-${option}`, waives ? "Land: press again to waive" : option, (cx) => app.answer(cx, q, { option }), { primary: waives });
    });
    return card(`qcard-${q.id}`, t.blocked)
      .child(TextView.markdown(`qtext-${q.id}`, q.text).selectable(true).text_size(12.5))
      .children(deployer)
      .child(h_flex().pt(8).gap(6).flex_wrap().children(offers));
  })];
}

function reviewSection(app, ui, d) {
  const { t, button, heading, line, card } = ui;
  const rv = d.reviewView;
  const openPr = d.pullRequests.find((pr) => pr.state === "open");
  if (rv === null) {
    if (openPr === undefined || d.thread.status !== "active") return [];
    return [heading("Review"), line(`No review of #${openPr.number} yet.`), h_flex().pt(6).gap(6)
      .child(button("review", "Review", (cx) => app.act(cx, "Starting a review", () => app.post(`/v1/threads/${d.thread.id}/review`, { pr: openPr.number }))))
      .child(button("review-land", "Review and land", (cx) => app.act(cx, "Starting a review", () => app.post(`/v1/threads/${d.thread.id}/review`, { pr: openPr.number, land: true }))))];
  }
  const pr = d.pullRequests.find((p) => p.number === rv.pr) ?? null;
  const offer = landOffer(rv, pr);
  const said = d.said?.review ?? [];
  const all = said.length > 0 ? said : [`review ${rv.id} of #${rv.pr}: ${rv.phase.kind}, round ${rv.round} of ${rv.maxRounds}`];
  const expanded = app.reviewOpen === rv.id;
  const lines = expanded ? all : all.slice(0, 1);
  const key = `land:${rv.id}:${rv.head}`;
  const land = offer.kind !== "press" ? null : app.confirm === key
    ? button("land", `Land #${rv.pr}: press again${offer.waives.length > 0 ? " to waive" : ""}`, (cx) => app.land(cx, d.thread.id, offer.body), { primary: true })
    : button("land", `Land #${rv.pr}`, (cx) => app.ask(cx, key), { primary: true });
  const restart = rv.ended && openPr !== undefined && d.thread.status === "active"
    ? button("review", "Review again", (cx) => app.act(cx, "Starting a review", () => app.post(`/v1/threads/${d.thread.id}/review`, { pr: openPr.number }))) : null;
  return [heading("Review"), card("review-card")
    .children(lines.map((text, i) => div().id(`rv-${i}`).pt(i === 0 ? 0 : 3).text_size(12).text_color(i === 0 ? t.foreground : t.muted).child(text)))
    .children(all.length > 1 ? [div().id("rv-more").pt(4).text_size(11.5).text_color(t.accent).cursor_pointer()
      .on_click((_e, cx) => { app.reviewOpen = expanded ? null : rv.id; cx.notify(); })
      .child(expanded ? "Fewer details" : `${all.length - 1} more lines`)] : [])
    .children(rv.phase.kind === "needs-person" ? rv.phase.reasons.map((r, i) => div().id(`rv-why-${i}`).pt(3).text_size(12).text_color(t.blocked).child(`• ${r}`)) : [])
    .children(offer.kind === "press" && offer.waives.length > 0 && app.confirm === key ? [line(`Landing waives, at ${rv.head.slice(0, 12)}: ${offer.waives.join(" ")}`, t.blocked)] : [])
    .children(offer.kind === "none" && (!rv.ended || rv.phase.kind === "needs-person") ? [line(offer.why, t.dim)] : offer.kind === "question" ? [line("Answer the question about its holds above to land it.", t.dim)] : [])
    .child(h_flex().pt(8).gap(6).flex_wrap()
      .children([land, restart].filter((b) => b !== null))
      .children(rv.ended ? [] : [button("review-cancel", "Cancel review", (cx) => app.act(cx, "Cancelling the review", () => app.post(`/v1/threads/${d.thread.id}/review/cancel`)), { danger: true })]))];
}

function composer(app, ui, d, open) {
  const { t, button, heading, line } = ui;
  if (!open) return v_flex().child(heading("Message")).child(line("Unarchive the thread to message it."));
  const busy = d.thread.agentTurnRunning || app.live?.working === true;
  return v_flex()
    .child(heading("Message"))
    .child(Textarea.new(app.message).w_full().h(84).p(8).rounded(6).border_1().border_color(t.input).bg(t.background).text_size(12.5).text_color(t.foreground))
    .child(h_flex().pt(8).gap(6).justify_end()
      .children(busy && d.claudeWorker === null ? [button("steer", "Steer now", (cx) => app.sendMessage(cx, d.thread.id, "steer"))] : [])
      .child(button("send", app.sending ? "Sending…" : busy ? "Queue" : "Send", (cx) => app.sendMessage(cx, d.thread.id, "followUp"), { primary: true })));
}

function conversationView(app, ui, now) {
  const { t, button, empty, line } = ui;
  const live = app.live;
  if (live === null || live.thread !== app.view.thread) return [empty("Opening the conversation…")];
  if (live.error && !live.loaded) return [line(`The conversation did not load: ${live.error}`, t.blocked)];
  if (!live.loaded) return [empty("Loading the conversation…")];
  const all = blocks(live);
  const shown = all.slice(-app.shownBlocks).reverse();
  const waiting = queued(live);
  const top = [
    line(`Newest first · ${all.length} entries${live.dropped > 0 ? `, ${live.dropped} older not kept` : ""}${live.error ? ` · reconnecting: ${live.error}` : ""}`, t.dim),
    ...live.working ? [line(live.kind === "claude" ? "Claude is working…" : "The agent is working…", t.working)] : [],
    ...waiting.map((text, i) => div().id(`queued-${i}`).mt(6).p(8).rounded(6).border_1().border_color(t.input).text_size(12).text_color(t.muted).child(`Queued: ${text}`)),
  ];
  const more = all.length > shown.length ? [h_flex().pt(10).justify_center().child(button("earlier", `Show ${Math.min(pageBlocks, all.length - shown.length)} earlier`, (cx) => { app.shownBlocks += pageBlocks; cx.notify(); }))] : [];
  if (all.length === 0) return [...top, empty("No messages yet.")];
  return [...top, ...shown.map((b) => blockView(app, ui, b, now)), ...more];
}

function blockView(app, ui, b, now) {
  const { t } = ui;
  const when = b.at ? ago(b.at, now) : "";
  switch (b.kind) {
    case "prompt":
      return v_flex().id(b.key).mt(10).p(8).rounded(6).bg(t.selected)
        .child(div().text_size(10.5).text_color(t.dim).child([b.label ?? "You", when].filter(Boolean).join(" · ")))
        .child(TextView.markdown(`md-${b.key}`, b.text).selectable(true).text_size(12.5));
    case "reply":
      return v_flex().id(b.key).mt(10)
        .child(div().text_size(10.5).text_color(t.dim).child(["Agent", when].filter(Boolean).join(" · ")))
        .child(TextView.markdown(`md-${b.key}`, b.text).selectable(true).text_size(12.5));
    case "tool": {
      const open = app.openTools.has(b.key);
      const color = { ok: t.done, failed: t.blocked, running: t.working }[b.state] ?? t.idle;
      return v_flex().id(b.key).mt(4)
        .child(h_flex().id(`th-${b.key}`).gap(6).items_center().cursor_pointer().hover((s) => s.bg(t.hover)).rounded(4).px(4)
          .on_click((_e, cx) => { if (open) app.openTools.delete(b.key); else app.openTools.add(b.key); cx.notify(); })
          .child(div().size(6).rounded(3).flex_none().bg(color))
          .child(div().flex_none().text_size(11.5).font_semibold().text_color(t.muted).child(b.name))
          .child(div().flex_1().truncate().text_size(11.5).text_color(t.dim).child(b.text)))
        .when(open && b.output !== null, (el) => el.child(div().mt(2).p(6).rounded(4).bg(t.background).text_size(11).text_color(t.muted)
          .child(TextView.markdown(`out-${b.key}`, "```\n" + clipOutput(b.output) + "\n```").selectable(true))));
    }
    case "notice":
      return div().id(b.key).mt(6).text_size(12).text_color(b.tone === "error" ? t.blocked : t.accent).child(b.text);
    case "turn":
      return h_flex().id(b.key).mt(10).gap(8).items_center()
        .child(div().h(1).flex_1().bg(t.border)).child(div().text_size(10.5).text_color(t.dim).child(`${b.text}${when ? ` · ${when}` : ""}`)).child(div().h(1).flex_1().bg(t.border));
    default:
      return div().id(b.key).mt(4).text_size(11.5).text_color(t.dim)
        .when(Boolean(b.url), (el) => el.cursor_pointer().text_color(t.accent).on_click(() => app.openUrl(b.url)))
        .child(b.text);
  }
}

const clipOutput = (text, n = 4000) => (text.length > n ? `${text.slice(0, n)}\n… ${text.length - n} more characters` : text).replaceAll("```", "ˋˋˋ");

function changesView(app, ui, id) {
  const { t, button, empty, line, chip } = ui;
  const c = app.changes;
  if (c === null || c.thread !== id) {
    return [line("Reading the changes wakes a paused pylon, so they load only when asked.", t.dim),
      h_flex().pt(8).child(button("changes-load", "Load changes", (cx) => app.loadChanges(cx, id), { primary: true }))];
  }
  if (c.loading) return [empty("Reading the changes from the pylon…")];
  if (c.error) return [line(c.error, t.blocked), h_flex().pt(8).child(button("changes-load", "Try again", (cx) => app.loadChanges(cx, id)))];
  const bases = h_flex().pt(8).gap(4)
    .children([["start", "Since it started"], ["head", "Uncommitted"], ["turn", "Last turn"]].map(([base, label]) =>
      chip(`base-${base}`, label, c.base === base, (cx) => app.loadChanges(cx, id, base))));
  const files = c.data.files;
  return [
    bases,
    line(`${files.length} file${files.length === 1 ? "" : "s"} against ${c.data.base.kind} ${c.data.base.commit?.slice(0, 12) ?? "(empty tree)"}${c.data.truncated ? ", list cut short" : ""}`, t.dim),
    ...files.length === 0 ? [empty("No changes.")] : files.map((f) => {
      const shown = c.diff?.path === f.path;
      return v_flex().id(`file-${f.path}`)
        .child(h_flex().id(`fh-${f.path}`).gap(8).py(3).px(4).rounded(4).items_center().cursor_pointer().hover((s) => s.bg(t.hover))
          .when(shown, (el) => el.bg(t.selected))
          .on_click((_e, cx) => app.loadDiff(cx, f))
          .child(div().w(14).flex_none().text_size(11.5).font_semibold().text_color(t.accent).child(f.status[0].toUpperCase()))
          .child(div().flex_1().truncate().text_size(12).text_color(t.foreground).child(f.oldPath ? `${f.oldPath} → ${f.path}` : f.path))
          .child(div().flex_none().text_size(11).text_color(t.dim).child(f.additions === null ? "binary" : `+${f.additions} −${f.deletions}`)))
        .when(shown, (el) => el.child(c.diff.text === null ? empty("Reading the diff…")
          : div().mt(2).p(6).rounded(4).bg(t.background).text_size(11).child(TextView.markdown(`diff-${f.path}`, "```diff\n" + clipOutput(c.diff.text, 30000) + "\n```").selectable(true))));
    }),
  ];
}
