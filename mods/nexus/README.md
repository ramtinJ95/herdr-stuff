# nexus

A [Herdr app](https://herdr.dev) mod with much of the dashboard beside your terminals:

- **Thread lists:** what waits on you, the work in flight, and every open thread.
- **Thread view:**
  - its conversation, streamed as it happens;
  - its open questions, answered in place;
  - its review, with Land, Review again and Cancel;
  - its pull requests and changes;
  - messaging, steering, Stop, Retry, Archive, marking seen, and attaching.
- **Other pages:** pipeline items with Approve and Cancel, the cluster's release and nodes, and token usage.

It uses the control plane that `nexus connect`, the [Nexus](https://github.com/ramtinJ95/nexus) CLI, saved in `~/.config/nexus/cli.json`, so connect the CLI first. A device that reaches Nexus through a SOCKS proxy cannot use it yet.

Install it by linking it into the app's mods:

```sh
ln -s "$PWD/mods/nexus" ~/.config/herdr-app/mods/nexus
```

Open it as a floating window with `herdr-app do mod.open '{"name":"nexus"}'`, or docked beside the focused pane with `herdr-app do pane.split '{"direction":"right","mod":"nexus"}'`. Its Pop out and Dock buttons switch between the two and keep the view. Props open a view: `{"thread": "th-..."}` or `{"tab": "needs" | "flight" | "threads" | "items" | "cluster" | "usage" | "start"}`. Its `keys.json` has the key that toggles the window, `ctrl-f e` → `mod.open:nexus`: merge it into `~/.config/herdr-app/keys.json`. Drag the window by its header; it reopens where you left it, and Esc or ✕ closes it.

The app does not hot-reload a linked mod: after a change, close and reopen the panel. Check a change with `herdr-app check mods/nexus`. `npm test` at the repo root runs `model.test.js` and `stream.test.js`.

## How it reads the control plane

- **Lists:** it reads `GET /v1/threads?status=open`. It polls `GET /v1/events` every 3 seconds from the newest event, and reads the threads again when an event can change them. Every minute it reads everything, for changes no event names. It learns the newest event from a moment on `/v1/events?follow=true&since=latest` rather than reading the history, and reads the history only when the control plane has no stream to give.
- **Conversation:** a shown thread's conversation follows `GET /v1/threads/<id>/claude/events`, or `/events` for a Nexus agent, as server-sent events. It shows the newest entry first and reconnects with backoff.
  - `fetch` reads a body only whole, so the stream goes over a raw socket.
  - That socket speaks no TLS, so the stream goes to the plain API on port 7470 of the control plane's host.
  - Each copy of the panel holds one stream while a thread is shown. The control plane serves 16 streams in all.
- **Seen:** a shown reply is marked seen with its own `lastReplyAt`, as the dashboard does. This happens only while the window is active and the panel is on screen: the window, or a docked copy in the shown tab.
- **Changes:** reading a thread's changes wakes a paused pylon, so they load only when you press Load changes.
- **Confirmations:** Land, Archive and Cancel take a second press within 6 seconds. A Land that waives holds names them first.
- **Notifications:** they post only while a copy of the panel runs.
