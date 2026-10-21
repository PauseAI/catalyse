import { z } from 'zod'
import { ORPCError } from '@orpc/server'
import { prisma } from '@/lib/prisma'
import {
  applyScheduleWrite,
  canManageProject,
  canManageProjectTasks,
  isProjectDeputy,
} from '@/lib/work-item'
import { assertProjectEditable, assertTaskEditable } from '@/lib/work-item-lock'
import { recordChange, recordEvent } from '@/lib/work-item-events'
import {
  loadProjectEdges,
  loadProjectTaskSchedule,
  scheduleAllProjects,
} from '@/lib/project-schedule'
import { followAt, type ScheduleEdge } from '@/lib/schedule'
import { approvedProcedure } from '../procedures'
import { WorkItemType } from '@/generated/prisma/enums'
import type { WorkItem } from '@/generated/prisma/client'

const RescheduleItem = z
  .object({
    id: z.number().int(),
    /** null unpins — the item goes back to following its predecessors. */
    startDate: z.coerce.date().nullable(),
    /**
     * Keeps an item that waits on others following them, rather than pinning it: `startDate` is
     * where it was dropped, and is held as lag after its predecessors (see followAt).
     */
    follow: z.boolean().optional(),
    /** Omit to leave the duration untouched. Zero is a milestone, as in an imported project. */
    durationDays: z.number().int().min(0).max(3650).nullable().optional(),
    /** Tasks only: where the bar ends. Omit to leave it untouched. */
    deadline: z.coerce.date().nullable().optional(),
  })
  .refine((i) => !i.follow || i.startDate !== null, {
    message: 'An item that follows needs the day it was dropped on',
  })

/**
 * Where a dragged item that waits on others lands, worked out on the stored schedule of its scope,
 * and the links whose lag must change to hold it there. Refused for one that waits on nothing.
 */
async function planFollow(item: WorkItem, project: WorkItem, start: Date) {
  let edges: ScheduleEdge[]
  let at: ReturnType<typeof followAt>
  if (item.type === WorkItemType.TASK) {
    const tasks = await prisma.workItem.findMany({
      where: { parentId: project.id, type: WorkItemType.TASK },
    })
    const loaded = await loadProjectTaskSchedule(project, tasks)
    edges = loaded.edges
    at = followAt(loaded.schedule, edges, item.id, start)
  } else {
    edges = await loadProjectEdges()
    at = followAt(await scheduleAllProjects(edges), edges, item.id, start)
  }
  if (!at) {
    throw new ORPCError('BAD_REQUEST', {
      message: `“${item.title}” waits on nothing, so it has nothing to follow`,
    })
  }
  const stored = new Map(
    edges.filter((e) => e.successorId === item.id).map((e) => [e.predecessorId, e.lagDays]),
  )
  const changed = at.links.filter((l) => stored.get(l.predecessorId) !== l.lagDays)
  const titles = await prisma.workItem.findMany({
    where: { id: { in: changed.map((l) => l.predecessorId) } },
    select: { id: true, title: true },
  })
  const titleOf = new Map(titles.map((t) => [t.id, t.title]))
  return changed.map((l) => ({
    ...l,
    was: stored.get(l.predecessorId)!,
    predecessorTitle: titleOf.get(l.predecessorId)!,
  }))
}

/**
 * Batch reschedule — one round trip for a drag gesture and any cascade the client previewed.
 * Every id is permission-checked against its own scope: a task against its parent project, a
 * project against itself. QUICK_TASK is not schedulable.
 */
