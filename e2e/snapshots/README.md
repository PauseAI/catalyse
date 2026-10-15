# Visual snapshots

`npm run snapshots` runs the E2E suite with every test photographed, and
writes a gallery that puts each picture beside the one the previous run took,
with the changed pixels picked out in red. Use it for what an assertion can't
see: a layout that broke, a button that lost its colour, a dialog that opens
under the header. It complements `npm run test:e2e` without replacing it, and
a plain test run captures nothing.

## Run it

```sh
npm run snapshots
```

The command builds the app once, then runs the Playwright suite once per
lane with `SNAPSHOTS=1`, every lane at once, each as a process of its own.
The machine sets how many servers open in all (one per two cores, at most
six; `SNAPSHOT_WORKERS` overrides it) and the lanes share them out, so a full
run is four lanes with a worker each and a single lane has every server to
itself. A lane's process, servers and database schemas are its own, so its
worker pool never mixes with another lane's and a lane only ever shares a
database with itself. Open
`snapshots/index.html` while it works and watch it fill in; each new frame
lands beside the image it replaces, and the page reloads itself every few
seconds until the run is done. `npm run snapshots -- --help` lists the flags.

Anything after `--` that the script doesn't recognise goes to Playwright, so a
run narrows the usual way while you iterate on one screen:

```sh
npm run snapshots -- e2e/tests/11-dashboard.spec.ts                # one spec file
npm run snapshots -- --grep "marks all notifications as read"      # one test, by its title
npm run snapshots -- --project=desktop-light                       # one lane
npm run snapshots -- --project=mobile-dark e2e/tests/11-dashboard.spec.ts   # combined
```

A narrowed run regenerates only the matching pictures. The gallery still shows
every other row from the last full run, marked **carried**, with a caption
naming each picture's build, so a partial run's page never reads as a full one.

## What gets photographed

Every test takes a final frame without being asked: when a test ends, the
last page each of its `adminPage` and `volunteer` contexts was looking at is
captured as `end (admin)` or `end (volunteer)`. That is the screen the test's
assertions just passed on, which is the one worth keeping.

For a moment in the middle of a flow, the `snap` fixture takes a picture under
a label of your choosing:

```ts
test('Owner edits a task', async ({ volunteer, snap }) => {
  await openTaskDialog(volunteer.page)
  await snap(volunteer.page, 'edit dialog open')
  ...
})
```

`snap` does nothing in a plain test run. Pick labels that name the state, not
the step: "validation errors shown", not "after clicking save".

A context a test opens for itself takes part the same way: every context the
worker's browser opens during a snapshot run is prepared for the lane, and
shoots its last page as it closes, labelled `end`. The fixtures that know
whose context it is name the frame through `snapshots.role`.

## Determinism

A diff only means something when the same code makes the same picture, so the
run holds still everything it can:

- **Fake data is seeded per test** from the test's title (`seedFake` in
  `e2e/fake.ts`), so the same test always makes the same people and projects.
  The names still read as real names; only their choice is fixed.
- **A worker takes whole spec files.** A file's tests run in order against
  a database only its own tests and its worker-mates' have touched, and which
  worker a file lands on is fixed for a given set of files. A page that lists
  what other tests made can still differ when a spec is added or removed, so
  a test asserts on, and photographs, what it made itself.
- **Dates are rewritten in the rendered text** to one fixed date just before
  the shot (`normaliseDates` in `capture.ts`). Records are created by the test
  seconds before they are photographed, so what a page shows is the wall
  clock, and nothing else about the run can pin that.
- **The page has to hold still** before it is shot: the runner polls the whole
  frame until it has stayed identical for a hold window across several painted
  frames, then waits for fonts. A page still moving after the cap is captured
  anyway and reported as **unsettled** at the end.
- The caret, scrollbars, transitions, animations and the spell checker's
  underline are switched off by a stylesheet every page gets, and
  `Math.random` is seeded.

## Reading the gallery

A row is one capture, and the **viewport** and **theme** switches pick which
lane's pictures it shows; a row with no picture in that lane says so, and
names the lanes where it changed. The page opens on the rows this run
captured; a checkbox adds the rest of the suite from earlier runs, another
keeps only what changed, and the search box filters by spec, test or label.
The rail lists each spec folded; the one whose row is on screen unfolds as
you scroll, and one you open yourself stays open. A spec or test carries a
mark only when a capture changed, failed or never settled. A first capture,
with nothing to compare against, is marked **New** on its row and nowhere
else. The switches and checkboxes are remembered between runs.

