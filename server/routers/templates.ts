import { z } from 'zod'
import { HttpUrlSchema } from '@/lib/schemas'
import { ORPCError } from '@orpc/server'
import { prisma } from '@/lib/prisma'
import { loadTaskEdges } from '@/lib/project-schedule'
import { applyScheduleWrite } from '@/lib/work-item'
import {
  serializeProjectAsTemplate,
  buildInstantiatePlan,
  TemplateStructureSchema,
  CURRENT_TEMPLATE_SCHEMA_VERSION,
  type ProjectTemplateStructure,
  type SourceTaskWithSkills,
} from '@/lib/template-porting'
import { approvedProcedure, staffProcedure } from '../procedures'
import { canAdminChapter, isStaff, type ChapterAccess } from '@/lib/chapter-access'
import {
  ProjectStatus,
  TaskStatus,
  WorkItemType,
  TemplateSourceType,
} from '@/generated/prisma/enums'

const ScratchTaskSchema = z.object({
  ref: z.string().min(1).max(64),
  title: z.string().min(1).max(300),
  description: z.string().max(20_000).nullable().optional(),
  estimatedHours: z.number().min(0).max(10_000).nullable().optional(),
  startOffsetDays: z.number().int().min(0).max(3650).nullable().optional(),
  durationDays: z.number().int().min(0).max(3650).nullable().optional(),
  featuredAsQuickTask: z.boolean().optional(),
  isAnchor: z.boolean().optional(),
  timing: z.enum(['flexible', 'fixed']).optional(),
  submissionPrompt: z.string().max(200).nullable().optional(),
  submissionAsksLink: z.boolean().optional(),
  helpersWanted: z.number().int().min(1).max(100).nullable().optional(),
  skillIds: z.array(z.number().int()).optional(),
  dependsOnRefs: z.array(z.string().min(1).max(64)).optional(),
})

const ScratchTemplateSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(20_000).nullable().optional(),
  projectType: z.string().nullable().optional(),
  estimatedDuration: z.string().nullable().optional(),
  timeCommitmentHoursPerWeek: z.number().int().min(0).max(1000).nullable().optional(),
  urgency: z.string().nullable().optional(),
  collaborationLink: HttpUrlSchema.nullable().optional(),
  reach: z.enum(['COUNTRY_WIDE', 'REMOTE']).optional(),
  durationDays: z.number().int().min(0).max(3650).nullable().optional(),
  tasks: z.array(ScratchTaskSchema).max(1000).optional(),
})

/** A template the caller may change: a global admin may change any, staff their own. */
async function editableTemplate(access: ChapterAccess, volunteerId: number, id: number) {
  const template = await prisma.template.findUnique({ where: { id } })
  if (!template) throw new ORPCError('NOT_FOUND', { message: 'Template not found' })
  if (!access.globalAdmin && template.createdById !== volunteerId) {
    throw new ORPCError('FORBIDDEN', { message: 'Only its author or a global admin can change it' })
  }
  return template
}

/**
 * Templates are shared by every chapter's staff and the global admins, who make, view and use
 * them; a project made from one belongs to the chapter of whoever made it.
 */
