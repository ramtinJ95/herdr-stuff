# PR pane: internals

How the mod is built and tested. To use it, read the [README](../README.md).

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

## Replay

`props: { "replay": "/path/frame.json" }` draws one recorded answer instead of asking GitHub, with Merge off. The screenshots of each state were made with it.

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
