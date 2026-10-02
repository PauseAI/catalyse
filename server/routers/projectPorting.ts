import { z } from 'zod'
import { ORPCError } from '@orpc/server'
import { prisma } from '@/lib/prisma'
import { env } from '@/lib/env'
import { applyScheduleWrite, canManageProject } from '@/lib/work-item'
import { findDependencyCycle } from '@/lib/schedule'
import { loadTaskEdges } from '@/lib/project-schedule'
import {
  buildApplyPlan,
  computeProjectDiff,
  emptyDiffWithErrors,
  hashState,
  parseImportFile,
  serializeProjectExport,
  type CurrentState,
  type LocalRef,
} from '@/lib/project-porting'
import { approvedProcedure } from '../procedures'
import { ApprovalStatus, TaskStatus, WorkItemType } from '@/generated/prisma/enums'

/** A re-uploaded file is a small text blob; cap it so a bad upload can't stall the handler. */
const MAX_FILE_BYTES = 2_000_000

type ProjectRow = {
  id: number
  creatorId: number | null
  assigneeId: number | null
  status: string
}

async function loadState(
  projectId: number,
): Promise<{ project: ProjectRow; state: CurrentState } | null> {
  const project = await prisma.workItem.findFirst({
    where: { id: projectId, type: WorkItemType.PROJECT },
  })
  if (!project) return null

  const [tasks, dependencies] = await Promise.all([
    prisma.workItem.findMany({
      where: { parentId: projectId, type: WorkItemType.TASK },
      include: { assignee: { select: { email: true } } },
    }),
    loadTaskEdges(projectId),
  ])

  const state: CurrentState = {
    project: {
      id: project.id,
      title: project.title,
      description: project.description,
      status: project.status,
    },
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      status: t.status,
      assigneeId: t.assigneeId,
      assigneeEmail: t.assignee?.email ?? null,
      deadline: t.deadline,
      startDate: t.startDate,
      durationDays: t.durationDays,
      baselineSetAt: t.baselineSetAt,
      featuredAsQuickTask: t.featuredAsQuickTask ?? false,
      isAnchor: t.isAnchor ?? false,
      timing: t.timing ?? 'flexible',
      sortOrder: t.sortOrder,
    })),
    dependencies,
  }

  return {
    project: {
      id: project.id,
      creatorId: project.creatorId,
      assigneeId: project.assigneeId,
      status: project.status,
    },
    state,
  }
}

function assertCanManage(project: ProjectRow, volunteer: { id: number; isAdmin: boolean | null }) {
  if (!canManageProject(project, volunteer)) {
    throw new ORPCError('FORBIDDEN', {
      message: 'Only the project owner or an admin can export or import this project',
    })
  }
}

