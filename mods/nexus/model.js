// What the panel shows, from the control plane's thread rows. Pure: no Herdr imports, so Node tests it.
//
// A thread row's `attention` is the control plane's own ranking (docs/cli.md, "Attention and shared seen state"),
// so the panel groups by it rather than re-deriving the dashboard's server-side cards.

/** Attention that waits on the person, most urgent first. */
export const needRank = { failed: 0, decision: 1, parked: 2, limited: 3, reply: 4 };

export const attentionLabel = {
  failed: "Failed",
  decision: "Decision",
  parked: "Parked",
  limited: "Usage limit",
  reply: "New reply",
  working: "Working",
  waiting: "Waiting",
};

export const lastActivity = (r) => Math.max(r.lastAgentActivityAt ?? 0, r.lastHumanActivityAt ?? 0, r.lastReplyAt ?? 0, r.createdAt ?? 0);
const newestFirst = (a, b) => lastActivity(b) - lastActivity(a);
const isOpen = (r) => r.status === "active";
const needs = (r) => r.attention != null && r.attention in needRank;

/** Open threads waiting on the person, most urgent first, then most recent. */
export function needsYou(rows) {
  return rows.filter((r) => isOpen(r) && needs(r)).sort((a, b) => needRank[a.attention] - needRank[b.attention] || newestFirst(a, b));
}

/**
 * Open threads not waiting on the person, by what their agent and pylon are doing. This is not the dashboard's
 * by-phase view, which the server derives from reviews and pipeline items; the rows carry only attention and pylon state.
 */
export function inFlight(rows) {
  const groups = [
    { key: "working", title: "Working", test: (r) => r.attention === "working" || r.working === true },
    { key: "waiting", title: "Waiting for input", test: (r) => r.attention === "waiting" },
    { key: "running", title: "Running", test: (r) => r.pylon?.actualState === "running" },
    { key: "quiet", title: "Paused or stopped", test: () => true },
  ];
  const left = rows.filter((r) => isOpen(r) && !needs(r)).sort(newestFirst);
  return groups.map((g) => {
    const threads = left.filter((r) => g.test(r));
    for (const r of threads) left.splice(left.indexOf(r), 1);
    return { key: g.key, title: g.title, threads };
  }).filter((g) => g.threads.length > 0);
}

/** Open threads by project, projects in the order given, then any project only a thread names. */
export function byProject(rows, projects) {
  const open = rows.filter(isOpen).sort(newestFirst);
  const ids = [...projects.map((p) => p.id), ...open.map((r) => r.project)].filter((id, i, all) => all.indexOf(id) === i);
  return ids.map((id) => ({ project: id, threads: open.filter((r) => r.project === id) }));
}

export function countOpen(rows) {
  return rows.filter(isOpen).length;
}

/** What each thread's attention was, to compare the next refresh against. */
export function attentionOf(rows) {
  return new Map(rows.filter(isOpen).map((r) => [r.id, { attention: r.attention ?? null, lastReplyAt: r.lastReplyAt ?? null }]));
}

/**
 * The threads to notify about: those that came to need the person since `before`, or got another reply while
 * already showing one. A reply's `lastReplyAt` is its identity (docs/cli.md), so a later one is a new reply.
 * Null `before` is the first load, which notifies nothing.
 */
export function arrivals(before, rows) {
  if (before === null) return [];
  return rows.filter((r) => {
    if (!isOpen(r) || !needs(r)) return false;
    const was = before.get(r.id);
    if (was === undefined || was.attention !== r.attention) return true;
    return r.attention === "reply" && r.lastReplyAt !== was.lastReplyAt;
  });
}

/** The key a notification is deduplicated by, across copies of the panel. */
export const arrivalKey = (r) => `${r.id}:${r.attention}:${r.lastReplyAt ?? ""}`;

