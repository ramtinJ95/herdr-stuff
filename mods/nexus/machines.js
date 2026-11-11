// The Herdr Core machine Attach makes of a thread's pylon, reached through `nexus exec`, and removed once the thread
// is no longer open. The panel records the machines it added, in shared state, so it never removes one the person
// added: a machine shaped like the panel's is what the Nexus docs tell a person to add by hand.
import { hc, machines, panes, run, setShared, shared, spaces, terminals } from "herdr";
import { machineName, machineVia, showSteps, strayMachines } from "./model.js";

const addedKey = "nexus.machines";
/** How long Herdr may take to show an added machine's layout and terminals. */
const showMs = 20_000;

/** The names of the machines the panel added and has not removed yet. */
const added = () => /** @type {string[]} */ (shared(addedKey) ?? []);

function parsed(text) {
  try { return JSON.parse(text); } catch { return null; }
}

/** Runs `hc <args> --json`, throwing hc's message with its `kind`, or saying so when this hc has no `hc machine`. */
async function hcJson(args) {
  const r = await hc([...args, "--json"]);
  if (r.code === 0) return JSON.parse(r.stdout);
  if (/unrecognized subcommand '?machine\b/.test(r.stderr)) throw new Error(`This hc has no \`hc machine\`, which Attach needs: update Herdr Core with \`hc update\``);
  const error = parsed(r.stdout || r.stderr)?.error;
  throw Object.assign(new Error(`hc ${args.join(" ")}: ${error?.message ?? (r.stderr || r.stdout).trim()}`), { kind: error?.kind ?? null });
}

const listMachines = async () => (await hcJson(["machine", "ls"])).machines;

/** Makes the thread's pylon a machine, unless one of that name is there already, and answers its name. */
export async function addMachine(thread) {
  const name = machineName(thread);
  const there = (await listMachines()).find((m) => m.name === name);
  if (there?.temporary) throw new Error(`The machine ${name} was added with --temp, which keeps it out of Herdr. Remove it with \`hc machine rm ${name}\` and attach again`);
  if (there !== undefined) return name;
  try {
    await hcJson(["machine", "add", "--via", machineVia(name), "--name", name]);
  } catch (e) {
    // Another copy of the panel, or the person, added it meanwhile; it is theirs to record.
    if (/** @type {any} */ (e).kind === "name_taken") return name;
    throw e;
  }
  setShared(addedKey, [...added().filter((n) => n !== name), name]);
  return name;
}

/** Removes the machines the panel added whose thread is not in `open`, the open thread IDs. Safe to run again. */
export async function reconcileMachines(open) {
  if (added().length === 0) return;
  const { remove, forget } = strayMachines(added(), await listMachines(), open);
  const gone = new Set(forget);
  for (const name of remove) {
    try {
      await hcJson(["machine", "rm", name]);
    } catch (e) {
      if (/** @type {any} */ (e).kind !== "machine_unknown") throw e;
    }
    gone.add(name);
  }
  if (gone.size > 0) setShared(addedKey, added().filter((n) => !gone.has(n)));
}

/**
 * Shows the machine's terminals in a space on it, `title` naming the space when there is none yet, with the
 * worker's (`worker`, such as `t1`, or null) shown last. A remote terminal's pane must stay in a space on its own
 * machine, so they cannot be shown in the current space.
 */
export async function showMachine(cx, name, worker, title) {
  const address = worker === null ? null : `${name}/${worker}`;
  const live = () => terminals().filter((t) => t.state === "live" && t.address.startsWith(`${name}/`)).map((t) => t.address);
  const deadline = Date.now() + showMs;
  for (;;) {
    const layout = machines().find((m) => m.name === name)?.layout ?? "not loaded";
    if (layout === "ready" && (address === null || live().includes(address))) break;
    if (Date.now() > deadline) throw new Error(`Herdr does not show the machine ${name} after ${showMs / 1000} s: its layout is ${layout}${address !== null && layout === "ready" ? `, and ${address} is not among its terminals` : ""}. See \`hc machine ls\``);
    await cx.sleep(500);
  }
  const shownTerminals = live();
  const space = spaces().find((s) => s.machine === name);
  if (space !== undefined) run("space.select", { id: space.id });
  else run("space.new", { name: title, machine: name });
  const shown = new Set(panes().map((p) => p.terminal).filter((t) => t !== null));
  for (const [command, args] of showSteps(shownTerminals, shown, address)) run(command, args);
  // The app places the tabs in its own order, not the order asked, so the worker's tab is shown once its pane is there.
  if (address === null || !shownTerminals.includes(address)) return;
  const placed = () => { const has = new Set(panes().map((p) => p.terminal)); return shownTerminals.every((t) => has.has(t)); };
  for (const until = Date.now() + showMs; !placed(); await cx.sleep(200)) {
    if (Date.now() > until) throw new Error(`Herdr did not give every terminal of ${name} a pane within ${showMs / 1000} s`);
  }
  run("pane.focus", { terminal: address });
}
