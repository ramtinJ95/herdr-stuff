# nexus

A [Herdr app](https://herdr.dev) mod with much of the dashboard beside your terminals:

- **Thread lists:** what waits on you, the work in flight, and every open thread.
- **Thread view:**
  - its conversation, streamed as it happens;
  - its open questions, answered in place;
  - its review, with Land, Review again and Cancel;
  - its pull requests and changes;
  - messaging, steering, Stop, Retry, Archive, marking seen, and Attach, which shows the pylon's terminals in the app.
- **Other pages:** pipeline items with Approve and Cancel, the cluster's release and nodes, and token usage.

It uses the control plane that `nexus connect`, the [Nexus](https://github.com/ramtinJ95/nexus) CLI, saved in `~/.config/nexus/cli.json`, so connect the CLI first. Both direct connections and a saved SOCKS5 proxy are supported.

Install it by linking it into the app's mods:

```sh
ln -s "$PWD/mods/nexus" ~/.config/herdr-app/mods/nexus
```

Open it as a floating window with `herdr-app do mod.open '{"name":"nexus"}'`, or docked beside the focused pane with `herdr-app do pane.split '{"direction":"right","mod":"nexus"}'`. Its Pop out and Dock buttons switch between the two and keep the view. Props open a view: `{"thread": "th-..."}` or `{"tab": "needs" | "flight" | "threads" | "items" | "cluster" | "usage" | "start"}`. Its `keys.json` has the key that toggles the window, `ctrl-f e` → `mod.open:nexus`: merge it into `~/.config/herdr-app/keys.json`. Drag the window by its header; it reopens where you left it, and Esc or ✕ closes it.

Check a change with `herdr-app check mods/nexus`. `npm test` at the repo root runs the model, stream and transport regression tests.

## The same mod on every machine

Use the same checkout's `main` branch on both machines. Update with `git pull --ff-only` in this repo, then close and reopen the Nexus panel to ensure it loads the new code and configuration (newer Herdr versions also reload mod edits automatically). Keep `~/.config/nexus/cli.json` local to each machine; it is not part of this repo.

On a machine connected directly to the personal tailnet, use its saved control-plane URL with `socks` omitted or `"none"`. On a work-tailnet machine, use that same URL with its local home-tailnet SOCKS proxy as below. Pulling this repo never copies proxy settings between machines. Both paths use the same actions, Attach, presence updates and live conversations.

## A home tailnet alongside a work tailnet

Keep the work Tailscale app connected normally. If the home tailnet is served by a separate userspace daemon (such as `ts-home`), keep its SOCKS5 proxy running and use the Nexus CLI's saved configuration:

```json
{
  "url": "https://your-home-control-plane:7443",
  "socks": "localhost:1055"
}
```

The mod reads that file when opened; it does not change it or either tailnet. No routes, exit nodes, sharing, or local forwarding services are added.

- With `socks` absent or `"none"`, native `fetch` and direct streaming behave as before.
- With `socks: "HOST:PORT"`, JSON requests use `curl` on `PATH`, with SOCKS-side DNS and normal HTTPS certificate verification. Streaming sockets connect only to that proxy and send the destination hostname in a SOCKS5 handshake. No-auth SOCKS5 is required.
- A proxy error is shown, never retried directly. `NO_PROXY` and `.curlrc` cannot bypass the proxy. Requests have a 30-second timeout and are not automatically retried; a timed-out mutation may already have executed.
- Conversations still stream live, not as buffered polling. Stream operations time out after 30 seconds without progress. Herdr 0.1.14–0.1.15 only writes UTF-8 strings to sockets: the standard stream port `7470` works, but a custom stream port whose two bytes contain a value above 127, or a hostname longer than 127 bytes/non-ASCII, is explicitly refused. Direct mode is not subject to this restriction.
- **Attach** uses `hc machine add --via 'nexus exec <thread>'`, as described below. Keep the Nexus CLI current: `nexus exec` must support the CLI's saved proxy too. External links still open in your browser; the mod does not configure browser proxy settings.

This is application-level proxy use, not a bridge between tailnets. Closing the panel closes its stream; it does not stop the proxy or disconnect either tailnet.

## How it reads the control plane

- **Lists:** it reads `GET /v1/threads?status=open`. It polls `GET /v1/events` every 3 seconds from the newest event, and reads the threads again when an event can change them. Every minute it reads everything, for changes no event names. It learns the newest event from a moment on `/v1/events?follow=true&since=latest` rather than reading the history, and reads the history only when the control plane has no stream to give.
- **Conversation:** a shown thread's conversation follows `GET /v1/threads/<id>/claude/events`, or `/events` for a Nexus agent, as server-sent events. It shows the newest entry first and reconnects with backoff.
  - `fetch` reads a body only whole, so the stream goes over a raw socket.
  - That socket speaks no TLS, so the stream goes to the plain API on port 7470 of the control plane's host.
  - Each copy of the panel holds one stream while a thread is shown. The control plane serves 16 streams in all.
- **Seen:** a shown reply is marked seen with its own `lastReplyAt`, as the dashboard does. This happens only while the window is active and the panel is on screen: the window, or a docked copy in the shown tab.
- **Changes:** reading a thread's changes wakes a paused pylon, so they load only when you press Load changes.
- **Confirmations:** Land, Archive and Cancel take a second press within 6 seconds. A Land that waives holds names them first.
- **Commands:** `nexus.attach` and `nexus.archive` press the shown thread's Attach and Archive, for a key in `keys.json` or `herdr-app do nexus.archive`. Archive still takes a second command within 6 seconds.
- **Notifications:** they post only while a copy of the panel runs.

## Attach makes the pylon a machine

Attach shows a thread's pylon terminals in the app, as native panes, by adding the pylon as a Herdr Core machine named after the thread:

```sh
hc machine add --via 'nexus exec <thread>' --name <thread>
```

1. If the pylon does not run, Attach wakes it with `POST /v1/threads/<id>/activity`, as `nexus wake` does, because `nexus exec` never wakes a pylon. The status bar shows the pylon's state while it waits, for up to 120 seconds. Attach fails for an archived thread or a failed pylon.
2. If a machine of that name exists, Attach uses it as it is. Otherwise it adds one.
3. Once the app shows the machine, Attach selects the machine's space, or makes one named after the thread. A pylon's terminal can have a pane only in a space on its own machine, so the space holds them. Each terminal without a pane gets a tab, and the worker's Claude Code terminal comes last, so its tab is the one shown.

A failure at any step shows in the status bar. An `hc` older than `hc machine` fails with a message to run `hc update`.

The machine is not added with `--temp`, because Herdr leaves temporary machines out of the app.

While the app window is active and shows a space on an open thread's machine, the panel posts human activity for that thread every 4 minutes, as `nexus wake` does. A pylon you watch then does not pause for idleness, and a paused one wakes. A connection through `nexus exec` alone counts as no one, so this needs a copy of the panel running, docked or open, and stops once you switch spaces, leave the window, or close the panel.

The panel removes only the machines it added. It records their names in its shared state, `nexus.machines`, since a machine you add by hand, as the Nexus docs show, looks the same. It removes a recorded machine with `hc machine rm <thread>` in these cases:

- You archive the thread from the panel.
- On the minute's full read, the thread is no longer among the open threads, as after an archive or delete from the CLI or the dashboard.

A recorded machine that you removed, or replaced with one that is not reached through `nexus exec <thread>`, is dropped from the record and left alone. Removing a machine removes its space from the app, while its terminals keep running in the pylon. Typing into those terminals is not human activity in Nexus, except a prompt you submit to Claude Code. So the pylon still pauses 20 minutes after the last human activity while the app shows it, and the app reconnects once the pylon runs again.
