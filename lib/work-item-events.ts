import type { Prisma } from '@/generated/prisma/client'
import { WorkItemType } from '@/generated/prisma/enums'
import { formatDateShort } from './format-date'
import { prisma } from './prisma'
import { plural } from './plural'
import { projectStatusLabel } from './project-status'
import { QUICK_TASK_STATUS_LABELS, TASK_STATUS_LABELS } from './status-labels'

/**
 * What a change to a work item was. `edited` and `status` are worded from the fields that
 * changed; the others name the action, which the fields alone would not tell apart.
 */
export type EventKind =
  | 'edited'
  | 'status'
  | 'started'
  | 'claimed'
  | 'requested'
  | 'assigned'
  | 'released'
  | 'submitted'
  | 'accepted'
  | 'changes_requested'
  | 'reopened'
  | 'replanned'
  | 'rescheduled'
  | 'baseline'
  | 'dependency_added'
  | 'dependency_removed'
  | 'dependency_lag'
  | 'helper_joined'
  | 'helper_left'
  | 'helper_removed'
  | 'helper_added'

export type EventValues = Prisma.InputJsonObject

/** The columns an event records. Bookkeeping (updatedAt, nudges, claimedAt) is left out. */
const TRACKED_FIELDS = [
  'status',
  'assigneeId',
  'requestedById',
  'title',
  'description',
  'deadline',
  'startDate',
  'durationDays',
  'estimatedHours',
  'isAnchor',
  'timing',
  'featuredAsQuickTask',
  'submissionPrompt',
  'submissionAsksLink',
  'helpersWanted',
  'submissionNote',
  'submissionUrl',
  'changesRequestedNote',
  'reviewRating',
  'reviewNotes',
  'skillId',
  'projectType',
  'estimatedDuration',
  'urgency',
  'collaborationLink',
  'nationalChapterId',
  'reach',
  'localGroupId',
  'outcome',
  'outcomeNotes',
  'teamId',
  'timeCommitmentHoursPerWeek',
  'isSeekingHelp',
  'autoAcceptTasks',
  'baselineStartDate',
  'baselineDurationDays',
  'startedAt',
  'completedAt',
] as const

function toJson(value: unknown): Prisma.InputJsonValue | null {
  if (value === undefined || value === null) return null
  if (value instanceof Date) return value.toISOString()
  return value as Prisma.InputJsonValue
}

/**
 * The tracked fields `data` changes on `row`, as they were and as they become. Fields `data`
 * leaves alone, or sets to what they already were, are not included.
 */
export function workItemChanges(
  row: object,
  data: Record<string, unknown>,
): { before: EventValues; after: EventValues } {
  const current = row as Record<string, unknown>
  const before: Record<string, Prisma.InputJsonValue | null> = {}
  const after: Record<string, Prisma.InputJsonValue | null> = {}
  for (const field of TRACKED_FIELDS) {
    if (data[field] === undefined) continue
    const was = toJson(current[field])
    const now = toJson(data[field])
    if (was === now) continue
    before[field] = was
    after[field] = now
  }
  return { before, after }
}

/** The kind of an ordinary edit, from what it changed and who made it. */
export function editKind(
  changes: { before: EventValues; after: EventValues },
  actorId: number | null,
): EventKind {
  const { before, after } = changes
  if ('assigneeId' in after) {
    if (after.assigneeId === null) return 'released'
    if (after.assigneeId === actorId && before.assigneeId === null) return 'claimed'
    return 'assigned'
  }
  const fields = Object.keys(after).filter((f) => f !== 'startedAt' && f !== 'completedAt')
  if (fields.length === 1 && fields[0] === 'status') return 'status'
  return 'edited'
}

type Tx = Prisma.TransactionClient

/**
 * Records one change to a work item. The only writer of WorkItemEvent: call it inside the
 * transaction that makes the change, so a write that fails leaves no event behind.
 */
export async function recordEvent(
  tx: Tx,
  event: {
    workItemId: number
    actorId: number | null
    kind: EventKind
    before: EventValues
    after: EventValues
  },
): Promise<void> {
  await tx.workItemEvent.create({ data: event })
}

