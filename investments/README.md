# Investments

Work that makes the repo easier to change, safer to run, or quicker to work on, as opposed to work on what Catalyse does for people. Each file here is one piece of it. They come in three kinds:

- **Architecture:** large refactors that change how a whole area is built, so that a kind of change that now touches ten files touches one. They take a week or more, and are done a step at a time.
- **Operations:** what keeps the live app working and tells us when it isn't. Examples: error reporting, alerts when a scheduled job stops, checks that stop a bad deploy.
- **Small fixes:** a wrong default, a missing helper, a note in the wrong place. Each takes an hour or two, and is easiest done in passing by whoever is working nearby.

Two more kinds sit alongside them: **tools** agents keep rebuilding for themselves, and changes to **ways of working**.

This isn't the issue tracker. A bug or feature in the product belongs in a GitHub issue. An item here is about the work itself: something in the code structure, tooling, tests, docs or diagnostics that made a task slower or more confusing than it needed to be, and will again.

## Logging a hit

When one of these costs you time, add a line under "Hits" in its file, saying when, what happened and, if you know, how long it cost:

```markdown
- 2026-11-12: e2e `09` failed under check-all and passed 8/8 alone, one extra run, ~10 min
- Week of 2026-11-09 (x3): sessions stripped `schema_migrations` from a new migration by hand
```

`(x3)` counts as three hits, for a line that sums up several. Log a hit only where the item's fix, had it been made, would have prevented what you hit. If no file fits, start one from the template at the end, however much it resembles one already here: a resemblance isn't a recurrence.

Log a hit when you:

- write a script in `tmp/` that you'd want again
- make the same edit in three or more places for one change
- meet a flaky test (and fix it, as `AGENTS.md` says under "Flaky tests")
- run `check-all` again for a failure your change didn't cause
- find a bug that the design made easy to write
- have to ask a maintainer something the docs should have said
- work around a tool, check or rule

The repo is public. A hit names no one and quotes no data, and says nothing about how you used production services or the database.

## Picking the next one

`npm run investments` lists every item, most hits first, with its size and kind. It writes the same list to `investments/ranked.txt`, which isn't committed, and ends by naming that file. Each line starts with the item's file name, so an editor can open it (`gf` in Vim). There's no list kept by hand: the files are the list.

Hits are a guide, not the answer, as each kind collects them differently:

- A missing tool is hit in every session, so tools pile up hits fast.
- An architecture item is hit once per feature that runs into it, and each of those hits can cost hours.
- An operations item gets no hits until the day something goes wrong unseen.

So weigh hits against size. Weigh an architecture item by the changes it would make easy, and an operations item by how bad the failure it prevents would be.

Once a month, add the month's hits and choose what's next.

About one PR in five should be one of these, each in its own PR. The PR that finishes an item deletes its file. An architecture item done in steps keeps its file until the last step, and its Fix says what's left.

## Template

```markdown
# Title

Size: S, M or L. Kind: architecture, operations, small fix, tools or ways of working.

## Problem

What's wrong, where, and the facts that show it.

## Fix

What to change, and in what order if it takes several steps.

## Hits

None yet.
```

S is under a day, M a few days, L a week or more.