export const projectPortingRouter = {
  /** Serialise a project + its tasks + intra-project dependencies to a JSON payload. */
  exportPlan: approvedProcedure
    .input(z.object({ projectId: z.number().int() }))
    .handler(async ({ input, context }) => {
      const loaded = await loadState(input.projectId)
      if (!loaded) throw new ORPCError('NOT_FOUND', { message: 'Project not found' })
      assertCanManage(loaded.project, context.volunteer)
      return serializeProjectExport(loaded.state, env.APP_URL)
    }),

  /** Side-effect-free: parse the file, diff it against live state, return the review model. */
  previewImport: approvedProcedure
    .input(
      z.object({
        projectId: z.number().int(),
        file: z.string().max(MAX_FILE_BYTES),
      }),
    )
    .handler(async ({ input, context }) => {
      const loaded = await loadState(input.projectId)
      if (!loaded) throw new ORPCError('NOT_FOUND', { message: 'Project not found' })
      assertCanManage(loaded.project, context.volunteer)

      const parsed = parseImportFile(input.file)
      if (!parsed.ok) {
        return emptyDiffWithErrors(loaded.state, [{ scope: 'file', message: parsed.error }])
      }
      return computeProjectDiff(loaded.state, parsed.file)
    }),

  /**
   * Apply the diff atomically. Rejects a stale file (content hash), any validation error, and
   * any unconfirmed deletion; then does every write in one transaction.
   */
  applyImport: approvedProcedure
    .input(
      z.object({
        projectId: z.number().int(),
        file: z.string().max(MAX_FILE_BYTES),
        expectedHash: z.string(),
        confirmedDeleteIds: z.array(z.number().int()).optional().default([]),
      }),
    )
    .handler(async ({ input, context }) => {
      const volunteer = context.volunteer
      const loaded = await loadState(input.projectId)
      if (!loaded) throw new ORPCError('NOT_FOUND', { message: 'Project not found' })
      assertCanManage(loaded.project, volunteer)

      if (hashState(loaded.state) !== input.expectedHash) {
        throw new ORPCError('CONFLICT', {
          message:
            'This project changed since the preview was generated. Re-export it, redo your edits, and import again.',
        })
      }

      const parsed = parseImportFile(input.file)
      if (!parsed.ok) throw new ORPCError('BAD_REQUEST', { message: parsed.error })

      const diff = computeProjectDiff(loaded.state, parsed.file)
      if (diff.errors.length > 0) {
        throw new ORPCError('BAD_REQUEST', {
          message: `Import has problems: ${diff.errors.map((e) => e.message).join('; ')}`,
          data: { errors: diff.errors },
        })
      }

      // A task in the project but not in the file is a deletion candidate. It is only
      // deleted if its box was ticked; every other candidate is kept untouched.
      const deleteCandidates = diff.tasks
        .filter((t) => t.op === 'delete')
        .map((t) => t.identity.id!)
      const confirmed = new Set(input.confirmedDeleteIds)
      const keptDeleteIds = deleteCandidates.filter((id) => !confirmed.has(id))

      const plan = buildApplyPlan(loaded.state, parsed.file, keptDeleteIds)
      if (plan.errors.length > 0) {
        throw new ORPCError('BAD_REQUEST', {
          message: plan.errors.map((e) => e.message).join('; '),
        })
      }

      // Resolve assignee emails once, up front — same rule as projects.assignTask:
      // an existing, non-deleted, approved volunteer.
      const emailToId = new Map<string, number>()
      if (plan.assigneeEmails.length > 0) {
        const vols = await prisma.volunteer.findMany({
          where: { email: { in: plan.assigneeEmails }, deletedAt: null },
          select: { id: true, email: true, approvalStatus: true },
        })
        const byEmail = new Map(vols.map((v) => [(v.email ?? '').toLowerCase(), v]))
        for (const email of plan.assigneeEmails) {
          const v = byEmail.get(email.toLowerCase())
          // One message for both "no such volunteer" and "not approved": telling them apart
          // would let a file be used to probe which addresses are registered.
          if (!v || v.approvalStatus !== ApprovalStatus.approved) {
            throw new ORPCError('BAD_REQUEST', {
              message: `Tasks cannot be assigned to ${email} — no approved volunteer has that address`,
            })
          }
          emailToId.set(email.toLowerCase(), v.id)
        }
      }
      const idForEmail = (email: string) => emailToId.get(email.toLowerCase())!

      const now = new Date()

      const result = await prisma.$transaction(async (tx) => {
        if (Object.keys(plan.project).length > 0) {
          await tx.workItem.update({ where: { id: input.projectId }, data: plan.project })
        }

        if (plan.taskDeletes.length > 0) {
          await tx.workItem.deleteMany({
            where: {
              id: { in: plan.taskDeletes },
              parentId: input.projectId,
              type: WorkItemType.TASK,
            },
          })
        }

        for (const upd of plan.taskUpdates) {
          const data: Record<string, unknown> = { updatedAt: now }
          const f = upd.fields
          if (f.title !== undefined) data.title = f.title
          if (f.description !== undefined) data.description = f.description
          if (f.deadline !== undefined) data.deadline = f.deadline
          if (f.featuredAsQuickTask !== undefined) data.featuredAsQuickTask = f.featuredAsQuickTask
          if (f.isAnchor !== undefined) data.isAnchor = f.isAnchor
          if (f.timing !== undefined) data.timing = f.timing
          if (f.status !== undefined) data.status = f.status
          if (f.assigneeEmail !== undefined) {
            data.assigneeId = f.assigneeEmail === null ? null : idForEmail(f.assigneeEmail)
          }
          applyScheduleWrite(data, { startDate: f.startDate, durationDays: f.durationDays }, now)
          await tx.workItem.update({ where: { id: upd.id }, data })
        }

        const idForRef = new Map<string, number>()
        let sortOrder = plan.createSortBase
        for (const create of plan.taskCreates) {
          const f = create.fields
          const scheduleData: Record<string, unknown> = {}
          applyScheduleWrite(
            scheduleData,
            { startDate: f.startDate ?? null, durationDays: f.durationDays ?? null },
            now,
          )
          const created = await tx.workItem.create({
            data: {
              type: WorkItemType.TASK,
              status: f.status ?? TaskStatus.open,
              parentId: input.projectId,
              title: f.title ?? 'Untitled task',
              description: f.description ?? null,
              deadline: f.deadline ?? null,
              featuredAsQuickTask: f.featuredAsQuickTask ?? false,
              isAnchor: f.isAnchor ?? false,
              timing: f.timing ?? 'flexible',
              assigneeId: f.assigneeEmail ? idForEmail(f.assigneeEmail) : null,
              creatorId: volunteer.id,
              sortOrder: ++sortOrder,
              ...scheduleData,
            },
          })
          if (create.ref) idForRef.set(create.ref, created.id)
        }

        const resolveLocal = (ref: LocalRef): number =>
          ref.kind === 'existing' ? ref.id : idForRef.get(ref.ref)!

        for (const d of plan.dependencyPlan.deletes) {
          await tx.workItemDependency.deleteMany({
            where: { predecessorId: d.predecessorId, successorId: d.successorId },
          })
        }
        for (const d of plan.dependencyPlan.creates) {
          const predecessorId = resolveLocal(d.predecessor)
          const successorId = resolveLocal(d.successor)
          await tx.workItemDependency.upsert({
            where: { predecessorId_successorId: { predecessorId, successorId } },
            create: { predecessorId, successorId, lagDays: d.lagDays, createdById: volunteer.id },
            update: { lagDays: d.lagDays },
          })
        }
        for (const d of plan.dependencyPlan.updates) {
          await tx.workItemDependency.update({
            where: {
              predecessorId_successorId: {
                predecessorId: d.predecessorId,
                successorId: d.successorId,
              },
            },
            data: { lagDays: d.lagDays },
          })
        }

        // The schedule of every remaining task may have shifted; stamp them all.
        await tx.workItem.updateMany({
          where: { parentId: input.projectId, type: WorkItemType.TASK },
          data: { scheduleUpdatedAt: now },
        })

        // Belt-and-braces: the pure pass already rejected cycles, but re-check the committed
        // edge set inside the transaction so a race cannot leave a loop behind.
        const finalEdges = await tx.workItemDependency.findMany({
          where: {
            predecessor: { parentId: input.projectId, type: WorkItemType.TASK },
            successor: { parentId: input.projectId, type: WorkItemType.TASK },
          },
          select: { predecessorId: true, successorId: true, lagDays: true },
        })
        if (findDependencyCycle(finalEdges)) {
          throw new ORPCError('BAD_REQUEST', {
            message: 'Import would create a dependency loop',
          })
        }

        return {
          projectUpdated: Object.keys(plan.project).length > 0,
          created: plan.taskCreates.length,
          updated: plan.taskUpdates.length,
          deleted: plan.taskDeletes.length,
          dependencyChanges:
            plan.dependencyPlan.creates.length +
            plan.dependencyPlan.updates.length +
            plan.dependencyPlan.deletes.length,
        }
      })

      return result
    }),
}
