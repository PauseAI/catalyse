import { prisma } from './prisma'
import type { DigestSchedule } from './notification-digest'
import { effectiveTimeZone, type TimeZoneSource } from './time-zone'
import type { Prisma } from '@/generated/prisma/client'
import {
  defaultDelivery,
  isFixed,
  isKnownType,
  type Delivery,
  type Recipient,
  type Role,
} from './notification-types'

/** What `volunteerId` has chosen, by type. */
export async function chosenDeliveries(volunteerId: number): Promise<Map<string, Delivery>> {
  const rows = await prisma.notificationPreference.findMany({
    where: { volunteerId },
    select: { type: true, delivery: true },
  })
  return new Map(rows.map((r) => [r.type, r.delivery]))
}

/**
 * Saves choices for the given types: a choice equal to the type's default is stored as no choice,
 * so the person follows the default if it changes. Types left out keep what they had.
 */
export async function saveDeliveries(
  tx: Prisma.TransactionClient,
  volunteerId: number,
  who: Recipient,
  choices: Record<string, Delivery>,
): Promise<void> {
  const entries = Object.entries(choices)
  await tx.notificationPreference.deleteMany({
    where: { volunteerId, type: { in: entries.map(([type]) => type) } },
  })
  await tx.notificationPreference.createMany({
    data: entries
      .filter(([type, delivery]) => delivery !== defaultDelivery(type, who))
      .map(([type, delivery]) => ({ volunteerId, type, delivery })),
  })
}

/** The types in `choices` that cannot be chosen: unknown, or fixed. */
export function unchoosableTypes(choices: Record<string, Delivery>): string[] {
  return Object.keys(choices).filter((t) => !isKnownType(t) || isFixed(t))
}

const SCHEDULE_FIELDS = {
  id: true,
  timeZone: true,
  digestHour: true,
  digestFrequency: true,
  chapter: { select: { country: true } },
  notificationDigests: { orderBy: { sentOn: 'desc' }, take: 1, select: { sentOn: true } },
} as const

/** A digest schedule, with the person's own zone choice and where the zone in use came from. */
export type ScheduleOf = DigestSchedule & {
  volunteerId: number
  ownTimeZone: string | null
  timeZoneSource: TimeZoneSource
}

type ScheduleRow = {
  id: number
  timeZone: string | null
  digestHour: number
  digestFrequency: DigestSchedule['frequency']
  chapter: { country: string } | null
  notificationDigests: { sentOn: Date }[]
}

function toSchedule(vol: ScheduleRow): ScheduleOf {
  const zone = effectiveTimeZone(vol.timeZone, vol.chapter?.country ?? null)
  const last = vol.notificationDigests[0]?.sentOn
  return {
    volunteerId: vol.id,
    timeZone: zone.timeZone,
    ownTimeZone: vol.timeZone,
    timeZoneSource: zone.source,
    hour: vol.digestHour,
    frequency: vol.digestFrequency,
    lastSentOn: last ? last.toISOString().slice(0, 10) : null,
  }
}

/** A person's digest schedule, from their settings and their last digest. */
export async function digestScheduleOf(
  volunteerId: number,
  db: Pick<typeof prisma, 'volunteer'> = prisma,
): Promise<ScheduleOf> {
  return toSchedule(
    await db.volunteer.findUniqueOrThrow({ where: { id: volunteerId }, select: SCHEDULE_FIELDS }),
  )
}

/** In one query, the schedules of everyone with an address who holds notifications for a digest. */
export async function pendingDigestSchedules(): Promise<ScheduleOf[]> {
  const people = await prisma.volunteer.findMany({
    where: {
      deletedAt: null,
      email: { not: null },
      notifications: { some: { inDigest: true, digestId: null } },
    },
    select: SCHEDULE_FIELDS,
    orderBy: { id: 'asc' },
  })
  return people.map(toSchedule)
}

const CLOSED_PROJECT = ['completed', 'archived']

/**
 * The roles `volunteerId` holds now, from what they lead, deputise, post and coordinate. Staff
 * and technical admin come from the viewer's access, which the caller already has.
 */
export async function heldRoles(
  volunteerId: number,
  viewer: { isStaff: boolean; isTechnicalAdmin: boolean },
): Promise<Role[]> {
  const [row] = await prisma.$queryRaw<
    {
      project_lead: boolean
      team_lead: boolean
      quick_task_poster: boolean
      coordinator: boolean
    }[]
  >`
    SELECT
      EXISTS (
        SELECT 1 FROM work_items w
        WHERE w.type = 'PROJECT' AND w.status <> ALL (${CLOSED_PROJECT})
          AND (w.assignee_id = ${volunteerId} OR EXISTS (
            SELECT 1 FROM project_deputies d
            WHERE d.project_id = w.id AND d.volunteer_id = ${volunteerId}))
      ) AS project_lead,
      EXISTS (
        SELECT 1 FROM team_memberships m
        WHERE m.volunteer_id = ${volunteerId} AND m.role = 'leader'
      ) AS team_lead,
      EXISTS (
        SELECT 1 FROM work_items w
        WHERE w.type = 'QUICK_TASK' AND w.creator_id = ${volunteerId} AND w.status <> 'completed'
      ) AS quick_task_poster,
      EXISTS (SELECT 1 FROM coordinators c WHERE c.volunteer_id = ${volunteerId}) AS coordinator
  `
  const held: Role[] = ['everyone']
  if (row.project_lead) held.push('project_lead')
  if (row.team_lead) held.push('team_lead')
  if (row.quick_task_poster) held.push('quick_task_poster')
  if (row.coordinator) held.push('coordinator')
  if (viewer.isStaff || viewer.isTechnicalAdmin) held.push('staff')
  if (viewer.isTechnicalAdmin) held.push('technical')
  return held
}