/**
 * Records what writing `data` over `row` changes, under `kind` (or the kind editKind gives).
 * Records nothing when nothing tracked changes. `extra` joins `after` as context rather than a
 * column, such as `asDeputy` for a deputy acting as a manager.
 */
export async function recordChange(
  tx: Tx,
  change: {
    row: { id: number }
    data: Record<string, unknown>
    actorId: number | null
    kind?: EventKind
    extra?: EventValues
  },
): Promise<void> {
  const { before, after } = workItemChanges(change.row, change.data)
  if (Object.keys(after).length === 0) return
  await recordEvent(tx, {
    workItemId: change.row.id,
    actorId: change.actorId,
    kind: change.kind ?? editKind({ before, after }, change.actorId),
    before,
    after: { ...after, ...change.extra },
  })
}

/** Writes `data` to one work item and records the change, in one transaction. */
export async function updateWorkItem(
  row: { id: number },
  data: Record<string, unknown>,
  event: { actorId: number | null; kind?: EventKind; extra?: EventValues },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.workItem.update({ where: { id: row.id }, data })
    await recordChange(tx, { row, data, ...event })
  })
}

// ── Wording ─────────────────────────────────────────────────────────────────────────────

export interface EventToDescribe {
  kind: string
  actorId: number | null
  actorName: string | null
  before: unknown
  after: unknown
}

type Values = Record<string, unknown>

/** People an event names besides its actor, so their names can be loaded with it. */
export function eventPersonIds(events: { before: unknown; after: unknown }[]): number[] {
  const ids = new Set<number>()
  for (const e of events) {
    for (const values of [e.before as Values, e.after as Values]) {
      for (const field of ['assigneeId', 'requestedById', 'helperId']) {
        if (typeof values[field] === 'number') ids.add(values[field])
      }
    }
  }
  return [...ids]
}

function statusLabel(itemType: string, status: string): string {
  if (itemType === WorkItemType.PROJECT) return projectStatusLabel(status)
  const labels =
    itemType === WorkItemType.QUICK_TASK ? QUICK_TASK_STATUS_LABELS : TASK_STATUS_LABELS
  return labels[status] ?? status
}

function day(value: unknown): string {
  return formatDateShort(new Date(value as string))
}

