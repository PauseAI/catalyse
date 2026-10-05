import { prisma } from '@/lib/prisma'
import { ADVERTISABLE_STATUSES } from '@/lib/project-status'
import { WorkItemType } from '@/generated/prisma/enums'
import { publicProcedure } from '../procedures'

const MOST_NEEDED = 10

export const skillsRouter = {
  list: publicProcedure.handler(async () => {
    const categories = await prisma.skillCategory.findMany({
      include: {
        skills: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
      },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    })
    return categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      description: cat.description,
      sortOrder: cat.sortOrder,
      createdAt: cat.createdAt,
      skills: cat.skills.map((s) => ({
        id: s.id,
        categoryId: s.categoryId,
        name: s.name,
        description: s.description,
        sortOrder: s.sortOrder,
        createdAt: s.createdAt,
      })),
    }))
  }),

  /**
   * The skills most often asked for by live projects that want help or an owner, most asked
   * first, for sign-up to offer before the full list.
   */
  mostNeeded: publicProcedure.handler(async () => {
    const counts = await prisma.workItemSkill.groupBy({
      by: ['skillId'],
      where: {
        workItem: {
          type: WorkItemType.PROJECT,
          status: { in: ADVERTISABLE_STATUSES },
          OR: [{ isSeekingHelp: true }, { assigneeId: null }],
        },
      },
      _count: { skillId: true },
      orderBy: [{ _count: { skillId: 'desc' } }, { skillId: 'asc' }],
      take: MOST_NEEDED,
    })
    const skills = await prisma.skill.findMany({
      where: { id: { in: counts.map((c) => c.skillId) } },
      select: { id: true, name: true },
    })
    const byId = new Map(skills.map((s) => [s.id, s]))
    return counts.flatMap((c) => {
      const skill = byId.get(c.skillId)
      return skill ? [{ id: skill.id, name: skill.name, projects: c._count.skillId }] : []
    })
  }),
}