Each row is marked changed or same from a pixel-by-pixel comparison of the two
images. It ignores a per-channel difference of a few levels, which is font
rasterisation and PNG re-encoding noise, and what remains must pass a
magnitude test as well as a pixel count: only a total channel delta above
`NOISE_TOTAL_DELTA` counts as changed, with an area backstop at
`WIDE_CHANGE_DIFF_PX` (both in `png.ts`). A changed row shows the pixel count
and a **diff** image with those pixels in red. An unchanged row whose diff
wasn't empty says `Same · ±Npx noise` and still renders its diff, so nothing
below the bar hides.

A test that fails is badged **test failed** with the error on hover, and the
page it gave up on is shown as **Where it gave up**. That frame is a diagnosis,
never a baseline: it lives in `failures/`, stays out of the rotation, and is
replaced the next time the test runs.

## Compare against a git ref

Checking uncommitted changes against a known ref takes two runs. `--against`
captures the ref alone and says nothing about your changes:

```sh
npm run snapshots -- --against=main   # capture main, pin it as the baseline
npm run snapshots                     # capture your tree, diff against the pin
```

The first run creates a git worktree under the repo's ignored `tmp/`, hard
links `node_modules` into it and copies the env files, so it never touches
your working tree and never reinstalls anything. It captures the ref there, copies
the pictures into `previous/`, writes `baseline.json` and removes the
worktree. With a baseline pinned, every plain run leaves `previous/` alone and
diffs fresh captures against it, so you can keep editing and re-running. The
gallery banners the pin and captions each baseline picture with its ref.

```sh
npm run snapshots -- --clear-baseline
```

## Rebuild the page without a run

```sh
npm run snapshots -- --render
```

Builds `snapshots/index.html` from the newest complete run of each lane on
disk, so lanes captured in separate runs still come together on one page.

## The generated directory

Git ignores `snapshots/`.

```text
snapshots/
  index.html
  baseline.json   # only while --against has a ref pinned
  history-<lane>.json  # per-picture timeline of (sha, capturedAt, ref), one per lane
  runs/           # one manifest per run
  current/        # each PNG and its .json sidecar
  previous/       # what the last run replaced, or the pinned baseline
  staging/        # only while a run is capturing
  diffs/          # changed pixels in red, for changed rows
  failures/       # the page a failed test gave up on; never a baseline
  pool/           # content-addressed PNGs, shared across runs
```

A run captures into `staging/`, and the frames only move into place once the
run reaches its end: `current/` steps back to `previous/`, `staging/` becomes
`current/`. Kill a run part-way and the last complete run's images stay
exactly as they were.

Every run writes `runs/<runId>.json` before capturing anything and updates it
as each test finishes, recording the commit, whether the tree was dirty, the
arguments that narrowed it, and what became of each test. A manifest still
saying `running` marks a killed run. `manifest.json` at the root is a copy of
the last one to finish.

A test that fails keeps its pictures out of `current/`: they show on the
gallery for that run, badged, and the last good picture stays as the next
run's baseline.

**Compare with the sidecar, never by hashing the PNG.** Run unchanged code
twice and the bytes can still differ while every pixel stays put. Read
`diffPixels` and `diff` from each capture's `.json` instead; `CaptureMeta` in
`config.ts` and `DiffAnalysis` in `png.ts` define every field.

## How it fits together

- `config.ts`: the lanes, the paths and how a capture is named. The fixtures,
  the reporter and the CLI all import it, so they agree on a file name without
  talking to each other.
- `capture.ts`: what happens in the worker when a picture is taken.
- `reporter.ts`: a Playwright reporter that plans the run, diffs and files each
  staged capture as its test ends, rotates the directories at the end and
  rebuilds the gallery as it goes.
- `rows.ts`: reads the rows the page shows back off the disk layout.
- `gallery.ts`: renders the page from those rows.
- `png.ts`: the decoder, the diff and the pool, with no Playwright in them.
- `runs.ts`: the manifest.
- `scripts/snapshots.ts`: the command, the `--against` worktree, and `--render`.
