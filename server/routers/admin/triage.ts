import { z } from 'zod'
import { ORPCError } from '@orpc/server'
import { prisma } from '@/lib/prisma'
import { withProjectExtras, projectInclude, EnrichedProject } from '@/lib/work-item'
import { notifyAdmins, notifyUser } from '@/lib/notify'
import { updateWorkItem } from '@/lib/work-item-events'
import { html } from '@/lib/email'
import { adminProcedure } from '../../procedures'
import { ProjectStatus, WorkItemType } from '@/generated/prisma/enums'

export const adminTriageRouter = {
  list: adminProcedure.handler(async () => {
    const projects = await prisma.workItem.findMany({
      where: {
        type: WorkItemType.PROJECT,
        status: { in: [ProjectStatus.pending_review, ProjectStatus.needs_discussion] },
      },
      include: projectInclude,
      orderBy: { createdAt: 'asc' },
    })
    return projects.map((p) => withProjectExtras(p as EnrichedProject))
  }),

  drafts: adminProcedure.handler(async () => {
    // Volunteer-authored drafts not yet submitted for review. Org drafts have their
    // own "My Drafts" list on the Org Projects admin page and are excluded here.
    // Template-originated drafts are also excluded: their owner self-publishes without
    // admin review (see publishDraft in server/routers/projects.ts), so they never need
    // to sit in this queue.
    const projects = await prisma.workItem.findMany({
      where: {
        type: WorkItemType.PROJECT,
        status: ProjectStatus.draft,
        isOrgProposed: false,
        templateOriginId: null,
      },
      include: projectInclude,
      orderBy: { createdAt: 'desc' },
    })
    return projects.map((p) => withProjectExtras(p as EnrichedProject))
  }),

  submitDraft: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .handler(async ({ input, context }) => {
      const admin = context.volunteer
      const project = await prisma.workItem.findFirst({
        where: { id: input.id, type: WorkItemType.PROJECT },
        include: { creator: { select: { name: true } } },
      })
      if (!project) throw new ORPCError('NOT_FOUND', { message: 'Draft not found' })
      if (
        project.status !== ProjectStatus.draft ||
        project.isOrgProposed ||
        project.templateOriginId !== null
      ) {
        throw new ORPCError('BAD_REQUEST', { message: 'Not a volunteer draft' })
      }

      const taskCount = await prisma.workItem.count({
        where: { parentId: input.id, type: WorkItemType.TASK },
      })
      if (taskCount === 0) {
        throw new ORPCError('BAD_REQUEST', {
          message: 'Add at least one task before submitting this draft for review',
        })
      }

      await updateWorkItem(
        project,
        { status: ProjectStatus.pending_review, updatedAt: new Date() },
        { actorId: admin.id, kind: 'status' },
      )

      await notifyAdmins(
        'new_project_proposal',
        `New project proposal: ${project.title}`,
        `Proposed by ${project.creator?.name ?? 'a volunteer'}, submitted by ${admin.name}`,
        '/admin/triage',
        {
          message: html`<strong>${admin.name}</strong> submitted a volunteer's draft project for
            review: <strong>${project.title}</strong>. Please review it in the triage queue.`,
          projectTitle: project.title,
          projectId: project.id,
        },
        project.id,
      )

      if (project.creatorId) {
        await notifyUser(
          project.creatorId,
          'draft_submitted_by_admin',
          `Your draft was submitted for review: ${project.title}`,
          `${admin.name} submitted this on your behalf.`,
          `/projects/${project.id}`,
          {
            message: html`<strong>${admin.name}</strong> submitted your draft project
              <strong>${project.title}</strong> for review on your behalf.`,
            projectTitle: project.title,
            projectId: project.id,
          },
          project.id,
        )
      }

      return { message: 'Project submitted for review' }
    }),
}
