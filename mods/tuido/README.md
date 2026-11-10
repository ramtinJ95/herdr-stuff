# tuido

A [Herdr app](https://herdr.dev) mod that shows your [tuido](https://github.com/ramtinJ95/tuido) todo lists in a floating window beside your terminals:

- **Lists:** the actionable tasks of the current workspace, or of every workspace, grouped by list and by the Markdown headings they sit under. Each row shows its priority, due date (overdue in red, today and tomorrow in yellow) and age, as `tuido ls` does. Each list counts what it hides; **Show hidden** shows those tasks too.
- **Complete:** the circle before a task marks it done.
- **Add:** the input runs `tuido add`, flags included: `rotate certs -p high -d fri`. The **to** button beside it picks where the task goes: any list in scope or any of its sections, empty ones included, or tuido's default list. The window remembers the choice. A list with headings offers only its sections, unless its marker names a capture section, because tuido refuses to add to such a list without one. **+ New list…** at the foot of the picker creates a list in the current workspace (`tuido new`; nest it with `/`, such as `projects/migration`) and picks it. An `-l` typed into the text overrides the pick.
- **Edit:** a task opens its list in your editor at that line, in a terminal split to the right of the focused pane. A list's name opens the whole list.
- **Workspaces:** a workspace chip switches tuido's workspace (`tuido use`), and **All** shows every workspace.
- **Upkeep:** each list has Sort and Archive. Archive asks again before it runs. Sync runs `tuido sync`, and `ctrl-s` does the same while the window has the keyboard.

It needs tuido 0.8 or later (`done --at`, `headings` in `ls --json`, `_lists --json` and `new`), installed on `PATH` and set up with `tuido init`.

Install it by linking it into the app's mods, then merge its `keys.json` into `~/.config/herdr-app/keys.json`. It binds `ctrl-f t` to toggle the window, and `ctrl-s` in the `mod:tuido` section to sync. The Sync button shows whichever key `tuido.sync` is bound to.

```sh
ln -s "$PWD/mods/tuido" ~/.config/herdr-app/mods/tuido
```

The key toggles the window. Drag it by its header or any empty space. It reopens where you left it, and Esc or ✕ closes it. To dock it as a pane instead, use `herdr-app do pane.split '{"direction":"right","mod":"tuido"}'`.

## How it works

- **tuido owns the files.** The mod parses no Markdown and writes no file. It reads `tuido ls --json --all` and runs tuido's own commands, so the ✅ stamp, sorting, archiving and the git commit after every change are exactly what the CLI does.
- **Completing names one task.** The circle runs `tuido done --at <path:line> -- <description>`. tuido refuses if that line no longer holds a matching task, for example after an edit moved the lines, and the panel shows why.
- **Destinations** come from `tuido _lists --json`, which gives every list's sections, so a section with no tasks yet can still be picked. A task is added with `-l <workspace>/<list>/<section> --all`. If a picked list or section disappears, the window says so and goes back to the default list.
- **Sort and Archive** pass the list's exact `workspace/list` ref with `--all`, and an exact ref always wins over tuido's fuzzy list matching.
- **Refresh:** it watches the todo root (from `tuido sync --status`) and reads the lists again when a `.md` file changes, whether that's your editor, a pull or another tuido. It also reads them every 10 minutes, because start and scheduled dates reveal tasks without any file changing.
- **The editor** is `$TUIDO_EDITOR`, `$VISUAL`, `$EDITOR`, then `nvim`, as for `tuido open`, started in the todo root with `+<line>`. Editors that don't take `+N` (Helix, VS Code) open the file at the top.
- **Warnings** tuido prints beside its JSON, such as sync trouble or a newer release, show under the input.

The app does not hot-reload a linked mod, so close and reopen the window after a change. Check a change with `herdr-app check mods/tuido`. `npm test` at the repo root runs `model.test.js`.
