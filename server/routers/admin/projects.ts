import { z } from 'zod'
import { ORPCError } from '@orpc/server'
import { prisma } from '@/lib/prisma'
import {
  withProjectExtras,
  projectInclude,
  EnrichedProject,
  applyScheduleWrite,
} from '@/lib/work-item'
import { notifyUser, notifyTeamOfProject, clearNotifications } from '@/lib/notify'
import { html } from '@/lib/email'
import { notifyMatchingVolunteers } from '@/lib/project-match-notify'
import { AdminCreateProjectSchema, ReviewProjectSchema, OutcomeProjectSchema } from '@/lib/schemas'
import { adminProcedure } from '../../procedures'
import { ProjectStatus, TaskStatus, WorkItemType } from '@/generated/prisma/enums'

export const adminProjectsRouter = {
  myDrafts: adminProcedure.handler(async ({ context }) => {
    const admin = context.volunteer
    const drafts = await prisma.workItem.findMany({
      where: {
        type: WorkItemType.PROJECT,
        creatorId: admin.id,
        status: ProjectStatus.draft,
        isOrgProposed: true,
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, createdAt: true },
    })
    return drafts
  }),

  create: adminProcedure.input(AdminCreateProjectSchema).handler(async ({ input, context }) => {
    const admin = context.volunteer
    const { wantToOwn, skillIds, skillRequiredMap, tasks, saveAsDraft } = input
    if (!saveAsDraft && tasks.length === 0) {
      throw new ORPCError('BAD_REQUEST', {
        message: 'At least one task is required to create a project',
      })
    }

    // A project created with dates is scheduled from birth, so it is baselined from birth too.
    const scheduleOnCreate: Record<string, unknown> = {}
    applyScheduleWrite(scheduleOnCreate, {
      startDate: input.startDate ?? null,
      durationDays: input.durationDays ?? null,
    })

    const project = await prisma.$transaction(async (tx) => {
      const newProject = await tx.workItem.create({
        data: {
          type: WorkItemType.PROJECT,
          title: input.title,
          description: input.description,
          // Org projects skip review, so a published one goes live immediately — owned by
          // the admin who created it, or `ready` for someone to pick up. A draft stays
          // invisible to volunteers until the admin explicitly publishes it.
          status: saveAsDraft
            ? ProjectStatus.draft
            : wantToOwn
              ? ProjectStatus.in_progress
              : ProjectStatus.ready,
          assigneeId: wantToOwn ? admin.id : null,
          creatorId: admin.id,
          isOrgProposed: true,
          projectType: input.projectType ?? null,
          estimatedDuration: input.estimatedDuration ?? null,
          timeCommitmentHoursPerWeek: input.timeCommitmentHoursPerWeek ?? null,
          urgency: input.urgency ?? 'medium',
          collaborationLink: input.collaborationLink ?? null,
          country: input.country ?? null,
          localGroup: input.localGroup ?? null,
          remoteEligibility: input.remoteEligibility ?? 'NONE',
          isSeekingHelp: input.isSeekingHelp !== false,
          teamId: input.teamId ?? null,
          ...scheduleOnCreate,
        },
      })

      if (skillIds.length > 0) {
        await tx.workItemSkill.createMany({
          data: skillIds.map((skillId) => ({
            workItemId: newProject.id,
            skillId,
            isRequired: skillRequiredMap[skillId] !== false,
          })),
        })
      }

      await tx.workItem.createMany({
        data: tasks.map((t) => ({
          type: WorkItemType.TASK,
          status: TaskStatus.open,
          parentId: newProject.id,
          title: t.title,
          description: t.description ?? null,
          creatorId: admin.id,
        })),
      })

      return newProject
    })

    if (!saveAsDraft) {
      notifyMatchingVolunteers(project.id).catch((e) => console.error('[MATCH NOTIFY]', e))

      if (input.teamId) {
        notifyTeamOfProject(input.teamId, project.id, project.title).catch((e) =>
          console.error('[TEAM NOTIFY]', e),
        )
      }
    }

    return { id: project.id, message: saveAsDraft ? 'Draft saved' : 'Org project created' }
  }),

  review: adminProcedure
    .input(z.object({ id: z.number().int() }).merge(ReviewProjectSchema))
    .handler(async ({ input, context }) => {
      const admin = context.volunteer
      const project = await prisma.workItem.findFirst({
        where: { id: input.id, type: WorkItemType.PROJECT },
      })
      if (!project) throw new ORPCError('NOT_FOUND', { message: 'Project not found' })

      const { status, reviewNotes = null, comment = null } = input

      if (status === 'approved') {
        // A proposer who offered to lead it owns it from the moment it's approved;
        // otherwise it goes live as `ready` for someone to pick up. Whether it also wants
        // contributors is the proposer's call — approval no longer overrides an explicit
        // "no thanks" by force-setting isSeekingHelp on every unowned project.
        const newStatus =
          project.assigneeId === null ? ProjectStatus.ready : ProjectStatus.in_progress

        await prisma.workItem.update({
          where: { id: input.id },
          data: {
            status: newStatus,
            reviewNotes,
            stakeholderId: admin.id,
            reviewedById: admin.id,
            reviewedAt: new Date(),
            updatedAt: new Date(),
          },
        })

        if (comment && comment.trim()) {
          await prisma.workItemComment.create({
            data: { workItemId: input.id, authorId: admin.id, content: comment.trim() },
          })
        }

        await prisma.projectReviewRequest.updateMany({
          where: { projectId: input.id, resolvedAt: null },
          data: { resolvedAt: new Date() },
        })
        await clearNotifications('project_needs_discussion', input.id)

        if (project.creatorId) {
          await notifyUser(
            project.creatorId,
            'project_approved',
            `Approved: '${project.title}' is now visible to volunteers`,
            null,
            `/projects/${input.id}`,
            {
              message:
                'Great news! Your project has been approved and is now visible to all volunteers.',
              projectTitle: project.title,
              projectId: input.id,
            },
          )
        }

        notifyMatchingVolunteers(input.id).catch((e) => console.error('[MATCH NOTIFY]', e))

        if (project.teamId) {
          notifyTeamOfProject(project.teamId, project.id, project.title).catch((e) =>
            console.error('[TEAM NOTIFY]', e),
          )
        }
      } else {
        await prisma.workItem.update({
          where: { id: input.id },
          data: {
            status: ProjectStatus.needs_discussion,
            reviewNotes,
            stakeholderId: admin.id,
            reviewedById: admin.id,
            reviewedAt: new Date(),
            updatedAt: new Date(),
          },
        })

        if (comment && comment.trim()) {
          await prisma.workItemComment.create({
            data: { workItemId: input.id, authorId: admin.id, content: comment.trim() },
          })
        }

        const feedback = comment?.trim() || 'A team lead would like some changes to your proposal.'
        // A new round replaces any earlier request still open.
        await prisma.projectReviewRequest.updateMany({
          where: { projectId: input.id, resolvedAt: null },
          data: { resolvedAt: new Date() },
        })
        await prisma.projectReviewRequest.create({
          data: { projectId: input.id, message: feedback, requestedById: admin.id },
        })

        if (project.creatorId) {
          await notifyUser(
            project.creatorId,
            'project_needs_discussion',
            `Changes requested: '${project.title}'`,
            feedback,
            `/projects/${input.id}`,
            {
              message:
                'A team lead has asked for changes to your project proposal before it goes live. Make the changes, then press Resubmit for review on the project page.',
              projectTitle: project.title,
              projectId: input.id,
              extraHtml: html`<div
                style="padding: 12px; background: #f7fafc; border-radius: 8px; margin: 16px 0;"
              >
                <strong>Feedback:</strong> ${feedback}
              </div>`,
            },
            input.id,
          )
        }
      }

      await clearNotifications('new_project_proposal', input.id)
      await clearNotifications('project_resubmitted', input.id)

      return { message: `Project marked as ${status}` }
    }),

  setOutcome: adminProcedure
    .input(z.object({ id: z.number().int() }).merge(OutcomeProjectSchema))
    .handler(async ({ input, context }) => {
      const admin = context.volunteer
      const project = await prisma.workItem.findFirst({
        where: { id: input.id, type: WorkItemType.PROJECT },
      })
      if (!project) throw new ORPCError('NOT_FOUND', { message: 'Project not found' })

      const { outcome, outcomeNotes = null } = input
      const isCompleted = ['successful', 'partial', 'not_completed'].includes(outcome)

      await prisma.workItem.update({
        where: { id: input.id },
        data: {
          outcome,
          outcomeNotes,
          completedAt: isCompleted ? new Date() : null,
          // Completing here has to stop advertising the project, exactly as completing it
          // via projects.update does — otherwise a finished project keeps its "Seeking
          // Help" badge and stays in the "Looking for People" group.
          ...(isCompleted ? { status: ProjectStatus.completed, isSeekingHelp: false } : {}),
          updatedAt: new Date(),
        },
      })

      if (project.assigneeId && outcomeNotes) {
        await prisma.adminNote.create({
          data: {
            volunteerId: project.assigneeId,
            authorId: admin.id,
            content: `Project '${project.title}' outcome: ${outcome}. ${outcomeNotes}`,
            category: 'reliability',
            relatedWorkItemId: input.id,
          },
        })
      }

      if (outcome === 'successful' && project.assigneeId) {
        const assigneeId = project.assigneeId
        const projectSkills = await prisma.workItemSkill.findMany({
          where: { workItemId: input.id, isRequired: true },
          select: { skillId: true },
        })
        await Promise.all(
          projectSkills.map((ps) =>
            prisma.skillEndorsement.upsert({
              where: {
                volunteerId_skillId_endorsedById: {
                  volunteerId: assigneeId,
                  skillId: ps.skillId,
                  endorsedById: admin.id,
                },
              },
              update: {
                rating: 'verified',
                source: 'project_outcome',
                sourceId: input.id,
                notes: `Successfully delivered: ${project.title}`,
              },
              create: {
                volunteerId: assigneeId,
                skillId: ps.skillId,
                endorsedById: admin.id,
                source: 'project_outcome',
                sourceId: input.id,
                rating: 'verified',
                notes: `Successfully delivered: ${project.title}`,
              },
            }),
          ),
        )
      }

      return { message: `Project outcome recorded as ${outcome}` }
    }),

  triage: adminProcedure.handler(async () => {
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

  // Owned projects with an empty backlog — the same condition the `needsTasks` badge
  // derives, from the admin side.
  staleInProgress: adminProcedure.handler(async () => {
    const projects = await prisma.workItem.findMany({
      where: {
        type: WorkItemType.PROJECT,
        status: ProjectStatus.in_progress,
        children: {
          none: {
            type: WorkItemType.TASK,
            status: { not: TaskStatus.completed },
          },
        },
      },
      include: projectInclude,
      orderBy: { updatedAt: 'asc' },
    })
    return projects.map((p) => withProjectExtras(p as EnrichedProject))
  }),
}