export const scheduleRouter = {
  rescheduleItems: approvedProcedure
    .input(z.object({ items: z.array(RescheduleItem).min(1).max(200) }))
    .handler(async ({ input, context }) => {
      const volunteer = context.volunteer
      const ids = input.items.map((i) => i.id)

      const items = await prisma.workItem.findMany({ where: { id: { in: ids } } })
      const byId = new Map(items.map((w) => [w.id, w]))
      if (byId.size !== ids.length) {
        throw new ORPCError('NOT_FOUND', { message: 'One or more items were not found' })
      }

      // Resolve the governing project for each item, then prove manage rights once per project.
      const projectIdFor = new Map<number, number>()
      for (const item of input.items) {
        const type = byId.get(item.id)?.type
        // A task's length follows from its start and deadline; only a milestone sets one.
        if (type === WorkItemType.TASK && (item.durationDays ?? 0) !== 0) {
          throw new ORPCError('BAD_REQUEST', {
            message: 'A task ends on its deadline; move its deadline instead',
          })
        }
        if (type === WorkItemType.PROJECT && item.deadline !== undefined) {
          throw new ORPCError('BAD_REQUEST', {
            message: "A project's deadline is a target, not part of its schedule",
          })
        }
      }
      for (const w of items) {
        if (w.type === WorkItemType.PROJECT) projectIdFor.set(w.id, w.id)
        else if (w.type === WorkItemType.TASK && w.parentId) projectIdFor.set(w.id, w.parentId)
        else
          throw new ORPCError('BAD_REQUEST', {
            message: 'Only projects and tasks can be scheduled',
          })
      }
      const projects = await prisma.workItem.findMany({
        where: { id: { in: [...new Set(projectIdFor.values())] }, type: WorkItemType.PROJECT },
      })
      const projectById = new Map(projects.map((p) => [p.id, p]))
      // A deputy reschedules tasks, never the project's own dates.
      const projectItemIds = new Set(
        items.filter((w) => w.type === WorkItemType.PROJECT).map((w) => w.id),
      )
      for (const projectId of new Set(projectIdFor.values())) {
        const project = projectById.get(projectId)
        const allowed =
          project &&
          (projectItemIds.has(projectId)
            ? canManageProject(project, volunteer)
            : canManageProjectTasks(
                project,
                volunteer,
                await isProjectDeputy(projectId, volunteer.id),
              ))
        if (!allowed) {
          throw new ORPCError('FORBIDDEN', {
            message: 'You cannot reschedule work on this project',
          })
        }
        assertProjectEditable(project)
      }
      for (const w of items) if (w.type === WorkItemType.TASK) assertTaskEditable(w)

      const lagChanges = new Map<number, Awaited<ReturnType<typeof planFollow>>>()
      for (const item of input.items) {
        if (!item.follow || !item.startDate) continue
        const project = projectById.get(projectIdFor.get(item.id)!)!
        lagChanges.set(item.id, await planFollow(byId.get(item.id)!, project, item.startDate))
      }

      const now = new Date()
      await prisma.$transaction(async (tx) => {
        for (const item of input.items) {
          const data: Record<string, unknown> = {}
          applyScheduleWrite(
            data,
            {
              startDate: item.follow ? null : item.startDate,
              durationDays: item.durationDays,
              taskDeadline: item.deadline,
            },
            now,
          )
          await tx.workItem.update({ where: { id: item.id }, data })
          await recordChange(tx, {
            row: byId.get(item.id) as { id: number },
            data,
            actorId: volunteer.id,
            kind: 'rescheduled',
          })
          for (const link of lagChanges.get(item.id) ?? []) {
            await tx.workItemDependency.update({
              where: {
                predecessorId_successorId: {
                  predecessorId: link.predecessorId,
                  successorId: item.id,
                },
              },
              data: { lagDays: link.lagDays },
            })
            const values = {
              predecessorId: link.predecessorId,
              predecessorTitle: link.predecessorTitle,
            }
            await recordEvent(tx, {
              workItemId: item.id,
              actorId: volunteer.id,
              kind: 'dependency_lag',
              before: { ...values, lagDays: link.was },
              after: { ...values, lagDays: link.lagDays },
            })
          }
        }
      })

      return { count: input.items.length }
    }),
}
