import { z } from 'zod'
import { ORPCError } from '@orpc/server'
import { prisma } from '@/lib/prisma'
import { CreateSkillCategorySchema, UpdateSkillCategorySchema } from '@/lib/schemas'
import { adminProcedure } from '../../procedures'

const ReorderItemSchema = z.object({ id: z.number().int(), sortOrder: z.number().int() })

export const adminSkillCategoriesRouter = {
  list: adminProcedure.handler(async () => {
    const categories = await prisma.skillCategory.findMany({
      include: { _count: { select: { skills: true } } },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    })
    return categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      description: cat.description,
      sortOrder: cat.sortOrder,
      createdAt: cat.createdAt,
      skillCount: cat._count.skills,
    }))
  }),

  create: adminProcedure.input(CreateSkillCategorySchema).handler(async ({ input }) => {
    let sortOrder = input.sortOrder ?? null
    if (sortOrder === null) {
      const max = await prisma.skillCategory.aggregate({ _max: { sortOrder: true } })
      sortOrder = (max._max.sortOrder ?? 0) + 1
    }

    const category = await prisma.skillCategory.create({
      data: { name: input.name, description: input.description ?? null, sortOrder },
    })

    return { id: category.id, name: category.name, sortOrder: category.sortOrder }
  }),

  update: adminProcedure
    .input(z.object({ id: z.number().int() }).merge(UpdateSkillCategorySchema))
    .handler(async ({ input }) => {
      const existing = await prisma.skillCategory.findUnique({ where: { id: input.id } })
      if (!existing) throw new ORPCError('NOT_FOUND', { message: 'Category not found' })

      const data: { name?: string; description?: string | null; sortOrder?: number } = {}
      if ('name' in input && input.name !== undefined) data.name = String(input.name).trim()
      if ('description' in input) data.description = input.description ?? null
      if ('sortOrder' in input && input.sortOrder !== undefined) data.sortOrder = input.sortOrder

      await prisma.skillCategory.update({ where: { id: input.id }, data })
      return { success: true }
    }),

  delete: adminProcedure.input(z.object({ id: z.number().int() })).handler(async ({ input }) => {
    const skillCount = await prisma.skill.count({ where: { categoryId: input.id } })
    if (skillCount > 0) {
      throw new ORPCError('BAD_REQUEST', {
        message: `Cannot delete category with ${skillCount} skills. Move or delete skills first.`,
      })
    }

    const result = await prisma.skillCategory.deleteMany({ where: { id: input.id } })
    if (result.count === 0) throw new ORPCError('NOT_FOUND', { message: 'Category not found' })

    return { success: true }
  }),

  reorder: adminProcedure.input(z.array(ReorderItemSchema)).handler(async ({ input }) => {
    await prisma.$transaction(
      input.map(({ id, sortOrder }) =>
        prisma.skillCategory.update({ where: { id }, data: { sortOrder } }),
      ),
    )
    return { success: true }
  }),
}