export const templatesRouter = {
  list: staffProcedure
    .input(z.object({ sourceType: z.nativeEnum(TemplateSourceType).optional() }).optional())
    .handler(async ({ input }) => {
      const templates = await prisma.template.findMany({
        where: {
          isArchived: false,
          ...(input?.sourceType ? { sourceType: input.sourceType } : {}),
        },
        include: {
          createdBy: { select: { id: true, name: true } },
          sourceTeam: { select: { id: true, name: true } },
          _count: { select: { instances: true } },
        },
        orderBy: { createdAt: 'desc' },
      })
      return templates.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        sourceType: t.sourceType,
        createdBy: t.createdBy,
        usedCount: t._count.instances,
        sourceCountry: t.sourceCountry,
        sourceLocalGroup: t.sourceLocalGroup,
        sourceTeam: t.sourceTeam,
        createdAt: t.createdAt,
      }))
    }),

  get: staffProcedure.input(z.object({ id: z.number().int() })).handler(async ({ input }) => {
    const template = await prisma.template.findUnique({
      where: { id: input.id },
      include: {
        createdBy: { select: { id: true, name: true } },
        sourceTeam: { select: { id: true, name: true } },
      },
    })
    if (!template) throw new ORPCError('NOT_FOUND', { message: 'Template not found' })
    const parsedStructure = TemplateStructureSchema.safeParse(JSON.parse(template.structure))
    return {
      id: template.id,
      title: template.title,
      description: template.description,
      sourceType: template.sourceType,
      createdBy: template.createdBy,
      sourceCountry: template.sourceCountry,
      sourceLocalGroup: template.sourceLocalGroup,
      sourceTeam: template.sourceTeam,
      structure: parsedStructure.success ? parsedStructure.data : null,
    }
  }),

  /** Serialise a live project's structure into a new Template row. Admin-only. */
  saveAsTemplate: staffProcedure
    .input(
      z.object({
        projectId: z.number().int(),
        title: z.string().min(1).max(300),
        description: z.string().max(20_000).nullable().optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      const volunteer = context.volunteer
      const project = await prisma.workItem.findFirst({
        where: { id: input.projectId, type: WorkItemType.PROJECT },
        include: { chapter: { select: { country: true } }, group: { select: { name: true } } },
      })
      // A chapter's staff save their own chapter's projects.
      if (!project || !canAdminChapter(context.access, project.nationalChapterId)) {
        throw new ORPCError('NOT_FOUND', { message: 'Project not found' })
      }

      const [tasks, dependencies, projectSkills] = await Promise.all([
        prisma.workItem.findMany({
          where: { parentId: input.projectId, type: WorkItemType.TASK },
          include: { skills: { select: { skillId: true, isRequired: true } } },
        }),
        loadTaskEdges(input.projectId),
        prisma.workItemSkill.findMany({
          where: { workItemId: input.projectId },
          select: { skillId: true, isRequired: true },
        }),
      ])

      const sourceTasks: SourceTaskWithSkills[] = tasks.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        status: t.status,
        assigneeId: t.assigneeId,
        assigneeEmail: null,
        deadline: t.deadline,
        startDate: t.startDate,
        durationDays: t.durationDays,
        baselineSetAt: t.baselineSetAt,
        featuredAsQuickTask: t.featuredAsQuickTask ?? false,
        isAnchor: t.isAnchor ?? false,
        timing: t.timing ?? 'flexible',
        submissionPrompt: t.submissionPrompt,
        submissionAsksLink: t.submissionAsksLink,
        helpersWanted: t.helpersWanted,
        sortOrder: t.sortOrder,
        skills: t.skills.map((s) => ({ skillId: s.skillId, isRequired: s.isRequired ?? true })),
      }))

      const structure = serializeProjectAsTemplate(
        {
          title: project.title,
          description: project.description,
          projectType: project.projectType,
          estimatedDuration: project.estimatedDuration,
          timeCommitmentHoursPerWeek: project.timeCommitmentHoursPerWeek,
          urgency: project.urgency,
          collaborationLink: project.collaborationLink,
          reach: project.reach,
          startDate: project.startDate,
          durationDays: project.durationDays,
        },
        sourceTasks,
        dependencies,
        projectSkills.map((s) => ({ skillId: s.skillId, isRequired: s.isRequired ?? true })),
      )

      const created = await prisma.template.create({
        data: {
          title: input.title,
          description: input.description ?? null,
          sourceType: TemplateSourceType.PROJECT,
          templateSchemaVersion: CURRENT_TEMPLATE_SCHEMA_VERSION,
          structure: JSON.stringify(structure),
          createdById: volunteer.id,
          sourceProjectId: project.id,
          sourceCountry: project.chapter?.country ?? null,
          sourceLocalGroup: project.group?.name ?? null,
          sourceTeamId: project.teamId,
        },
      })

      return { id: created.id }
    }),

  /** Build a template directly, without an existing project to save from. Admin-only. */
  createFromScratch: staffProcedure
    .input(z.object({ title: z.string().min(1).max(300), template: ScratchTemplateSchema }))
    .handler(async ({ input, context }) => {
      const refs = new Set(input.template.tasks?.map((t) => t.ref) ?? [])
      for (const t of input.template.tasks ?? []) {
        for (const dep of t.dependsOnRefs ?? []) {
          if (!refs.has(dep)) {
            throw new ORPCError('BAD_REQUEST', {
              message: `Task "${t.title}" depends on unknown ref "${dep}"`,
            })
          }
        }
      }

      const structure: ProjectTemplateStructure = {
        sourceType: 'PROJECT',
        title: input.template.title,
        description: input.template.description ?? null,
        projectType: input.template.projectType ?? null,
        estimatedDuration: input.template.estimatedDuration ?? null,
        timeCommitmentHoursPerWeek: input.template.timeCommitmentHoursPerWeek ?? null,
        urgency: input.template.urgency ?? 'medium',
        collaborationLink: input.template.collaborationLink ?? null,
        reach: input.template.reach ?? 'COUNTRY_WIDE',
        startOffsetDays: null,
        durationDays: input.template.durationDays ?? null,
        skills: [],
        tasks: (input.template.tasks ?? []).map((t) => ({
          ref: t.ref,
          title: t.title,
          description: t.description ?? null,
          estimatedHours: t.estimatedHours ?? null,
          deadline: null,
          startOffsetDays: t.startOffsetDays ?? null,
          durationDays: t.durationDays ?? null,
          featuredAsQuickTask: t.featuredAsQuickTask ?? false,
          isAnchor: t.isAnchor ?? false,
          timing: t.timing ?? 'flexible',
          submissionPrompt: t.submissionPrompt ?? null,
          submissionAsksLink: t.submissionAsksLink ?? false,
          helpersWanted: t.helpersWanted ?? null,
          skills: (t.skillIds ?? []).map((skillId) => ({ skillId, isRequired: true })),
          dependsOn: (t.dependsOnRefs ?? []).map((ref) => ({ on: ref, lagDays: 0 })),
        })),
      }

      const created = await prisma.template.create({
        data: {
          title: input.title,
          sourceType: TemplateSourceType.PROJECT,
          templateSchemaVersion: CURRENT_TEMPLATE_SCHEMA_VERSION,
          structure: JSON.stringify(structure),
          createdById: context.volunteer.id,
        },
      })

      return { id: created.id }
    }),

  update: staffProcedure
    .input(
      z.object({
        id: z.number().int(),
        title: z.string().min(1).max(300).optional(),
        description: z.string().max(20_000).nullable().optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      await editableTemplate(context.access, context.volunteer.id, input.id)
      await prisma.template.update({
        where: { id: input.id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          updatedAt: new Date(),
        },
      })
      return { message: 'Template updated' }
    }),

  archive: staffProcedure
    .input(z.object({ id: z.number().int() }))
    .handler(async ({ input, context }) => {
      await editableTemplate(context.access, context.volunteer.id, input.id)
      await prisma.template.update({ where: { id: input.id }, data: { isArchived: true } })
      return { message: 'Template archived' }
    }),

  /** Whether the current viewer may copy a template into a new draft: staff or a global admin. */
  canInstantiate: approvedProcedure.handler(({ context }) => ({
    canInstantiate: context.access.globalAdmin || isStaff(context.access),
  })),

  /**
   * Spin up a brand-new draft project from a template, straight onto its own edit page — no
   * separate wizard. Every
   * per-instance field — local group, team, collaboration link, start date — is
   * cleared, never read from the template: the copier fills these in on the draft's normal
   * edit page, the same place they'd edit any other draft. The caller becomes the new draft's
   * owner immediately, since they are the one who will run it.
   */
  instantiate: staffProcedure
    .input(z.object({ templateId: z.number().int() }))
    .handler(async ({ input, context }) => {
      const template = await prisma.template.findUnique({ where: { id: input.templateId } })
      if (!template || template.isArchived) {
        throw new ORPCError('NOT_FOUND', { message: 'Template not found' })
      }
      if (template.sourceType !== TemplateSourceType.PROJECT) {
        throw new ORPCError('BAD_REQUEST', {
          message: 'Quick-task templates are not yet supported',
        })
      }

      const parsedStructure = TemplateStructureSchema.safeParse(JSON.parse(template.structure))
      if (!parsedStructure.success || parsedStructure.data.sourceType !== 'PROJECT') {
        throw new ORPCError('BAD_REQUEST', {
          message: 'This template has an unrecognised structure and cannot be instantiated',
        })
      }

      // No anchor date: with no wizard to ask for one, tasks land unscheduled (dates derived
      // from dependencies, same as any task created without a start date — see lib/schedule.ts).
      const plan = buildInstantiatePlan(parsedStructure.data, {
        newTitle: template.title,
        newStartDate: null,
      })
      if (plan.errors.length > 0) {
        throw new ORPCError('BAD_REQUEST', { message: plan.errors.join('; ') })
      }

      const now = new Date()
      const result = await prisma.$transaction(async (tx) => {
        const scheduleData: Record<string, unknown> = {}
        applyScheduleWrite(
          scheduleData,
          { startDate: plan.project.startDate, durationDays: plan.project.durationDays },
          now,
        )

        const newProject = await tx.workItem.create({
          data: {
            type: WorkItemType.PROJECT,
            status: ProjectStatus.draft,
            title: plan.project.title,
            description: plan.project.description,
            projectType: plan.project.projectType,
            estimatedDuration: plan.project.estimatedDuration,
            timeCommitmentHoursPerWeek: plan.project.timeCommitmentHoursPerWeek,
            urgency: plan.project.urgency,
            // Per-instance, never copied from the template — cleared here even though the
            // plan carries the template's own value, same reasoning as local group and team.
            collaborationLink: null,
            reach: plan.project.reach,
            ...scheduleData,
            // The copy is the copier's chapter's to run.
            nationalChapterId: context.access.chapterId,
            teamId: null,
            assigneeId: context.volunteer.id,
            creatorId: context.volunteer.id,
            isOrgProposed: false,
            templateOriginId: template.id,
          },
        })

        if (plan.projectSkills.length > 0) {
          await tx.workItemSkill.createMany({
            data: plan.projectSkills.map((s) => ({
              workItemId: newProject.id,
              skillId: s.skillId,
              isRequired: s.isRequired,
            })),
          })
        }

        const refToId = new Map<string, number>()
        let sortOrder = 0
        for (const taskCreate of plan.taskCreates) {
          const taskScheduleData: Record<string, unknown> = {}
          applyScheduleWrite(
            taskScheduleData,
            { startDate: taskCreate.startDate, durationDays: taskCreate.durationDays },
            now,
          )
          const createdTask = await tx.workItem.create({
            data: {
              type: WorkItemType.TASK,
              status: TaskStatus.not_started,
              parentId: newProject.id,
              title: taskCreate.title,
              description: taskCreate.description,
              estimatedHours: taskCreate.estimatedHours,
              deadline: taskCreate.deadline,
              featuredAsQuickTask: taskCreate.featuredAsQuickTask,
              isAnchor: taskCreate.isAnchor,
              timing: taskCreate.timing,
              submissionPrompt: taskCreate.submissionPrompt,
              submissionAsksLink: taskCreate.submissionAsksLink,
              helpersWanted: taskCreate.helpersWanted,
              creatorId: context.volunteer.id,
              sortOrder: ++sortOrder,
              ...taskScheduleData,
            },
          })
          refToId.set(taskCreate.ref, createdTask.id)
          if (taskCreate.skills.length > 0) {
            await tx.workItemSkill.createMany({
              data: taskCreate.skills.map((s) => ({
                workItemId: createdTask.id,
                skillId: s.skillId,
                isRequired: s.isRequired,
              })),
            })
          }
        }

        for (const dep of plan.dependencyCreates) {
          const predecessorId =
            dep.predecessor.kind === 'existing'
              ? dep.predecessor.id
              : refToId.get(dep.predecessor.ref)!
          const successorId =
            dep.successor.kind === 'existing' ? dep.successor.id : refToId.get(dep.successor.ref)!
          await tx.workItemDependency.create({
            data: {
              predecessorId,
              successorId,
              lagDays: dep.lagDays,
              createdById: context.volunteer.id,
            },
          })
        }

        return newProject
      })

      return { id: result.id, title: result.title }
    }),
}