export function ago(at, now) {
  if (!at) return "";
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86_400)}d ago`;
}

/** Events that cannot change a thread row; the rest make the panel refetch the threads. */
export const quietKinds = new Set(["session.heartbeat", "health.changed", "release.changed"]);
export const changesThreads = (events) => events.some((e) => !quietKinds.has(e.kind));

/** A thread's questions still waiting for an answer. */
export const openQuestions = (detail) => (detail?.questions ?? []).filter((q) => q.answer === null && q.withdrawn === undefined);

/**
 * The body that answers a Claude worker's ask: a choice per asked question, in order, from what the person picked
 * (`picked[i]`, labels) and wrote (`own[i]`). Throws, naming the question, when one has neither.
 */
export function askBody(q, picked, own) {
  const choices = q.ask.questions.map((asked, i) => {
    const labels = asked.options.map((o) => o.label).filter((label) => (picked[i] ?? []).includes(label));
    const mine = (own[i] ?? "").trim();
    if (labels.length === 0 && mine === "") throw new Error(`Answer "${asked.header}": pick an option or write your own`);
    if (!asked.multiSelect && labels.length > 0 && mine !== "") throw new Error(`"${asked.header}" takes one answer: an option or your own`);
    return mine === "" ? { picked: labels } : { picked: labels, own: mine };
  });
  return { choices };
}

/** A pick on a question: a single-select one keeps only it; a multi-select one toggles it. */
export function pick(current, label, multi) {
  if (!multi) return current.includes(label) ? [] : [label];
  return current.includes(label) ? current.filter((l) => l !== label) : [...current, label];
}

/**
 * What Land offers for a review, as the dashboard decides it: the holds question to answer when one is open, a press
 * at the head waiving what the policy lets the person waive, or why there is none.
 */
export function landOffer(rv, pr = null) {
  if (rv === null || rv === undefined) return { kind: "none", why: "No review" };
  if (rv.question !== null) return { kind: "question", id: rv.question.id, head: rv.question.head, waives: rv.question.holds.map((h) => h.text) };
  if (pr !== null && pr.head && pr.head !== rv.head) return { kind: "none", why: `The pull request moved to ${pr.head.slice(0, 12)} after the review's ${rv.head.slice(0, 12)}, so that commit is not offered for landing. Review it again.` };
  if (rv.ended && rv.phase.kind !== "needs-person") return { kind: "none", why: `The review ended ${rv.phase.kind}` };
  if (rv.phase.kind !== "approved" && rv.phase.kind !== "needs-person") return { kind: "none", why: "It lands once its review approves it" };
  if (rv.press.kind === "stuck") return { kind: "none", why: `Held past any press: ${rv.press.holds.map((h) => h.text).join(" ")}` };
  const waives = rv.press.waives.map((h) => h.text);
  return { kind: "press", head: rv.head, body: waives.length === 0 ? { head: rv.head } : { head: rv.head, waive: waives }, waives };
}

/** Pipeline items still to land, by phase in pipeline order, then the recently finished. */
export function itemGroups(items) {
  const order = ["held", "planned", "queued", "building", "reviewing", "landing"];
  const titles = { held: "Held for you", planned: "Planned", queued: "Queued", building: "Building", reviewing: "In review", landing: "Landing" };
  const open = order.map((kind) => ({ key: kind, title: titles[kind], items: items.filter((i) => i.phase.kind === kind) })).filter((g) => g.items.length > 0);
  const done = items.filter((i) => !order.includes(i.phase.kind)).sort((a, b) => b.addedAt - a.addedAt).slice(0, 20);
  return done.length === 0 ? open : [...open, { key: "done", title: "Finished", items: done }];
}

/** An item the pipeline has not started yet, so approve and cancel apply. */
export const unstarted = (item) => item.thread === null && !["landed", "archived", "cancelled"].includes(item.phase.kind);

export function gib(n) {
  return n >= 100 ? `${Math.round(n)} GiB` : `${n.toFixed(1)} GiB`;
}

/** Like the CLI's tokenCount: 1.2k, 34M, 8.9B. */
export function tokens(n) {
  if (n < 1000) return String(n);
  for (const [unit, size] of /** @type {[string, number][]} */ ([["B", 1e9], ["M", 1e6], ["k", 1e3]])) {
    if (n >= size * 0.9995) {
      const scaled = n / size;
      return `${scaled >= 100 ? Math.round(scaled) : scaled.toFixed(1).replace(/\.0$/, "")}${unit}`;
    }
  }
  return String(n);
}