/** "a", "a and b", "a, b and c". */
function listOf(parts: string[]): string {
  return parts.length < 2
    ? parts.join('')
    : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/** What a changed field is called in "changed the …". Fields absent here go unmentioned. */
const FIELD_NAMES: Record<string, string> = {
  description: 'description',
  durationDays: 'length',
  estimatedHours: 'effort',
  timing: 'timing',
  featuredAsQuickTask: 'quick tasks listing',
  submissionPrompt: 'submission box',
  submissionAsksLink: 'submission box',
  helpersWanted: 'helpers wanted',
  skillId: 'skill',
  projectType: 'project type',
  estimatedDuration: 'estimated duration',
  urgency: 'urgency',
  collaborationLink: 'collaboration link',
  nationalChapterId: 'chapter',
  reach: 'location',
  localGroupId: 'location',
  outcome: 'outcome',
  outcomeNotes: 'outcome',
  teamId: 'team',
  timeCommitmentHoursPerWeek: 'time commitment',
  isSeekingHelp: 'call for helpers',
  autoAcceptTasks: 'review setting',
}

const DATE_FIELDS: [string, string][] = [
  ['startDate', 'start'],
  ['deadline', 'deadline'],
]

/** The changes an edit made, each as a phrase: "moved this to Done", "changed the effort". */
function changePhrases(
  itemType: string,
  before: Values,
  after: Values,
  nameOf: (id: number) => string,
): string[] {
  const phrases: string[] = []
  if ('assigneeId' in after) {
    const isProject = itemType === WorkItemType.PROJECT
    if (after.assigneeId === null) {
      const who = nameOf(before.assigneeId as number)
      phrases.push(isProject ? `removed ${who} as owner` : `unassigned ${who}`)
    } else {
      const who = nameOf(after.assigneeId as number)
      phrases.push(isProject ? `made ${who} the owner` : `assigned this to ${who}`)
    }
  }
  if ('status' in after) {
    phrases.push(`moved this to ${statusLabel(itemType, after.status as string)}`)
  }
  if ('title' in after) phrases.push(`renamed this '${after.title as string}'`)
  if ('isAnchor' in after) {
    phrases.push(after.isAnchor ? 'made this a key date' : 'took the key date off this')
  }
  for (const [field, name] of DATE_FIELDS) {
    if (!(field in after)) continue
    phrases.push(after[field] ? `set the ${name} to ${day(after[field])}` : `cleared the ${name}`)
  }
  const changed = new Set<string>()
  for (const field of Object.keys(after)) {
    if (FIELD_NAMES[field]) changed.add(FIELD_NAMES[field])
  }
  if (changed.size > 0) phrases.push(`changed the ${listOf([...changed])}`)
  return phrases
}

function releasedSentence(
  actor: string,
  actorId: number | null,
  before: Values,
  nameOf: (id: number) => string,
): string {
  if (typeof before.assigneeId === 'number') {
    if (actorId === null) return `${nameOf(before.assigneeId)} was taken off this after no updates`
    if (actorId === before.assigneeId) return `${actor} released this`
    return `${actor} unassigned ${nameOf(before.assigneeId)}`
  }
  if (typeof before.requestedById === 'number') {
    return actorId === before.requestedById
      ? `${actor} withdrew their request to take this`
      : `${actor} turned down ${nameOf(before.requestedById)}'s request to take this`
  }
  return `${actor} released this`
}

/** A link's lag: a gap after the task waited on, or a negative one, an overlap with it. */
function gapPhrase(lagDays: number, predecessor: string): string {
  if (lagDays < 0) return `let this overlap '${predecessor}' by ${plural(-lagDays, 'day')}`
  return `set a gap of ${plural(lagDays, 'day')} after '${predecessor}'`
}

/**
 * One event as a line in the Discussion: "Sam moved this to Done". `nameOf` names the people
 * the event refers to (see eventPersonIds); `itemType` picks the status wording.
 */
export function describeEvent(
  event: EventToDescribe,
  itemType: string,
  nameOf: (id: number) => string,
): string {
  const before = event.before as Values
  const after = event.after as Values
  const actor = `${event.actorName ?? 'Someone'}${after.asDeputy ? ' (deputy)' : ''}`
  switch (event.kind) {
    case 'started':
      return `${actor} started this`
    case 'claimed':
      return itemType === WorkItemType.PROJECT
        ? `${actor} became the owner`
        : `${actor} claimed this`
    case 'requested':
      return `${actor} asked to take this`
    case 'released':
      return releasedSentence(actor, event.actorId, before, nameOf)
    case 'submitted':
      return after.status === 'completed'
        ? `${actor} submitted this and it is Done`
        : `${actor} submitted this for review`
    case 'accepted':
      return `${actor} accepted this as Done`
    case 'changes_requested':
      return `${actor} asked for changes`
    case 'reopened':
      return `${actor} reopened this`
    case 'replanned':
      return `${actor} replanned this to finish ${day(after.finish)}: ${after.reason as string}`
    case 'baseline':
      return `${actor} saved the current dates as the plan`
    case 'dependency_added': {
      const title = after.predecessorTitle as string
      const lag = after.lagDays as number
      const gap = lag ? `, and ${gapPhrase(lag, title)}` : ''
      return `${actor} made this wait on '${title}'${gap}`
    }
    case 'dependency_removed':
      return `${actor} stopped this waiting on '${before.predecessorTitle as string}'`
    case 'dependency_lag':
      return after.lagDays === 0
        ? `${actor} removed the gap after '${after.predecessorTitle as string}'`
        : `${actor} ${gapPhrase(after.lagDays as number, after.predecessorTitle as string)}`
    case 'helper_joined':
      return `${actor} joined as a helper`
    case 'helper_left':
      return `${actor} stopped helping`
    case 'helper_removed':
      return `${actor} took ${nameOf(after.helperId as number)} off the helpers`
    case 'helper_added':
      return `${actor} added ${nameOf(after.helperId as number)} as a helper`
    default: {
      const phrases = changePhrases(itemType, before, after, nameOf)
      return phrases.length > 0 ? `${actor} ${listOf(phrases)}` : `${actor} changed this`
    }
  }
}
