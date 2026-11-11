import { z } from 'zod'
import { ORPCError } from '@orpc/server'
import { prisma } from '@/lib/prisma'
import { CreateSkillSchema, UpdateSkillSchema } from '@/lib/schemas'
import { adminProcedure } from '../../procedures'

const ReorderItemSchema = z.object({ id: z.number().int(), sortOrder: z.number().int() })

export const adminSkillsRouter = {
  create: adminProcedure.input(CreateSkillSchema).handler(async ({ input }) => {
    const category = await prisma.skillCategory.findUnique({ where: { id: input.categoryId } })
    if (!category) throw new ORPCError('BAD_REQUEST', { message: 'Category not found' })

    let sortOrder = input.sortOrder ?? null
    if (sortOrder === null) {
      const max = await prisma.skill.aggregate({
        where: { categoryId: input.categoryId },
        _max: { sortOrder: true },
      })
      sortOrder = (max._max.sortOrder ?? 0) + 1
    }

    const skill = await prisma.skill.create({
      data: {
        categoryId: input.categoryId,
        name: input.name,
        description: input.description ?? null,
        sortOrder,
      },
    })

    return { id: skill.id, name: skill.name, categoryId: skill.categoryId }
  }),

  update: adminProcedure
    .input(z.object({ id: z.number().int() }).merge(UpdateSkillSchema))
    .handler(async ({ input }) => {
      const existing = await prisma.skill.findUnique({ where: { id: input.id } })
      if (!existing) throw new ORPCError('NOT_FOUND', { message: 'Skill not found' })

      const data: {
        name?: string
        description?: string | null
        sortOrder?: number
        categoryId?: number
      } = {}
      if ('name' in input && input.name) data.name = String(input.name).trim()
      if ('description' in input) data.description = input.description ?? null
      if ('sortOrder' in input && input.sortOrder !== undefined) data.sortOrder = input.sortOrder
      if ('categoryId' in input && input.categoryId !== undefined) {
        const category = await prisma.skillCategory.findUnique({
          where: { id: input.categoryId },
        })
        if (!category) throw new ORPCError('BAD_REQUEST', { message: 'Category not found' })
        data.categoryId = input.categoryId
      }

      await prisma.skill.update({ where: { id: input.id }, data })
      return { success: true }
    }),

  delete: adminProcedure.input(z.object({ id: z.number().int() })).handler(async ({ input }) => {
    const skill = await prisma.skill.findUnique({ where: { id: input.id } })
    if (!skill) throw new ORPCError('NOT_FOUND', { message: 'Skill not found' })

    await prisma.workItem.updateMany({ where: { skillId: input.id }, data: { skillId: null } })
    // A call for the skill would otherwise widen to everyone in its chapters.
    await prisma.call.updateMany({
      where: { skillId: input.id, closedAt: null },
      data: { closedAt: new Date() },
    })
    await prisma.skill.delete({ where: { id: input.id } })

    return { success: true, deletedSkill: { id: skill.id, name: skill.name } }
  }),

  reorder: adminProcedure.input(z.array(ReorderItemSchema)).handler(async ({ input }) => {
    await prisma.$transaction(
      input.map(({ id, sortOrder }) => prisma.skill.update({ where: { id }, data: { sortOrder } })),
    )
    return { success: true }
  }),
}
