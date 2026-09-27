import { z } from 'zod'
import { ORPCError } from '@orpc/server'
import { prisma } from '@/lib/prisma'
import {
  applyScheduleWrite,
  canManageProject,
  canManageProjectTasks,
  isProjectDeputy,
} from '@/lib/work-item'
import { approvedProcedure } from '../procedures'
import { WorkItemType } from '@/generated/prisma/enums'

const RescheduleItem = z.object({
  id: z.number().int(),
  /** null unpins — the item goes back to following its predecessors. */
  startDate: z.coerce.date().nullable(),
  /** Omit to leave the duration untouched. Zero is a milestone, as in an imported project. */
  durationDays: z.number().int().min(0).max(3650).nullable().optional(),
  /** Tasks only: where the bar ends. Omit to leave it untouched. */
  deadline: z.coerce.date().nullable().optional(),
})

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
      }

      const now = new Date()
      await prisma.$transaction(
        input.items.map((item) => {
          const data: Record<string, unknown> = {}
          applyScheduleWrite(
            data,
            {
              startDate: item.startDate,
              durationDays: item.durationDays,
              taskDeadline: item.deadline,
            },
            now,
          )
          return prisma.workItem.update({ where: { id: item.id }, data })
        }),
      )

      return { count: input.items.length }
    }),
}
