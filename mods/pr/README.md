# PR pane

A [Herdr app](https://herdr.dev) mod that shows the pull request of the branch you are on, as a pane beside your terminals:

- its stage: no pull request yet, draft, open, merged or closed;
- whether it can merge, and what blocks it: a draft, conflicts, behind the base branch, a review, required checks, a branch rule;
- its description, with who opened it and when, its reviewers and where each stands, its labels, and the comments and reviews under it;
- every check, grouped as failed, running, cancelled, passed and skipped, with the step a running GitHub Actions job is on;
- the steps of the check you select, beside the list when the pane is 720 px or wider and under the row when it is narrower;
- the files it changes and each file's diff, in syntax colours;
- your review of the diff: notes on its lines, and questions, sent to the agent in the tab or posted on GitHub as a review;
- GitHub's review threads among the diff's lines, to reply to, resolve, or hand to the agent;
- Merge, when GitHub reports the pull request clean.

It needs the [GitHub CLI](https://cli.github.com) (`gh`), logged in.

## Install

```sh
ln -s "$PWD/herdr-stuff/mods/pr" ~/.config/herdr-app/mods/pr
```

Merge `keys.json` into `~/.config/herdr-app/keys.json`. **Ctrl-f o** splits the focused pane to the right with the pull request pane, and **Ctrl-f Shift-o** closes the one in the tab you are in, from any pane. The command palette has the first as **Pull request**.

For syntax colours in the diffs, install the helper's one package (53 packages, 49 MB, in a folder git ignores). It needs `node` on this computer:

```sh
cd herdr-stuff/mods/pr/pierre && npm install
```

Without it the pane works the same and its diffs are plain.

## Which pull request

The pane follows its tab. It shows the pull request of the terminal you focused last in that tab, and changes when you focus another terminal or that terminal changes folder or branch. It takes the folder and branch from the terminals beside it, since a mod pane has neither.

With no pull request for the branch, it says so and looks again every 30 seconds.

A pane can be pinned to one pull request instead, in any repository `gh` can see: open it with the prop `pr`, as `owner/name#number` or the pull request's URL.

```sh
herdr-app do pane.split --direction right --mod pr --props '{"pr":"cli/cli#9000"}'
```

A pinned pane does not follow its tab, names its repository in the header beside "pinned", and has no line about your checkout. Merge works in it as in any other.

## Keys in the pane

| Key | Does |
| --- | --- |
| j, k, arrows | Move the selection |
| Enter, Space | Open or close the description, the files or a group, show a check's steps, or go into a file's diff |
| l | Go into the selected file's diff: see Review |
| o | Open the selected check, the pull request, or from a file its files page, on GitHub |
| r | Refresh now |
| w | Open the pull request in a window over the layout: see Window |
| m | Merge: the first press says what will happen, the second does it. A held key does neither |
| Esc | Take back the first press of Merge; in a narrow pane, leave a diff or a check's steps for the list; in a window, close it |
| q | Close the pane, or the window |

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

## Window

`w` opens the pull request in a window that floats over the layout, 94% of the app wide and 92% high, on the file and the line you were at. It starts from what the pane has already read, so it is there at once, with Merge off until GitHub has answered it too. Everything works in it as in the pane, and a review goes to the same agent. Its header drags it; `q`, the ✕ or Esc closes it, and the pane under it is as you left it. Closed while a review, a reply or a merge is on its way, it stays until that has gone and then closes, as the pane does: Herdr drops what a closed copy is waiting on, and the notes would stay to be sent twice. Closing the pane with Herdr's own key, or quitting, does not wait. Esc first gives up what is half done, then leaves the diff for the list, so from a diff it closes on the second press. While it is open the `pr.<command>`s are its own.

## Review

Enter or `l` on a file puts the keyboard in its diff, and a click on a line does too. There you note what you see, line by line, and send it to the agent in the tab: the pane types it into the agent's terminal and submits it, as `hc send` does. The keys and the words are those of the review-pane mod for Claude Code, which does the same on a response.

| Key | Does |
| --- | --- |
| j, k, arrows | Move the cursor a line |
| d, u | Move it half a screen |
| g, b or G | First line, last line |
| v | Start a range at the cursor, or end it. Shift-click does the same from the cursor to the line clicked |
| c, s, i | Note a comment, a suggestion or an issue on the line or range |
| a | Ask a question about the line or range: it goes to the agent as soon as you press Enter |
| o | Note a comment on the pull request as a whole |
| h, l | The annotation or GitHub thread before or after, in whichever file it is |
| r, x | Change or delete the annotation the cursor is on. On a GitHub thread, `r` replies to it |
| z | Resolve the GitHub thread the cursor is on, or open a resolved one again |
| f, then Enter | Send the GitHub thread the cursor is on to the agent, with the lines it is on |
| n, p | The next or previous file |
| w | Open this diff in a window, at this line |
| y, then Enter | Send every comment, suggestion and issue to the agent as one review. They leave the pane once sent, and the questions already asked with them; a question whose asking failed stays |
| Y, then Enter | Post them on GitHub as one review, each a comment on its lines. They leave the pane once posted, as with `y` |
| A, then Enter | Approve the pull request on GitHub, with them if there are any |
| Esc | Give up the field, the range, then the diff, one at a time; in a window, once more closes it |

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

## Not there yet

- A status dot on the tab for pull requests in tabs you are not looking at. The tab bars are other mods.
- Checks beyond the first 100 are counted, not listed.
- A space on another machine runs `gh` there. That path is written and has not been run.
- Only GitHub Actions jobs have steps. Another service's check shows its state, description and link.
- A running job's log. GitHub gives it only when the job ends.
- "Request changes" as a verdict, a new comment under the description, and editing or deleting what is on GitHub.
- Threads beyond the first 100, comments beyond a thread's first 30, and the conversation before its latest 30 comments and 30 reviews are counted, not shown.
- An annotation or a reply longer than one line, and the agent's answer to a question in the pane. An annotation's or a thread's row among the lines is cut at the pane's edge and does not fold; the bar under the diff has it whole.

`props: { "replay": "/path/frame.json" }` draws one recorded answer instead of asking GitHub, with Merge off. The screenshots of each state were made with it.

## Data

The pane asks `gh` about the pull request for the branch checked out in a folder. What it changes on GitHub is a merge (`merge.js`) and a review, a reply and a resolve (`query.js`). Each file below has one reason to change:

- `query.js` holds what `gh` is asked: the GraphQL and the arguments. `PR_QUERY` is the poll, which `record.js` shares. It asks for steps only with `$steps`, because steps make a poll about three times slower, and it carries the repository's merge methods, so Merge needs no call of its own. `STEPS_QUERY` asks for the steps of a few check runs by node id. `ABOUT_QUERY` asks for the description, author, labels and reviewers, the comments and reviews, and the review threads, apart from the poll because none of it moves with CI. `lookupArgs` is `gh pr view` for a folder's branch. `prArgs`, `stepsArgs` and `aboutArgs` build the `gh api graphql` arguments from where the pull request lives. `filesArgs` is the one REST call, `pulls/<number>/files`: GraphQL has no diffs. `replyArgs` and `resolveArgs` write to a thread. `reviewArgs` posts a review as one `addPullRequestReview` mutation with its values written into the query: gh's `-f` and `-F` flags cannot say a list of comments, since gh gathers the two kinds apart and a comment's words and its line number land in different comments.
- `github.js` is the boundary: what GitHub and `gh` answer, read. `parsePr` turns a `PR_QUERY` answer into a `Snapshot`, with the method Merge would use, and throws a `GhError` with a `kind` when the answer has errors or a field it does not read. `mergeSteps` sets the steps from a `STEPS_QUERY` answer on a snapshot. `parseAbout` turns an `ABOUT_QUERY` answer into an `About`, with the conversation in the order it was written and each thread's line, side and rights. `parseFiles` turns a `filesArgs` answer into the files, each with its patch or null. `parseLookup` and `parsePin` give where a pull request lives, a `Target`, and `prRef`, `prUrl`, `repoSlug` and `prKey` are the ways one is written. `classifyFailure` names what went wrong from a non-zero exit, and `classifyRejection` does the same for a rejected `exec` or a `GhError`. `readAnswer` reads a gh run with a parser and gives the value or the failure.
- `model.js` is what a snapshot means, pure. `summarize` gives the stage, the CI state, what blocks the merge, and the headline with its tone and what it is about (`lead`), which is how the pane keeps from saying a thing twice. `groups` gives the checks in display order. `stepsWanted` picks the checks to ask steps for, and `keepSteps` carries a finished job's steps into the next poll's snapshot. `nextPollDelay` reads the `POLL` table and `failureDelay` the `FAILURE_WAIT` one. `offersMerge` says whether the pane offers Merge.
- `view.js` is the list and the words, pure: `paneRows` gives the rows, `detailOf` the file or check drawn beside them, and `headlineOf`, `blockerWords`, `failureLines`, `duration` and `ago` what is said. A failure's headline, tone and fix are one row of `FAILURES`.
- `state.js` is what a pane can be in: looking for a pull request, showing one, failed, a replay. `sceneOf` gives the pull request to draw, whichever of them has one.
- `watch.js` keeps that state current. The pane tells it where it is and what it wants read; it asks `gh`, one call at a time: what the pane handed it to run (a confirmed merge), else the poll or lookup that is due, else the steps, description and files that are wanted and missing. A poll is the list, then the steps of that list, then one landing. The colours' run of `node` goes beside that.
- `cache.js` is what a pane opens on. What any copy of the pane shows is kept in memory, so a window starts from what its pane has read, files and colours included, and its pane hands it the file and line it was at the same way (`handOver`, `takeOver`): a window's props are only the pull request and the terminal it follows, since each set of props has its own `localStorage`. That holds GitHub's own answers for the poll and the description (`pr:v2:`), which the next session reads back with `parsePr` and `parseAbout`; an entry they do not read is no copy.
- `diff.js` is one file's diff, pure. `patchRows` turns a patch into rows, each with its kind and its line number before and after. `diff.test.js` checks them against a recorded answer: the added and removed rows of each file add up to GitHub's own counts. `paintRows` puts the helper's lines on the rows only when every line is the same line: same count, kind, number and text. Colours on the wrong line would be worse than none, so one line off leaves that file plain. `wrapSpans` folds a line's spans at a width and `rowLines` counts the lines that gives, which is the row's height.
- `pierre/` is the syntax colours. `highlight.mjs` is the helper, for node and not for Herdr. It gives Pierre each file's diff under a theme whose colours only name roles (`ROLES` in `diff.js`), and prints each line as spans of role, text and whether that part changed. Its answer is the same in every theme. `colours.js` is the pane's side: `colourFiles` runs the helper, `coloursOf` reads its answer, and `colouredDiff` is a file's diff ready to draw, with the reason when it is plain. `highlight.test.js` runs the helper as the pane does, on the recorded answer, and is skipped where the package is not installed.
- `review.js` is the annotations, pure. `spotOf` names a stretch of a diff's rows and quotes them; `saveDraft`, `dropAnnotation` and `markAsked` change the annotations; `threadStretch` finds the rows one of GitHub's threads is on by its line and side; `annotatedRows` lays both among a file's lines; `stops` orders them for `h` and `l`. `review.test.js` places the threads of a recorded pull request (cli/cli#15081) on its recorded diff: each stands under the line GitHub names.
- `reading.js` is the keyboard in a diff, pure. A `Reading` is where it is and what it is in the middle of: a draft, a reply, a question Enter is to confirm. `readStep` gives the reading after a key and what is to leave the pane, and `readClick` the reading after a click.
- `send.js` is what leaves the pane of a review. `formatReview`, `formatQuestion` and `formatThread` are what the agent is sent; `agentOf` picks the terminal and refuses a shell; `sendResult` reads how `hc send` went. For GitHub, `githubLines` names a stretch of rows as GitHub does, by line and side within one hunk, `postingOf` builds the review from the annotations, and `postBlock` says why a review cannot go.
- `merge.js` is Merge. `mergeOffer` is the one reading of it: no button, a note, the button off, at rest or armed. The row is drawn from that offer and `mergePress` says what a press does to it, both pure. `confirmMerge` is the second press: it takes the function that runs `gh`, so `merge.test.js` runs it against a recorded answer and a stand-in for `gh pr merge`.
- `main.js` is the pane: its keys, commands and clicks, and what it holds of the pull request it is looking at (`look`: the selection, the folds, the reading, the Merge row), made anew when it turns to another. What it writes (a review, a reply, a resolve, a send to the agent) goes through one runner, `out`, which keeps what is on its way by pull request (`going`), so it is that pull request's and not the next one's, and nothing goes twice after a turn away and back. `draw.js` draws it.
- What all copies of the pane must agree on is in Herdr's shared state: the annotations (`pr.reviews`), and which of Description and Files are open and the list's width (`pr.view`). Herdr keeps one `localStorage` per mod and props, so a following pane, each pinned pane and the window have their own: it holds only the saved copies.
- `text.js` is a few words (`plural`, `firstLine`). `recorded.js` and `samples.js` are for the tests: the recordings, and a small diff with notes on it.

The checks follow the GitHub CLI's own rules from `gh pr checks` (`aggregate.go`, `output.go` in cli/cli). A check's state is its conclusion when completed, else its status, and the state maps to a bucket: `pass`, `fail`, `pending`, `skipping` or `cancel`. `STARTUP_FAILURE`, `STALE` and any state gh does not list count as `pending`, as in gh. Re-runs are removed as gh removes them: latest start first, then the first check per status context, or per name, workflow and event. The CI kind is the first of `fail`, `pending` and `cancel` with a check in it, else `pass`, or `none` with no checks. It counts the required checks when the PR has any, and all checks otherwise. `ci.all` always counts all of them, so an optional failure stays visible.

The CI kind does not come from GitHub's `statusCheckRollup.state`. That state stays `FAILURE` when the only failures are cancelled runs that a later run replaced.

GitHub's `mergeStateStatus` decides if an open PR can merge. `CLEAN`, `HAS_HOOKS` and `UNSTABLE` are ready. `UNSTABLE` carries gh's sentence for the checks that are not passing as a note. In the other states the blockers in `BLOCKERS` are checked in order. `rules` stands for `BLOCKED` when no other blocker explains it. `UNKNOWN` with no blocker is `unknown`.

The query returns 100 checks at most. `hidden` counts the rest from `totalCount`, and the counts leave them out.

### State table

`model.test.js` reads this table and checks each row. Frames are numbered from 1. A synthetic case is a recorded frame with the fields named changed. Every changed value is one that a recording or the gh source has.

| Case | Input | Stage | CI | Merge | Headline | Tone | Poll |
| --- | --- | --- | --- | --- | --- | --- | --- |
| No PR | `failures.json`, `gh pr view` on `main` | none | - | - | No pull request for this branch | idle | 30 s |
| PR with no checks | `survive-n-conquest-1` frame 1 | merged | none | merged | Merged | done | never |
| Empty rollup just after a push | synthetic: `survive-n-conquest-62` frame 2, `statusCheckRollup` null, `mergeable` and `mergeStateStatus` `UNKNOWN` | open | none | unknown | No checks yet | working | 30 s |
| Pending | `first-game-146` (18:02) frame 1 | open | pending | ready (Some checks are still pending) | Checks running, 24 of 25 done | working | 10 s |
| Required checks running | synthetic: `first-game-146` (18:02) frame 1, `BLOCKED`, `memory` required | open | pending (required) | blocked: checks-running | Required checks running, 0 of 1 done | working | 10 s |
| Failed required | synthetic: `first-game-66`, `OPEN`, `BLOCKED`, `e2e` required | open | fail (required) | blocked: checks-failing | 1 required check failing | blocked | 60 s |
| Failed optional, required passing | synthetic: `first-game-66`, `OPEN`, `UNSTABLE`, `verify` required | open | pass (required) | ready (Some checks were not successful) | Ready to merge | done | 60 s |
| Cancelled | synthetic: `first-game-145`, `OPEN`, `UNSTABLE`, `e2e` `CANCELLED` | open | cancel | ready (Some checks were cancelled) | 1 check cancelled | blocked | 60 s |
| All skipped | synthetic: `first-game-145`, `OPEN`, `CLEAN`, every check `SKIPPED` | open | pass | ready | Ready to merge | done | 60 s |
| Re-run that supersedes a failure | synthetic: `first-game-66`, `OPEN`, `UNSTABLE`, a later successful run of `e2e` | open | fail | ready (Some checks were not successful) | 1 check failing | blocked | 60 s |
| Merged | `first-game-145` frame 1 | merged | pass | merged | Merged | done | never |
| Merged with failed checks | `first-game-50` frame 1 | merged | fail | merged | Merged | done | never |
| Closed | synthetic: `first-game-145`, `CLOSED` | closed | pass | closed | Closed without merging | idle | never |
| Draft | synthetic: `survive-n-conquest-62` frame 2, `isDraft`, `BLOCKED` | draft | pass | blocked: draft | Draft | idle | 60 s |
| Conflicts | synthetic: `survive-n-conquest-62` frame 2, `CONFLICTING`, `DIRTY` | open | pass | blocked: conflicts | Conflicts with the base branch | blocked | 60 s |
| Behind | synthetic: `survive-n-conquest-62` frame 2, `BEHIND` | open | pass | blocked: behind | Behind the base branch | blocked | 60 s |
| Review required | synthetic: `survive-n-conquest-62` frame 2, `BLOCKED`, `REVIEW_REQUIRED` | open | pass | blocked: review-required | Waiting for review | idle | 60 s |
| Changes requested | synthetic: `survive-n-conquest-62` frame 2, `BLOCKED`, `CHANGES_REQUESTED` | open | pass | blocked: changes-requested | Changes requested | blocked | 60 s |
| Blocked by a rule | synthetic: `survive-n-conquest-62` frame 2, `BLOCKED` | open | pass | blocked: rules | Blocked by a branch rule | blocked | 60 s |
| Merge state not known | synthetic: `survive-n-conquest-62` frame 2, `UNKNOWN` | open | pass | unknown | Merge state not known yet | idle | 60 s |
| Passed and clean | `survive-n-conquest-62` frame 2 | open | pass | ready | Ready to merge | done | 60 s |
| Approved and clean | synthetic: `survive-n-conquest-62` frame 2, `APPROVED` | open | pass | ready | Ready to merge | done | 60 s |
| More than 100 checks | synthetic: `first-game-145`, `OPEN`, `CLEAN`, `totalCount` 130 | open | pass, 105 hidden | ready | Ready to merge | done | 60 s |

The poll is `nextPollDelay` for a pull request and `failureDelay` for a failure. A merged or closed PR, and a missing `gh`, login or repository wait until asked (`never` above). Offline and unknown failures back off from 15 s, doubling to 5 minutes. A rate limit waits 5 minutes. A pane that is not on screen does not poll at all, whatever the table says: `watch.js` holds that.

## Recording and replaying

The tests replay recordings of real pull requests through `parsePr` and `summarize`, and compare them with what `gh pr checks --json` reported at the same moment. `recorded.js` loads the recordings for them.

1. Record. `node mods/pr/record.js <folder> <owner/repo>...` polls every open PR with running checks and writes one JSON line per change. `--pr owner/repo#N` records one PR until it settles. Each line has the `PR_QUERY` answer with steps, and `gh pr checks` taken right after as `oracle`. `oracle.steady` is true when the PR answer did not change across the `gh pr checks` call. Only steady frames are compared.
2. Pack. `node mods/pr/pack.js <folder or file>...` writes one gzipped file per recording into `fixtures/`. It keeps only the fields the tests read, refuses any frame from a repository not on its public allow list, and fails above 1.5 MB.
3. Capture the failures. `node mods/pr/capture.js <owner/repo#N>` runs gh where each failure happens and writes `fixtures/failures.json`. It also writes `fixtures/live.json`, a live poll without steps and two `STEPS_QUERY` answers for that PR.
4. The description and the files have one recorded answer each per pull request, as `gh` printed them for `aboutArgs` and `filesArgs`: `fixtures/about-<repo>-<number>.json` and `files-<repo>-<number>.json`. Those of cli/cli#15081 are another project's public pull request, kept for its six review threads.
5. Test. Run `npm test` at the repository root. To compare more recordings without committing them, set `PR_FIXTURES_EXTRA` to their folder: `PR_FIXTURES_EXTRA=/path/to/recordings npm test`. That folder can hold `.jsonl` or `.jsonl.gz` files.

`failures.json` marks each sample as seen or assumed. These were seen from gh 2.102.1:

- `no-repo`: a folder outside git, a repository with no remote, and a remote that is not a GitHub host.
- `no-pr`: the default branch, a detached HEAD, and a PR number that does not exist.
- `no-auth`: an empty `GH_CONFIG_DIR` (gh exits 4), and a token GitHub rejects.
- `offline`: `HTTPS_PROXY` at a closed port, and a network namespace with no network.

These are assumed and not seen:

- `rate-limited`: GitHub's primary and secondary limit messages.
- `no-gh`: Herdr's rejection text for a program it cannot start, taken from what `mods/tuido/README.md` quotes.
- A timed-out `exec`, which `classifyRejection` reads as `offline`.
