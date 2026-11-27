# PR pane: reference

Everything the pane does, in detail. The [README](../README.md) has the short version and the keys.

## Which pull request

The pane follows its tab. It shows the pull request of the terminal you focused last in that tab, and changes when you focus another terminal or that terminal changes folder or branch. It takes the folder and branch from the terminals beside it, since a mod pane has neither.

With no pull request for the branch, it says so and looks again every 30 seconds.

A pane can be pinned to one pull request instead, in any repository `gh` can see: open it with the prop `pr`, as `owner/name#number` or the pull request's URL.

```sh
herdr-app do pane.split --direction right --mod pr --props '{"pr":"cli/cli#9000"}'
```

A pinned pane does not follow its tab, names its repository in the header beside "pinned", and has no line about your checkout. Merge works in it as in any other.

## Keyboard and mouse

The keys are in the [README](../README.md#keys).

The pane has the keyboard once it opens, and again when you click in it, on Merge too, or move onto it.

In a wide pane and in the window, the line between the list and what stands beside it drags. The list's width is remembered, and a new pane or window starts at the width last dragged to.

## Description

The first row is the description, drawn as Markdown, open until you close it; every pane remembers which. `o` on the row opens the pull request on GitHub.

Under it is the conversation, oldest first: the latest 30 comments, and of the latest 30 reviews those that say something, in words of their own or as an approval or a request for changes. A review that only carries line comments is not there: its comments are the threads. A line counts what came before, and a last line counts the threads on the diff and how many are not resolved. They stand among the lines under Files.

## Files

The second row is the files the pull request changes, folded until you open it; every pane remembers which. Each file shows its status, path and lines added and removed. Selecting one shows its diff beside the list in a wide pane; Enter shows it in place of the list in a narrow one, until Esc, and in both puts the keyboard in it.

The diff is GitHub's own patch per file, with line numbers. It is drawn plain at once, and a moment later in syntax colours, with the part of a changed line that differs marked. The colours come from [Pierre](https://diffs.com) (`@pierre/diffs`), which reads each file's language and tells the pane what each stretch of a line is: a keyword, a string, a comment. The pane picks the colour for each from the terminal palette, so a diff follows the layout it stands in.

Pierre is a web library and Herdr has no web view, and its highlighter does not run in Herdr's own JavaScript runtime. So the pane runs it with `node`, on this computer, once for all of a pull request's files: `pierre/highlight.mjs`. It hands the helper the diffs in a file under `~/.config/herdr-app/cache/pr`, removed when the run ends. A diff that stays plain says why in a line above it: the package is not installed, `node` did not run, or the helper's lines were not this diff's lines. Pierre does not colour a line longer than 1,000 characters.

A line longer than the diff is wide folds at its edge, as a terminal folds it, so there is no scrolling sideways; its number stands by its first part. It folds a few characters early, since the pane reckons a character's width and does not measure it. Past 400 columns a line is cut. A file GitHub gives no patch for, a binary one or one too large, says so. Past 300 files the list stops and a row counts the rest.

## Review

Enter or `l` on a file puts the keyboard in its diff, and a click on a line does too. There you note what you see, line by line, and send it to the agent in the tab: the pane types it into the agent's terminal and submits it, as `hc send` does. The keys and the words are those of the review-pane mod for Claude Code, which does the same on a response.

Its keys are in the [README](../README.md#keys), under "In a diff".

An annotation is typed on one line in a field under the diff: Enter keeps it, Esc or an empty field gives it up. It then stands under the last line it covers, its lines carry its mark in the gutter, and the file's row counts it. The bar under the diff shows the one the cursor is on in full.

What is sent names the pull request and its commit, and for each annotation the file, the lines and the diff lines themselves in a `diff` fence. A question is sent alone and at once, and its row then says `asked`; the answer comes in the agent's terminal, not in the pane. Questions are not sent again with the review.

It goes to the tab's agent: the terminal the pane follows when an agent runs in it, else another agent in the tab. A tab with only a shell gets nothing: the pane says there is no agent, since a shell would run the words. `hc send` waits while you have a half-typed prompt in that terminal, and a send it refuses is said in the bar with its reason, the annotations kept.

Annotations are kept per pull request until they are sent or deleted, in Herdr's shared state (`pr.reviews` in `shared.json`). So closing the pane loses none, and a pane that follows its tab, a pinned pane and a window on the same pull request all show the same ones. Each remembers the commit it was written at. After a push, those of earlier commits stand above the file's first line, since their rows may no longer be these rows, and are sent with their old lines and that commit named.

Each `pr.<action>` works as a command while the keyboard is in a diff (`herdr-app do pr.range`), `pr.finish`, `pr.post` and `pr.confirm` among them. An approval does not: there is no `pr.approve`, and `pr.confirm` does not give one. Like Merge it takes `A` and Enter in the pane.

### On GitHub

`Y` posts what you noted as one review, with the verdict "Comment": every comment, suggestion and issue becomes a comment on the lines it was written on, a suggestion or an issue named as one in bold. The bar asks first, and Enter posts. What GitHub has no line for goes in the review's own words, with the lines quoted: a note on the pull request as a whole, one written at an earlier commit, one on a hunk's header. A range that crosses hunks keeps the part in its last hunk, which is all GitHub takes. Questions are not posted: they went to the agent. Once GitHub has taken the review the annotations leave the pane, and what you posted comes back as threads. If it does not take it, the bar says why in GitHub's words and the annotations stay.

`A` approves, with the same comments when there are any. It is offered on an open pull request that someone else opened: GitHub takes no approval from the author. There is no "Request changes".

GitHub's own threads stand among the lines like annotations do: one row under the line each is on, marked `◆` in the gutter along its lines, dimmed once resolved. The bar under the diff shows the one the cursor is on in full, every comment as Markdown. A thread whose lines have changed since (outdated), one on the file as a whole, and one on a line the diff does not show stand above the file's first line. A file's row counts its open threads, or its resolved ones when none is open.

`r` on a thread opens the field for a reply, and Enter posts it at once; a reply GitHub does not take comes back into the field with the reason. `z` resolves it, or opens it again, where GitHub lets you. `f` hands it to the tab's agent, as `y` hands it your review: where it is, its lines, and all that was written in it.

A review, an approval and a reply go only on Enter, in answer to a line that says what goes where. `z` acts at once, and a second `z` takes it back.

## Window

`w` opens the pull request in a window that floats over the layout, 94% of the app wide and 92% high, on the file and the line you were at. It starts from what the pane has already read, so it is there at once, with Merge off until GitHub has answered it too. Everything works in it as in the pane, and a review goes to the same agent. Its header drags it; `q`, the ✕ or Esc closes it, and the pane under it is as you left it. Closed while a review, a reply or a merge is on its way, it stays until that has gone and then closes, as the pane does: Herdr drops what a closed copy is waiting on, and the notes would stay to be sent twice. Closing the pane with Herdr's own key, or quitting, does not wait. Esc first gives up what is half done, then leaves the diff for the list, so from a diff it closes on the second press. While it is open the `pr.<command>`s are its own.

## Merge

Merge shows only when GitHub reports the pull request clean (`CLEAN` or `HAS_HOOKS`). A pull request GitHub would merge with a check not passing (`UNSTABLE`) gets no button, and a note when the pane can name the check. The method is the repository's default if it is allowed, else the first allowed one, and the button names it.

It takes two presses, in the pane:

- The first press says what the second will do. It is taken back after 10 seconds, by Esc or any other key or click, when the head commit changes, and when a poll fails.
- A second press within 0.7 seconds of the first does nothing, so a held key or a double-click cannot merge. `MERGE_GAP_MS` and `MERGE_ARMED_MS` in `merge.js` hold both times.
- The button is off while the pane shows a saved copy or the last answer before a failed poll.
- The second press asks GitHub once more and stops if Merge would no longer be offered or the head commit is another one. Then it runs `gh pr merge <number> --<method> --match-head-commit <sha>`, so a push in between merges nothing.

There is no `pr.merge` command: `herdr-app do` and key bindings cannot merge.

## When it asks GitHub

- Every 10 seconds while checks run, every 60 seconds for an open pull request whose checks have settled, never for a merged or closed one. `POLL` in `model.js` holds the delays, and `FAILURE_WAIT` those after a failure.
- The description, the conversation and the threads, in one call, while Description or Files is open, and again only when the pull request's `updatedAt` moves: an edit, a comment, a review, a push. One more call of 1 point, about 0.8 s on a pull request with six threads. With both folded it is not asked for. It is also asked after the pane has posted, replied or resolved, and by `r`: resolving a thread on github.com may not move `updatedAt`.
- A review, a reply and a resolve are one call each, only when you send them.
- The files while their row is open, once per head commit: one REST call per 100 files, which carries every diff. It took 0.6 to 1.1 s on three pull requests of 3 to 30 files. They are not saved between runs. The colours ask GitHub nothing: one run of `node` after the files land, 0.3 to 1.7 s on those three.
- Not at all while the window is hidden or the pane's tab is not the one shown. It asks at once when the tab shows again. A pane does not ask either while a window opened with `w` floats over it: the window asks, and the pane looks again when it closes.
- Each poll is one query, then one for the steps of up to 6 running jobs, shown together. A finished job's steps are asked for once and kept. Selecting a check asks for its steps alone, not a poll. Each call costs 1 point of GitHub's 5,000 an hour, so a pane left visible on a running pull request uses about 650 an hour.
- It opens on the last answer it saw for that pull request, description included, marked with its age, and replaces it when the fresh one lands. A window opens on what its pane has read, files included.

It shows no toasts and opens nothing over the window. Errors are a line in the pane.

## Layouts

It draws with `theme()` and the terminal palette (`ansi1`, `ansi2`, `ansi3`) for failed, passed and running, since it stands on the terminal background. Checked in `main-personal`, `main`, `cosy`, `terminals` and `win98`, the window too. The pane's frame and its header, which reads `pr`, are Herdr's, as is the window's frame.
