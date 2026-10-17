# Component audit: Task vs. Project, and volunteer previews

Written alongside the Storybook stories added in this branch, for issue #92 (component viewer)
and bug report #56 (UI consistencies). This is a cataloguing pass only — it names what looks like
a true duplicate versus what only looks similar, so the merge decision can be made deliberately in
a follow-on branch. Nothing here has been refactored.

## Task vs. Project: the real site of duplication

A Task, a Quick Task and a Project are all a `WorkItem` under the hood, but today they render
through separate trees:

- **The list/summary view is already shared for two of the three.** `WorkItemCard`
  (`components/WorkItemCard.tsx`) draws one row for either a Task or a Quick Task from the same
  `WorkItemSummary` shape — see `WorkItem comparison/WorkItemCard (Task row)` in the viewer.
  `ProjectCard` (`components/ProjectCard.tsx`) is a second, separate component for a Project's
  card, built from its own `Project` type. **True duplicate candidate**: both show a title, a
  status badge and a lateness badge, and could plausibly share a summary shape the way Task and
  Quick Task already do — but `ProjectCard` also shows owner, location, team, skills and a match
  grade that `WorkItemCard` has nothing like, so unifying them is a real design question, not a
  mechanical merge.

- **The detail-page header is one shared component, fed two different ways.** Both
  `app/projects/[id]/tasks/[taskId]/page.tsx` (Task) and `app/projects/[id]/page.tsx` (Project)
  build their header by calling the _same_ `WorkItemHeader` (`components/WorkItemHeader.tsx`) with
  hand-assembled `person`/`status`/`actions` JSX, rather than through any shared "work item detail"
  component. See `WorkItem comparison/WorkItemHeader (Task vs Project detail)` for both, rebuilt
  side by side from each page's real composition:
  - **Cosmetic, by design**: the Project header has `tabs` (Overview/Tasks/Timeline/People) and a
    `subtitle` (location/team); the Task header has neither. A task is a single page, a project
    has sections — this difference should stay.
  - **Not cosmetic — a real inconsistency**: the Task header's status group includes a
    `LatenessBadge`; the Project header's does not, even though `ProjectCard` (the same project,
    on the projects list) _does_ show a `LatenessBadge` for it. A project can read "3 days late"
    on the projects list and show nothing about lateness on its own page. Worth fixing on its own,
    independent of any larger merge.
  - Both pages also separately call `lateness()` (`lib/lateness.ts`) for this purpose — the Task
    page's status block does; the Project page's does not, which is the same gap from the other
    direction.

- **Assigning a person is two different components for the same job.** The Project page assigns
  an owner with `MemberPicker` (`components/ui/MemberPicker.tsx`, filters a list the caller already
  fetched); the Task page reassigns an assignee with `VolunteerSelect` (`components/VolunteerSelect.tsx`,
  does its own server-side search). See `Volunteer previews/Picker (MemberPicker)` and
  `Volunteer previews/Picker (VolunteerSelect)`. **Candidate to unify**, but note they're solving
  slightly different problems (a short list already in hand vs. searching the whole volunteer
  base) — the merge should probably standardise on `VolunteerSelect`'s approach and drop
  `MemberPicker`, not the other way round, since the volunteer base is the one that grows.

## Volunteer previews: four different renderings of "a volunteer"

- **`PersonChip`** (`components/ui/PersonChip.tsx`) is the one genuinely reusable component:
  initials circle + name, optional link, optional "(you)", optional remove button. Used for a
  task's assignee, a project's owner, and project interest/helper rows.
- **`WorkRow`'s `PersonAvatar`** (`components/WorkRow.tsx`) is a _third_ rendering built on the
  same `initials()` helper as `PersonChip`, but drawn as initials-only with a tooltip for the name
  — a deliberate space trade-off for a dense task list, not an oversight. See
  `Volunteer previews/WorkRow (PersonAvatar)`, including an "AvatarVsChip" story with both next to
  each other. **Cosmetic, not a duplicate** — don't merge these.
- **The volunteer directory card** (`app/volunteers/page.tsx`) and **`ProjectCard`**
  (`components/ProjectCard.tsx`) are structurally near-identical: same grid classes, the same
  skill-pill markup and "and N more" overflow pattern, the same 📍-location-line pattern — but
  neither uses `PersonChip`/`PersonInitials` at all; both are hand-rolled `<div>` markup. **True
  duplicate candidate**, and the strongest one in this audit: this looks like one card pattern
  that was written twice rather than two things that happen to look alike. Not reproduced as a
  story here (there's no component to import — that's the finding), but worth reading side by
  side in the page source before deciding how to extract it.
- **The admin team member row** (`app/admin/teams/[id]/page.tsx`) is a fourth, visually plainer
  treatment: name/email/role badge/buttons in a plain `<div>`, no avatar or initials at all.
  Whether this should pick up `PersonChip` or stay plain (it's an admin table row, not a social
  card) is a product call, not just a merge.

## Everything else in the viewer

The remaining stories (`Atoms/*`) are single-purpose primitives — `Badge`, `StatusBadges`,
`Button`, `Checkbox`/`Radio`/`Toggle`, `Modal`/`ConfirmDialog`, `Tabs`, `Tooltip`, `Skeleton`,
`EmptyState` — included as a representative sample of the rest of the component library, not
because they show any duplication. They're a reasonable starting point for whoever adds more
stories later.

## What this pass deliberately didn't do

- No component was extracted, renamed or changed. Every story composes existing components with
  new mock data; where no shared component exists yet (the directory card vs. `ProjectCard`), the
  finding is written up here instead of faked into a story.
- No merge decision is made here. "True duplicate candidate" means it's worth a deliberate look in
  the follow-on branch, not that it should definitely be merged.
