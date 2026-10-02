/**
 * Authoring instructions for the project import file.
 *
 * Two halves, split by what can go stale. The JSON Schema is *generated* from the same zod
 * schema the importer validates against, so it cannot drift. The prose covers only what a
 * schema cannot say — how a row is identified, what omitting a field means, how deletion
 * works — and is pinned by tests that feed its examples through the real parser.
 */

import { z } from 'zod'
import { ProjectImportFileSchema } from './project-porting'

/** The import file's JSON Schema, derived from the validator itself. */
export function projectImportJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(ProjectImportFileSchema, { io: 'input' }) as Record<string, unknown>
}

/**
 * A worked example, kept here rather than inline in the prose so a test can parse this exact
 * object and fail if the format moves under it.
 */
export const PROJECT_IMPORT_EXAMPLE = {
  _meta: {
    format: 'catalyse-project-export',
    version: 1,
    projectId: 42,
    baseHash: 'sha256:…copied from your export…',
  },
  project: {
    id: 42,
    title: 'Launch rally',
    status: 'in_progress',
  },
  tasks: [
    {
      id: 101,
      title: 'Book the venue',
      startDate: '2026-09-02',
      durationDays: 3,
    },
    {
      ref: 'permit',
      title: 'Apply for the permit',
      durationDays: 8,
      dependsOn: [{ on: 101, lagDays: 2 }],
    },
    {
      ref: 'rally',
      title: 'The rally itself',
      durationDays: 0,
      isAnchor: true,
      dependsOn: [{ on: 'permit' }],
    },
  ],
} as const

/**
 * The prose half. Written as a prompt: it is copied wholesale into an assistant alongside the
 * file, so it addresses the assistant directly and leads with the rules that are most often
 * got wrong.
 */
export const PROJECT_IMPORT_GUIDE = `# Editing a Catalyse project import file

You are editing a JSON file that describes one project and its tasks. It will be uploaded
back to Catalyse, which shows the human a diff before anything is written. Produce the whole
file, valid JSON, with no commentary outside it.

## Identity — the rule most often got wrong

- A task with an \`id\` **updates** the existing task with that id. Keep the id exactly as it
  came out of the export; never invent one.
- A task with no \`id\` is **created**. Give it a \`ref\` (any short string, unique within the
  file) so other tasks can depend on it.
- \`ref\` is a label used only inside this file. It is never stored, and it is not an id.
- Tasks are matched by \`id\` alone. Titles are *not* used to match, so renaming a task is an
  ordinary edit, but dropping its \`id\` silently turns that edit into "delete and recreate".

## Deleting

A task that exists in the project but is **absent from the file** is treated as a deletion.
The importer lists these separately and only removes the ones the human ticks. If you did not
mean to delete something, keep its entry.

## Omitting versus clearing

- Leave a field out to mean *not specified*: an existing task keeps its current value.
- Write \`null\` to **clear** a value explicitly.
- \`dependsOn\` left out leaves that task's existing links alone. \`"dependsOn": []\` removes
  all of them.

## Fields

Project: \`id\`, \`title\` (required), \`description\`.

\`status\` is **read-only here**. Leave it exactly as the export wrote it — one of \`draft\`,
\`pending_review\`, \`needs_discussion\`, \`ready\`, \`in_progress\`, \`on_hold\`,
\`completed\`, \`archived\`. Changing it is refused, because moving a project through its
lifecycle is a decision with review rules attached, not a file edit. It is changed on the
project page instead.

Task: \`id\`, \`ref\`, \`title\` (required), \`description\`, \`status\` (\`open\`,
\`in_progress\`, \`completed\`), \`assigneeEmail\`, \`deadline\`, \`startDate\`,
\`durationDays\`, \`featuredAsQuickTask\`, \`isAnchor\`, \`timing\`, \`dependsOn\`.

- Dates are \`YYYY-MM-DD\` strings. Any other format is rejected.
- A file may carry at most 1000 tasks, each with at most 100 \`dependsOn\` entries. Titles cap
  at 300 characters and descriptions at 20,000.
- \`durationDays\` is elapsed calendar days, 0 to 3650. **0 means a milestone** — a moment
  rather than a stretch of work. It is not the same as leaving it out.
- \`startDate\` *pins* a task to that date. A task with no \`startDate\` starts when its
  dependencies allow, which is usually what you want for anything downstream.
- \`assigneeEmail\` must belong to an existing approved volunteer, or the import is rejected.
- \`isAnchor\` marks the fixed point the plan is built around — an event date, a deadline. The
  critical path is measured towards anchors, so work that merely follows one is correctly
  shown as having slack. Usually there is exactly one.
- \`timing\` is \`flexible\` (the default: the work happens any time between the start and the
  end) or \`fixed\` (it happens on exactly those dates, like a shift or the event itself).

## Dependencies

\`dependsOn\` lists what must finish first:

\`\`\`json
"dependsOn": [{ "on": 101, "lagDays": 2 }, { "on": "permit" }]
\`\`\`

- \`on\` is either the numeric \`id\` of an existing task in this project, or the \`ref\` of a
  task defined anywhere in this file.
- \`lagDays\` is optional and signed, -365 to 365. Positive leaves a gap after the predecessor
  finishes; negative overlaps them. Omit it for "starts the next day".
- Links are finish-to-start only, and cycles are rejected with the loop named.

## \`$schema\` and \`_meta\`

\`_meta.baseHash\` records what the project looked like when it was exported. If the project
has changed since, the import is refused and the human must export again. So:

- Keep \`_meta\` and \`$schema\` exactly as you found them. Do not recompute or remove
  \`baseHash\`.
- Do not write one of these files from scratch, and do not reuse an old export after the
  project has moved on. Always start from a fresh export.

\`$schema\` is a link to this file's JSON Schema, which editors use to validate it as you
type. The importer ignores it. Fetch it if you can — it is generated from the same definition
the importer validates against, so it is always current.

## Example

\`\`\`json
${JSON.stringify(PROJECT_IMPORT_EXAMPLE, null, 2)}
\`\`\`

That file updates task 101 in place, creates two new tasks, makes the permit wait two days
after the booking finishes, and marks the rally as a zero-day anchor that follows the permit.
`
